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
import { createSyntheticPaypalEmail } from './synthetic-paypal-email';

// @ts-expect-error Required by Midnight wallet sync.
globalThis.WebSocket = WebSocket;

const PRIVATE_STATE_ID = 'handshake-market-state';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'handshake-market');
const contractPath = path.join(zkConfigPath, 'contract', 'index.js');
const recoveryPath = path.resolve(__dirname, '..', '.market-payment-smoke-state.json');
const { network, config: networkConfig } = resolveNetwork();

type RecoveryState = {
  contractAddress: string;
  takerSecretHex: string;
  amount: string;
  amountMinor: string;
  transactionId: string;
  tradeReference: string;
  recipient: string;
  nullifierHex: string;
};

type AttestationResponse = {
  providerId: string;
  receiptCommitment: string;
  nullifier: string;
  signature: { announcement: { x: string; y: string }; response: string };
  quotient: string;
  challengeRemainder: string;
  demoEvidence: string;
  error?: string;
};

function readRecovery(): RecoveryState | null {
  if (!fs.existsSync(recoveryPath)) return null;
  return JSON.parse(fs.readFileSync(recoveryPath, 'utf8')) as RecoveryState;
}

function writeRecovery(state: RecoveryState) {
  fs.writeFileSync(recoveryPath, JSON.stringify(state, null, 2), { mode: 0o600 });
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
  let takerSecret: Buffer | null = null;
  let proofAccepted = false;

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

    const existing = readRecovery();
    if (existing && existing.contractAddress !== deployment.address) {
      throw new Error(`Recovery intent belongs to ${existing.contractAddress}; resolve it before using this deployment.`);
    }
    let contractState = await providers.publicDataProvider.queryContractState(deployment.address);
    if (!contractState) throw new Error('Indexer has no state for this deployment yet. Wait for sync and retry.');
    let ledger: any = Market.ledger(contractState.data);
    let recovery = existing;

    if (recovery && ledger.tradeState === 2n) {
      fs.rmSync(recoveryPath, { force: true });
      console.log('The saved payment smoke-test intent was already accepted (tradeState 2). Proof test complete.');
      return;
    }
    if (recovery && ledger.tradeState === 0n) {
      fs.rmSync(recoveryPath, { force: true });
      recovery = null;
    }
    if (recovery && ledger.tradeState !== 1n) {
      throw new Error(`Cannot resume saved intent while tradeState is ${ledger.tradeState}. Inspect the deployed contract state.`);
    }

    if (recovery) {
      takerSecret = Buffer.from(recovery.takerSecretHex, 'hex');
      console.log(`Resuming saved payment test for ${recovery.tradeReference}…`);
    } else {
      if (ledger.tradeState !== 0n && ledger.tradeState !== 2n) {
        throw new Error(`Offer is not open (tradeState=${ledger.tradeState}). Use a fresh deployment or resolve the current intent first.`);
      }
      const amountMinor = BigInt(process.env.HANDSHAKE_PAYMENT_SMOKE_MINOR ?? '2500');
      const amount = amountMinor * ledger.exchangeRateBps;
      if (amount < ledger.minimumFill || amount > ledger.maximumFill || amount > ledger.availableLiquidity) {
        throw new Error(`Payment smoke amount ${amount} is outside offer limits (${ledger.minimumFill}..${ledger.maximumFill}; available ${ledger.availableLiquidity}). Set HANDSHAKE_PAYMENT_SMOKE_MINOR.`);
      }
      const dkimPrivateKey = process.env.HANDSHAKE_SYNTHETIC_DKIM_PRIVATE_KEY;
      if (!dkimPrivateKey) throw new Error('Set HANDSHAKE_SYNTHETIC_DKIM_PRIVATE_KEY (base64 PEM) in the environment.');
      takerSecret = randomBytes(32);
      recovery = {
        contractAddress: deployment.address,
        takerSecretHex: takerSecret.toString('hex'),
        amount: amount.toString(),
        amountMinor: amountMinor.toString(),
        transactionId: `TXN-${randomBytes(8).toString('hex')}`,
        tradeReference: `HS-${randomBytes(8).toString('hex')}`,
        recipient: process.env.HANDSHAKE_PAYMENT_SMOKE_RECIPIENT ?? 'buyer@example.test',
        nullifierHex: randomBytes(32).toString('hex'),
      };
      writeRecovery(recovery);
      console.log(`Reserving ${amount} demo units for ${recovery.tradeReference}…`);
      const reserveTx = await deployed.callTx.reserveIntent(
        new Uint8Array(takerSecret),
        amount,
        amountMinor,
        { bytes: encodeUserAddress(walletCtx.unshieldedKeystore.getAddress()) },
      );
      console.log(`reserveIntent confirmed: ${reserveTx.public.txId}`);
      contractState = null;
      for (let attempt = 0; attempt < 30; attempt++) {
        contractState = await providers.publicDataProvider.queryContractState(deployment.address);
        if (contractState && Market.ledger(contractState.data).tradeState === 1n) break;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      if (!contractState || Market.ledger(contractState.data).tradeState !== 1n) {
        throw new Error('Reservation was submitted, but the indexer has not reported tradeState 1 yet. Rerun to resume.');
      }
      ledger = Market.ledger(contractState.data);
    }

    const amount = BigInt(recovery.amount);
    const escrowBeforePayout = BigInt(ledger.escrowedBalance);
    const dkimPrivateKeyPem = Buffer.from(process.env.HANDSHAKE_SYNTHETIC_DKIM_PRIVATE_KEY ?? '', 'base64').toString('utf8');
    if (!dkimPrivateKeyPem.includes('PRIVATE KEY')) throw new Error('HANDSHAKE_SYNTHETIC_DKIM_PRIVATE_KEY must be a base64-encoded PEM private key.');
    const email = createSyntheticPaypalEmail({
      transactionId: recovery.transactionId,
      tradeReference: recovery.tradeReference,
      amountMinor: BigInt(recovery.amountMinor),
      recipient: recovery.recipient,
    }, dkimPrivateKeyPem);

    const contractId = Buffer.from(deployment.address.replace(/^0x/i, ''), 'hex');
    if (contractId.length !== 32) throw new Error('Deployment contract address must decode to 32 bytes.');
    const attesterUrl = (process.env.HANDSHAKE_ATTESTER_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
    console.log(`Requesting a synthetic email attestation from ${attesterUrl}…`);
    const response = await fetch(`${attesterUrl}/v1/paypal/attest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        emailBase64: email.toString('base64'),
        contractId: contractId.toString('hex'),
        buyerCommitment: Buffer.from(ledger.takerCommitment).toString('hex'),
        nullifier: recovery.nullifierHex,
        intentNonce: ledger.intentNonce.toString(),
        tradeReference: recovery.tradeReference,
        amountMinor: recovery.amountMinor,
        recipient: recovery.recipient,
      }),
    });
    const attestation = await response.json() as AttestationResponse;
    if (!response.ok) throw new Error(attestation.error ?? `Attester returned HTTP ${response.status}`);
    if (attestation.demoEvidence !== 'SYNTHETIC TEST EMAIL; not sent or DKIM-signed by PayPal') {
      throw new Error('Attester did not identify this as synthetic test evidence.');
    }
    console.log(`Attestation received (${attestation.demoEvidence}).`);

    console.log('Submitting submitPaymentProof from the buyer wallet…');
    const proofTx = await deployed.callTx.submitPaymentProof(
      new Uint8Array(takerSecret),
      BigInt(attestation.providerId),
      new Uint8Array(Buffer.from(attestation.receiptCommitment, 'hex')),
      new Uint8Array(Buffer.from(attestation.nullifier, 'hex')),
      {
        announcement: {
          x: BigInt(attestation.signature.announcement.x),
          y: BigInt(attestation.signature.announcement.y),
        },
        response: BigInt(attestation.signature.response),
      },
      BigInt(attestation.quotient),
      BigInt(attestation.challengeRemainder),
    );
    proofAccepted = true;
    console.log(`submitPaymentProof confirmed: ${proofTx.public.txId}`);

    let acceptedLedger: any = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      const acceptedState = await providers.publicDataProvider.queryContractState(deployment.address);
      if (acceptedState) {
        acceptedLedger = Market.ledger(acceptedState.data);
        if (acceptedLedger.tradeState === 2n) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    if (!acceptedLedger || acceptedLedger.tradeState !== 2n) {
      throw new Error('Proof transaction was confirmed, but the indexer has not reported tradeState 2 yet. Rerun to verify final state.');
    }
    if (BigInt(acceptedLedger.escrowedBalance) !== escrowBeforePayout - amount) {
      throw new Error('Payment proof was accepted but the escrow ledger did not decrease by the reserved tUSDC amount.');
    }
    const receiptCommitment = new Uint8Array(Buffer.from(attestation.receiptCommitment, 'hex'));
    if (!acceptedLedger.consumedNullifiers.member(new Uint8Array(Buffer.from(recovery.nullifierHex, 'hex'))) ||
        !acceptedLedger.consumedReceipts.member(receiptCommitment)) {
      throw new Error('Contract reached tradeState 2 but replay-protection keys were not visible in indexed state.');
    }
    fs.rmSync(recoveryPath, { force: true });
    console.log('Payment-proof smoke test passed. tUSDC was released; escrow decreased; nullifier and receipt are consumed.');
    console.log(`Synthetic receipt commitment: ${attestation.receiptCommitment}`);
  } catch (error) {
    if (!proofAccepted && takerSecret && fs.existsSync(recoveryPath)) {
      console.error('The saved recovery file preserves the buyer secret and intent fields so this run can be resumed.');
    }
    throw error;
  } finally {
    await persistWalletState(network, walletCtx);
    await walletCtx.wallet.stop();
  }
}

main().catch((error) => {
  console.error('Payment-proof smoke test failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
