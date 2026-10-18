import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { encodeUserAddress } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { resolveNetwork, getOrCreateWallet, getDeployment } from './network';
import { createWallet, persistWalletState, type WalletContext } from './wallet';

// @ts-expect-error Required by Midnight wallet sync.
globalThis.WebSocket = WebSocket;

const PRIVATE_STATE_ID = 'handshake-market-state';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'handshake-market');
const contractPath = path.join(zkConfigPath, 'contract', 'index.js');
const recoveryPath = path.resolve(__dirname, '..', '.market-smoke-state.json');
const { network, config: networkConfig } = resolveNetwork();

type RecoveryState = { contractAddress: string; takerSecretHex: string };

function readRecovery(): RecoveryState | null {
  if (!fs.existsSync(recoveryPath)) return null;
  return JSON.parse(fs.readFileSync(recoveryPath, 'utf8')) as RecoveryState;
}

async function createProviders(walletCtx: WalletContext) {
  const privateStatePassword = process.env.PRIVATE_STATE_PASSWORD?.trim() || 'Local-Devnet-Development-Placeholder-1';
  const walletProvider = {
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await walletCtx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: walletCtx.shieldedSecretKeys, dustSecretKey: walletCtx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      const signedRecipe = await walletCtx.wallet.signRecipe(
        recipe,
        (payload) => walletCtx.unshieldedKeystore.signData(payload),
      );
      return walletCtx.wallet.finalizeRecipe(signedRecipe);
    },
    submitTx: (tx: any) => walletCtx.wallet.submitTransaction(tx) as any,
  };
  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  const accountId = walletCtx.unshieldedKeystore.getBech32Address().toString();
  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'handshake-market-state',
      accountId,
      privateStoragePasswordProvider: () => privateStatePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(networkConfig.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
}

async function main() {
  if (!fs.existsSync(contractPath)) throw new Error('Market contract is not compiled. Run npm run compile:market first.');
  const deployment = getDeployment(network);
  if (!deployment) throw new Error(`No Handshake market deployment for ${network}. Run npm run setup -- --network ${network} first.`);

  const Market = await import(pathToFileURL(contractPath).href);
  const compiledContract = CompiledContract.make('handshake-market', Market.Contract).pipe(
    CompiledContract.withVacantWitnesses,
    CompiledContract.withCompiledFileAssets(zkConfigPath),
  );
  const walletRecord = getOrCreateWallet(network);
  const walletCtx = await createWallet({ network, networkConfig, seed: walletRecord.seed });

  try {
    console.log(`Connecting to ${network} Handshake market at ${deployment.address}…`);
    await walletCtx.wallet.waitForSyncedState();
    const providers = await createProviders(walletCtx);
    const deployed: any = await findDeployedContract(providers, {
      compiledContract: compiledContract as any,
      contractAddress: deployment.address,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: {},
    });

    let recovery = readRecovery();
    if (recovery && recovery.contractAddress !== deployment.address) {
      throw new Error(`Recovery secret belongs to ${recovery.contractAddress}; resolve that active intent before testing this deployment.`);
    }
    const beforeState = await providers.publicDataProvider.queryContractState(deployment.address);
    if (!beforeState) throw new Error('Indexer has no state for this deployment yet. Wait for sync and retry.');
    const before: any = Market.ledger(beforeState.data);
    if (recovery && before.tradeState === 0n) {
      // The previous run may have completed its cancellation but stopped before
      // deleting the recovery file. It is safe to start a fresh round trip.
      fs.rmSync(recoveryPath, { force: true });
      recovery = null;
    }
    const secret = recovery
      ? Buffer.from(recovery.takerSecretHex, 'hex')
      : randomBytes(32);

    if (recovery) {
      if (before.tradeState !== 1n) throw new Error(`Saved smoke secret exists, but tradeState is ${before.tradeState}; inspect the contract state before retrying.`);
      console.log('Found a saved active smoke-test intent; retrying its cancellation…');
    } else {
      if (before.tradeState !== 0n && before.tradeState !== 2n) throw new Error(`Offer is not open (tradeState=${before.tradeState}). Cancel or resolve its active intent first.`);
      const paymentAmountMinor = BigInt(process.env.HANDSHAKE_SMOKE_PAYMENT_MINOR ?? '100');
      const amount = paymentAmountMinor * before.exchangeRateBps;
      if (amount < before.minimumFill || amount > before.maximumFill || amount > before.availableLiquidity) {
        throw new Error(`Smoke amount ${amount} is outside current offer limits (${before.minimumFill}..${before.maximumFill}; available ${before.availableLiquidity}). Set HANDSHAKE_SMOKE_AMOUNT.`);
      }
      fs.writeFileSync(recoveryPath, JSON.stringify({
        contractAddress: deployment.address,
        takerSecretHex: secret.toString('hex'),
      } satisfies RecoveryState, null, 2), { mode: 0o600 });
      console.log(`Reserving ${amount} demo units…`);
      const reserveTx = await deployed.callTx.reserveIntent(
        new Uint8Array(secret),
        amount,
        paymentAmountMinor,
        { bytes: encodeUserAddress(walletCtx.unshieldedKeystore.getAddress()) },
      );
      console.log(`reserveIntent confirmed: ${reserveTx.public.txId}`);
    }

    console.log('Cancelling the test intent…');
    const cancelTx = await deployed.callTx.cancelIntent(new Uint8Array(secret));
    console.log(`cancelIntent confirmed: ${cancelTx.public.txId}`);
    fs.rmSync(recoveryPath, { force: true });

    let after: any = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      const afterState = await providers.publicDataProvider.queryContractState(deployment.address);
      after = afterState ? Market.ledger(afterState.data) : null;
      if (after?.tradeState === 0n) break;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    if (!after) throw new Error('Transactions confirmed, but the indexer has no contract state yet. Retry the smoke command to read it.');
    if (after.tradeState !== 0n) throw new Error(`Cancellation transaction was confirmed but indexer reports tradeState=${after.tradeState}; inspect the active intent before retrying.`);
    console.log(`Smoke test passed. Offer is open again; available liquidity: ${after.availableLiquidity}.`);
  } finally {
    await persistWalletState(network, walletCtx);
    await walletCtx.wallet.stop();
  }
}

main().catch((error) => {
  console.error('Market smoke test failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
