/**
 * Deploy midnight-contract contract to a Midnight network (undeployed by default; use --network preview|preprod for public networks).
 *
 * Non-interactive: scaffold → npm run setup runs straight through.
 * No readline prompts, no .midnight-seed file.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { resolveNetwork, getOrCreateWallet, formatWalletBackupNotice, getDeployment, recordDeployment } from './network';
import { createWallet, persistWalletState, unshieldedToken, type WalletContext } from './wallet';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import * as Rx from 'rxjs';

// Midnight SDK imports
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { decodeContractAddress, encodeContractAddress, encodeUserAddress, rawTokenType } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { constructJubjubPoint } from '@midnight-ntwrk/compact-runtime';

// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

// The current market contract has no witnesses, so private state is empty.
const PRIVATE_STATE_ID = 'handshakeMarketPrivateState';

// Upper bound on the DUST wait. A healthy local devnet produces DUST within
// seconds of registration; anything approaching this means the node, the
// wallet's NIGHT balance, or the faucet is the real problem, and failing with
// that message beats hanging.
const DUST_WAIT_TIMEOUT_MS = 5 * 60 * 1000;

// ─── Network configuration ─────────────────────────────────────────────────────
//
// Resolved from --network flag, .midnight-state.json, or defaulting to
// 'undeployed' (local devnet). Switch networks with: npm run network <name>

const { network, config: networkConfig } = resolveNetwork();
const forceFreshDemo = process.argv.includes('--fresh-demo');
const WALLET = getOrCreateWallet(network);
const SEED = WALLET.seed;
{
  const notice = formatWalletBackupNotice(WALLET, network);
  if (notice) console.log(notice);
}

// ─── Proof server readiness ────────────────────────────────────────────────────
//
// The proof-server image is distroless and has no shell, so it can't run a
// container-side healthcheck. Poll it from the host before we submit anything
// that needs proofs.

async function waitForProofServer(maxAttempts = 60, delayMs = 2000): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fetch(networkConfig.proofServer, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      return true;
    } catch (err: any) {
      const code = err?.cause?.code || err?.code || '';
      if (code !== 'ECONNREFUSED' && code !== 'UND_ERR_CONNECT_TIMEOUT' && code !== 'UND_ERR_SOCKET') {
        return true;
      }
    }
    if (attempt < maxAttempts) {
      process.stdout.write(`\r  Waiting for proof server... (${attempt}/${maxAttempts})   `);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return false;
}

// ─── Compiled contract loading ─────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'handshake-market');
const demoTokenZkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'handshake-demo-usdc');
const contractPath = path.join(zkConfigPath, 'contract', 'index.js');
const demoTokenContractPath = path.join(demoTokenZkConfigPath, 'contract', 'index.js');
const demoAssetsStatePath = path.resolve(__dirname, '..', '.midnight-demo-assets.json');

type DemoAssetsState = {
  version: 1;
  networks: Record<string, {
    tokenAddress: string;
    tokenDomainHex: string;
    tokenMinterSecretHex: string;
    tokenSupplyCap: string;
    marketAddress?: string;
    makerSecretHex?: string;
  }>;
};

function saveDemoAssetsState(state: DemoAssetsState) {
  const tempPath = `${demoAssetsStatePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempPath, demoAssetsStatePath);
}

if (!fs.existsSync(contractPath)) {
  console.error('\n❌ Market contract not compiled! Run: npm run compile:all\n');
  process.exit(1);
}
if (!fs.existsSync(demoTokenContractPath)) {
  console.error('\n❌ Demo token contract not compiled! Run: npm run compile:all\n');
  process.exit(1);
}

const HandshakeMarket = await import(pathToFileURL(contractPath).href);
const HandshakeDemoToken = await import(pathToFileURL(demoTokenContractPath).href);

const compiledContract = CompiledContract.make('handshake-market', HandshakeMarket.Contract).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);
const compiledDemoToken = CompiledContract.make('handshake-demo-usdc', HandshakeDemoToken.Contract).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(demoTokenZkConfigPath),
);

// ─── Providers ─────────────────────────────────────────────────────────────────

async function createProviders(
  walletCtx: WalletContext,
  contractZkConfigPath = zkConfigPath,
  privateStateStoreName = 'handshake-market-state',
) {
  // The SDK requires the private-state password to be at least 16 characters.
  // The default below is a placeholder for local devnet only — set a strong
  // password via PRIVATE_STATE_PASSWORD when you move to a non-local target.
  const privateStatePassword = process.env.PRIVATE_STATE_PASSWORD?.trim() || 'Local-Devnet-Development-Placeholder-1';

  const walletProvider = {
    // In Midnight.js 4.1.x the WalletProvider interface returns the key objects
    // (CoinPublicKey / EncPublicKey) directly — no longer hex strings.
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: any, ttl?: Date) {
      // Balancing selects and adds inputs; signRecipe then signs every
      // unshielded input (including demo-token UTXOs) before proving/finalizing.
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

  // Each compiled contract has its own keys/ and zkir/ directories. The
  // deployment provider must read from the same artifact directory as the
  // contract being proved (token mintDemo keys are not in the market bundle).
  const zkConfigProvider = new NodeZkConfigProvider(contractZkConfigPath);
  const accountId = walletCtx.unshieldedKeystore.getBech32Address().toString();

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName,
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

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(`║  Deploy midnight-contract to ${network}`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const seed = SEED;

  console.log('─── Wallet setup ───────────────────────────────────────────────\n');
  console.log('  Creating wallet...');
  const walletCtx = await createWallet({ network, networkConfig, seed });
  const restoredCount = Object.values(walletCtx.restored).filter(Boolean).length;
  if (restoredCount > 0) {
    console.log(`  Restored ${restoredCount}/3 child wallets from .midnight-wallet-state — sync will resume from saved point.`);
  }

  console.log('  Syncing with network...');
  console.log('  ℹ  This may take several minutes depending on network size.');
  console.log('     RPC disconnection messages during sync are normal and can be safely ignored.\n');
  const syncStart = Date.now();
  const syncInterval = setInterval(() => {
    const elapsed = Math.round((Date.now() - syncStart) / 1000);
    process.stdout.write(`\r  ⏳ Still syncing... (${elapsed}s elapsed)   `);
  }, 5000);
  const state = await walletCtx.wallet.waitForSyncedState();
  clearInterval(syncInterval);
  process.stdout.write('\r  ✓ Synced with network.                                      \n');

  // Persist sync state now so a later deploy failure doesn't waste the sync work.
  await persistWalletState(network, walletCtx);

  const address = walletCtx.unshieldedKeystore.getBech32Address();
  let balance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
  console.log(`\n  Wallet Address: ${address}`);
  console.log(`  Balance: ${balance.toLocaleString()} tNight\n`);

  if (network === 'undeployed' && balance === 0n) {
    console.error(
      '\n❌ Genesis-seed wallet has zero NIGHT. The devnet preset may not have minted to it.\n' +
        '   Check `docker compose ps` and `docker compose logs node`. Then `docker compose down -v` and retry.\n',
    );
    await walletCtx.wallet.stop();
    process.exit(1);
  }

  // Faucet poll for public networks. The wallet has 0 tNIGHT until the user
  // funds the address from the network's faucet. The display balance is
  // authoritative here (unlike DUST, tNIGHT shows up immediately once the
  // faucet tx lands).
  if (network !== 'undeployed' && networkConfig.faucet) {
    // Same balance idiom used by check-balance.ts:
    //   state.unshielded.balances[unshieldedToken().raw] ?? 0n
    const initialBalance = await Rx.firstValueFrom(walletCtx.wallet.state().pipe(
      Rx.filter((s) => s.isSynced),
    ));
    const initialTNight = initialBalance.unshielded.balances[unshieldedToken().raw] ?? 0n;
    if (initialTNight === 0n) {
      console.log('─── Fund Wallet ────────────────────────────────────────────────\n');
      console.log(`  Wallet address: ${address}`);
      console.log(`  Faucet:         ${networkConfig.faucet}`);
      console.log('');
      console.log('  Waiting for tNIGHT to arrive (poll every 10s)...');
      const rawTimeout = Number(process.env.MIDNIGHT_FAUCET_TIMEOUT_MS);
      const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 600_000;
      const start = Date.now();
      while (true) {
        await new Promise((r) => setTimeout(r, 10_000));
        const s = await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((x) => x.isSynced)));
        const tn = s.unshielded.balances[unshieldedToken().raw] ?? 0n;
        if (tn > 0n) {
          console.log(`\n  Funded! tNIGHT balance: ${tn.toLocaleString()}\n`);
          break;
        }
        if (Date.now() - start > timeoutMs) {
          console.log(`\n  ❌ Funding not received within ${Math.round(timeoutMs / 60_000)} min.`);
          console.log(`  Address: ${address}`);
          console.log(`  Faucet:  ${networkConfig.faucet}`);
          console.log('  Re-run setup after funding — your seed is preserved.\n');
          await walletCtx.wallet.stop();
          process.exit(1);
        }
        const elapsed = Math.round((Date.now() - start) / 1000);
        process.stdout.write(`\r  ...still waiting (${elapsed}s elapsed)`);
      }
    }
  }

  // Register for DUST.
  console.log('─── DUST Token Setup ───────────────────────────────────────────\n');
  const dustState = await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));

  const nightTokenType = unshieldedToken().raw;
  const unregisteredUtxos = dustState.unshielded.availableCoins.filter(
    (coin: any) => coin.utxo.type === nightTokenType && !coin.meta?.registeredForDustGeneration,
  );
  if (unregisteredUtxos.length > 0) {
    console.log(`  Registering ${unregisteredUtxos.length} NIGHT UTXOs for DUST generation...`);
    // The signDustRegistration callback (3rd arg) already produces a recipe
    // with N signatures matching N inputs. Do NOT call signRecipe again — that
    // would double-sign and the chain rejects with InputsSignaturesLengthMismatch
    // (Custom error 192). Matches upstream example-counter and example-bboard.
    const recipe = await walletCtx.wallet.registerNightUtxosForDustGeneration(
      unregisteredUtxos,
      walletCtx.unshieldedKeystore.getPublicKey(),
      (payload) => walletCtx.unshieldedKeystore.signData(payload),
    );
    const finalized = await walletCtx.wallet.finalizeRecipe(recipe);
    await walletCtx.wallet.submitTransaction(finalized);
  }

  if (dustState.dust.balance(new Date()) === 0n) {
    console.log('  Waiting for DUST tokens...');
    try {
      await Rx.firstValueFrom(
        walletCtx.wallet.state().pipe(
          Rx.throttleTime(5000),
          Rx.filter((s) => s.isSynced),
          Rx.filter((s) => s.dust.balance(new Date()) > 0n),
          // Without this the wait is unbounded: if DUST never generates the
          // stream simply never emits, and the process hangs with no diagnostic
          // until something external kills it (in CI, the job timeout).
          Rx.timeout({ first: DUST_WAIT_TIMEOUT_MS }),
        ),
      );
    } catch {
      const minutes = Math.round(DUST_WAIT_TIMEOUT_MS / 60000);
      console.log(`\n  ❌ No DUST generated after ${minutes} minutes.\n`);
      console.log('  DUST is generated by registered NIGHT UTXOs and pays transaction fees.');
      console.log('  Common causes:');
      console.log('    • The node is not producing blocks — check: docker compose ps');
      console.log('    • The wallet holds no NIGHT — check: npm run check-balance');
      if (network !== 'undeployed') {
        console.log(`    • The ${network} faucet has not funded this address yet`);
      }
      console.log('');
      await walletCtx.wallet.stop();
      process.exit(1);
    }
  }
  console.log('  DUST tokens ready!\n');

  // Deploy.
  console.log('─── Deploy Contract ────────────────────────────────────────────\n');

  console.log('  Checking proof server...');
  const proofServerReady = await waitForProofServer();
  if (!proofServerReady) {
    console.log('\n  ❌ Proof server not responding. Run: docker compose up -d\n');
    await walletCtx.wallet.stop();
    process.exit(1);
  }
  process.stdout.write('\r  Proof server ready!                                 \n');

  console.log('  Setting up providers...');
  const providers = await createProviders(walletCtx);
  const tokenProviders = await createProviders(
    walletCtx,
    demoTokenZkConfigPath,
    'handshake-demo-token-state',
  );

  // The wallet's reported DUST balance is a *time-projection* of what its
  // registered NIGHT will eventually generate; the tx-builder spends only
  // what the next block's timestamp accounts for, which lags wall-clock by
  // ~1 block on a fresh devnet. Sleeping ~1 block-time before attempt 1
  // closes that gap in the common case; the retry loop covers outliers.
  process.stdout.write('  Generating DUST...');
  await new Promise((r) => setTimeout(r, 6000));
  process.stdout.write(' done.\n');

  console.log('  Deploying test token and marketplace...\n');

  // Fallback timing. The 6s pre-pause above handles the common case; this
  // loop covers genuine outliers (slow blocks, proof-server worker-pool
  // settling). Earlier 2s retries caused CI flakes where attempt 2's /prove
  // hit the proof-server before it had drained attempt 1's state — 5s gives
  // it room to settle between attempts. 20 × 5 = 100s total budget.
  const MAX_RETRIES = 20;
  const RETRY_DELAY_MS = 5000;
  let deployed: any;
  let demoTokenDeployment: any;
  let tokenMinterSecret = new Uint8Array(randomBytes(32));
  let tokenDomain = new Uint8Array(randomBytes(32));
  let makerSecret = new Uint8Array(randomBytes(32));
  let savedDemoState: DemoAssetsState = { version: 1, networks: {} };
  if (fs.existsSync(demoAssetsStatePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(demoAssetsStatePath, 'utf8')) as DemoAssetsState;
      if (parsed.version === 1 && parsed.networks && typeof parsed.networks === 'object') savedDemoState = parsed;
    } catch {
      throw new Error(`Could not read ${demoAssetsStatePath}; move it aside before deploying again.`);
    }
  }
  const initialLiquidity = BigInt(process.env.HANDSHAKE_DEMO_LIQUIDITY ?? '1000000000000');
  const minimumFill = BigInt(process.env.HANDSHAKE_DEMO_MIN_FILL ?? '10060');
  const maximumFill = BigInt(process.env.HANDSHAKE_DEMO_MAX_FILL ?? initialLiquidity.toString());
  const tokenSupplyCap = BigInt(process.env.HANDSHAKE_TEST_TOKEN_CAP ?? initialLiquidity.toString());
  const exchangeRateBps = BigInt(process.env.HANDSHAKE_DEMO_RATE_BPS ?? '10060');
  const attesterPublicKeyX = process.env.HANDSHAKE_ATTESTER_PUBLIC_KEY_X?.trim();
  const attesterPublicKeyY = process.env.HANDSHAKE_ATTESTER_PUBLIC_KEY_Y?.trim();
  if (!attesterPublicKeyX || !attesterPublicKeyY) {
    throw new Error(
      'Set HANDSHAKE_ATTESTER_PUBLIC_KEY_X and HANDSHAKE_ATTESTER_PUBLIC_KEY_Y to the attester Jubjub public key before deploying.'
    );
  }
  const trustedAttester = constructJubjubPoint(BigInt(attesterPublicKeyX), BigInt(attesterPublicKeyY));
  if (
    initialLiquidity <= 0n || minimumFill <= 0n || minimumFill > maximumFill ||
    maximumFill > initialLiquidity || tokenSupplyCap < initialLiquidity ||
    exchangeRateBps <= 0n || exchangeRateBps >= (1n << 32n)
  ) {
    throw new Error('Invalid demo token/offer amounts. Require 0 < min <= max <= liquidity <= token supply cap and a positive Uint32 rate.');
  }

  // If a prior run deployed and minted the token but failed before market
  // deployment, reuse that saved token instead of creating another orphan.
  const previousDemo = savedDemoState.networks[network];
  if (forceFreshDemo && previousDemo) {
    const archiveKey = `${network}-archive-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    savedDemoState.networks[archiveKey] = previousDemo;
    console.log(`  Archived the previous ${network} demo secrets as ${archiveKey} in .midnight-demo-assets.json.`);
  }
  const savedToken = forceFreshDemo ? undefined : previousDemo;
  const recordedDeployment = getDeployment(network);
  if (
    savedToken?.marketAddress && savedToken.makerSecretHex &&
    recordedDeployment?.address === savedToken.marketAddress
  ) {
    // setup is safe to rerun after a completed deployment. The maker no longer
    // necessarily owns the original token amount: it is escrowed in the market
    // and may already have been released to buyers.
    console.log(`  Marketplace is already deployed at ${savedToken.marketAddress}; checking its current state...`);
    let existingMarketState: Awaited<ReturnType<typeof providers.publicDataProvider.queryContractState>> = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      existingMarketState = await providers.publicDataProvider.queryContractState(savedToken.marketAddress);
      if (existingMarketState) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!existingMarketState) {
      throw new Error(`The saved marketplace ${savedToken.marketAddress} is not visible in the indexer yet; refusing to deploy a duplicate.`);
    }
    const existingLedger = HandshakeMarket.ledger(existingMarketState.data);
    console.log(`  Existing marketplace: escrowed ${existingLedger.escrowedBalance}, available ${existingLedger.availableLiquidity} tUSDC base units.`);
    console.log('  No deployment or funding transaction is needed.');
    await persistWalletState(network, walletCtx);
    await walletCtx.wallet.stop();
    return;
  }
  const canResumeToken = Boolean(
    savedToken?.tokenAddress && savedToken.tokenDomainHex &&
    savedToken.tokenMinterSecretHex && savedToken.tokenSupplyCap === tokenSupplyCap.toString()
  );
  let tokenContractAddress: string;
  if (canResumeToken) {
    tokenDomain = new Uint8Array(Buffer.from(savedToken!.tokenDomainHex, 'hex'));
    tokenMinterSecret = new Uint8Array(Buffer.from(savedToken!.tokenMinterSecretHex, 'hex'));
    tokenContractAddress = savedToken!.tokenAddress;
    console.log(`  Reusing saved demo tUSDC token at ${tokenContractAddress}...`);
    demoTokenDeployment = await findDeployedContract(tokenProviders, {
      compiledContract: compiledDemoToken as any,
      contractAddress: tokenContractAddress as any,
      privateStateId: 'handshakeDemoTokenPrivateState',
      initialPrivateState: {},
    });
  } else {
    // This test token is deployed per marketplace so its issuer, token color,
    // and total supply cap are fixed for that demo instance.
    console.log('  Deploying capped Handshake test tUSDC token...');
    demoTokenDeployment = await deployContract(tokenProviders, {
      compiledContract: compiledDemoToken as any,
      args: [tokenMinterSecret, tokenDomain, tokenSupplyCap],
      privateStateId: 'handshakeDemoTokenPrivateState',
      initialPrivateState: {},
    });
    tokenContractAddress = demoTokenDeployment.deployTxData.public.contractAddress;
    // Persist the deployment details immediately; a later mint or market
    // error must not make this on-chain contract impossible to recover.
    savedDemoState.networks[network] = {
      tokenAddress: tokenContractAddress,
      tokenDomainHex: Buffer.from(tokenDomain).toString('hex'),
      tokenMinterSecretHex: Buffer.from(tokenMinterSecret).toString('hex'),
      tokenSupplyCap: tokenSupplyCap.toString(),
    };
    saveDemoAssetsState(savedDemoState);
  }

  let mintedBeforeFunding = 0n;
  if (canResumeToken) {
    let tokenState: Awaited<ReturnType<typeof tokenProviders.publicDataProvider.queryContractState>> = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      tokenState = await tokenProviders.publicDataProvider.queryContractState(tokenContractAddress);
      if (tokenState) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!tokenState) throw new Error(`Indexer has no state for saved demo token ${tokenContractAddress} yet.`);
    mintedBeforeFunding = BigInt(HandshakeDemoToken.ledger(tokenState.data).totalMinted);
  }
  if (mintedBeforeFunding > initialLiquidity) {
    throw new Error(`Saved demo token already minted ${mintedBeforeFunding} units, above configured offer liquidity ${initialLiquidity}.`);
  }
  const makerAddress = { bytes: encodeUserAddress(walletCtx.unshieldedKeystore.getAddress()) };
  const mintAmount = initialLiquidity - mintedBeforeFunding;
  if (mintAmount > 0n) {
    await (demoTokenDeployment as any).callTx.mintDemo(tokenMinterSecret, makerAddress, mintAmount);
  }
  const tokenRawType = rawTokenType(
    tokenDomain,
    decodeContractAddress(new Uint8Array(Buffer.from(tokenContractAddress.replace(/^0x/i, ''), 'hex'))),
  );
  await Rx.firstValueFrom(
    walletCtx.wallet.state().pipe(
      Rx.filter((current) => current.isSynced),
      Rx.filter((current) => (current.unshielded.balances[tokenRawType] ?? 0n) >= initialLiquidity),
      Rx.timeout({ first: 120_000 }),
    ),
  );
  savedDemoState.networks[network] = {
    tokenAddress: tokenContractAddress,
    tokenDomainHex: Buffer.from(tokenDomain).toString('hex'),
    tokenMinterSecretHex: Buffer.from(tokenMinterSecret).toString('hex'),
    tokenSupplyCap: tokenSupplyCap.toString(),
  };
  saveDemoAssetsState(savedDemoState);
  console.log(`  Test tUSDC deployed and ${initialLiquidity} base units minted to the maker wallet.`);

  if (savedToken?.marketAddress && savedToken.makerSecretHex) {
    // A previous run may have deployed the market and persisted its recovery
    // data, then failed while funding the escrow. Reconnect to that instance
    // instead of creating another token/market pair on every retry.
    makerSecret = new Uint8Array(Buffer.from(savedToken.makerSecretHex, 'hex'));
    console.log(`  Resuming saved marketplace at ${savedToken.marketAddress}...`);
    deployed = await findDeployedContract(providers, {
      compiledContract: compiledContract as any,
      contractAddress: savedToken.marketAddress as any,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: {},
    });
  }

  for (let attempt = 1; !deployed && attempt <= MAX_RETRIES; attempt++) {
    try {
      makerSecret = new Uint8Array(randomBytes(32));
      const offerExpiresAt = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
      deployed = await deployContract(providers, {
        compiledContract: compiledContract as any,
        args: [
          makerSecret,
          initialLiquidity,
          minimumFill,
          maximumFill,
          exchangeRateBps,
          trustedAttester,
          tokenDomain,
          { bytes: encodeContractAddress(tokenContractAddress) },
          offerExpiresAt,
        ],
        privateStateId: PRIVATE_STATE_ID,
        initialPrivateState: {},
      });
      break;
    } catch (err: any) {
      const errMsg = err?.message || err?.toString() || '';
      const errCause = err?.cause?.message || err?.cause?.toString() || '';
      const fullError = `${errMsg} ${errCause}`;

      // DUST shortage is the most common transient failure on a fresh devnet —
      // check it BEFORE proof-server connectivity, because dust-balancing errors
      // can surface through proof-server-shaped messages (the wallet talks to
      // the proof-server while building the dust portion of the tx).
      const isDustShortage =
        fullError.includes('Not enough Dust') ||
        fullError.includes('Insufficient Funds') ||
        fullError.includes('could not balance dust');

      // Quiet the first DUST-shortage retry: it's the expected race between
      // wall-clock projection and block-timestamp accounting and the loud
      // `Insufficient Funds: <huge number>` message scares first-time users.
      // Real failures still get the full diagnostic from attempt 2 onward.
      if (!(isDustShortage && attempt === 1)) {
        console.error(`\n  Attempt ${attempt} error: ${errMsg}`);
        if (errCause && errCause !== errMsg) console.error(`  Cause: ${errCause}`);
      }

      if (
        !isDustShortage &&
        (fullError.includes('Failed to connect to Proof Server') ||
          fullError.includes('connect ECONNREFUSED 127.0.0.1:6300'))
      ) {
        console.log('  ❌ Proof server unreachable. Run: docker compose up -d\n');
        await walletCtx.wallet.stop();
        process.exit(1);
      }

      if (isDustShortage) {
        const currentState = await walletCtx.wallet.waitForSyncedState();
        const dustBalance = currentState.dust.balance(new Date());
        if (attempt < MAX_RETRIES) {
          if (attempt === 1) {
            console.log(`  Still generating DUST, retrying in ${RETRY_DELAY_MS / 1000}s...`);
          } else {
            console.log(`  ⏳ DUST balance: ${dustBalance.toLocaleString()} (attempt ${attempt}/${MAX_RETRIES}); retrying in ${RETRY_DELAY_MS / 1000}s...`);
          }
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        } else {
          console.log(`  ❌ Not enough DUST after ${MAX_RETRIES} retries (current: ${dustBalance.toLocaleString()})`);
          await walletCtx.wallet.stop();
          process.exit(1);
        }
      } else {
        throw err;
      }
    }
  }

  if (!deployed) throw new Error('Deployment failed after all retries');

  const contractAddress = deployed.deployTxData.public.contractAddress;
  savedDemoState.networks[network] = {
    ...savedDemoState.networks[network],
    tokenAddress: tokenContractAddress,
    tokenDomainHex: Buffer.from(tokenDomain).toString('hex'),
    tokenMinterSecretHex: Buffer.from(tokenMinterSecret).toString('hex'),
    tokenSupplyCap: tokenSupplyCap.toString(),
    marketAddress: contractAddress,
    makerSecretHex: Buffer.from(makerSecret).toString('hex'),
  };
  saveDemoAssetsState(savedDemoState);
  let marketState: Awaited<ReturnType<typeof providers.publicDataProvider.queryContractState>> = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    marketState = await providers.publicDataProvider.queryContractState(contractAddress);
    if (marketState) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!marketState) throw new Error(`Indexer has no state for marketplace ${contractAddress} yet.`);
  const marketLedger = HandshakeMarket.ledger(marketState.data);
  if (BigInt(marketLedger.initialLiquidity) !== initialLiquidity) {
    throw new Error(
      `Saved marketplace was configured for ${marketLedger.initialLiquidity} units, but this run expects ${initialLiquidity}. Restore HANDSHAKE_DEMO_LIQUIDITY to the original value before resuming.`,
    );
  }
  const remainingEscrow = initialLiquidity - BigInt(marketLedger.escrowedBalance);
  if (remainingEscrow < 0n) {
    throw new Error(`Marketplace escrow (${marketLedger.escrowedBalance}) exceeds its configured capacity (${initialLiquidity}).`);
  }
  if (remainingEscrow > 0n) {
    const fundTx = await (deployed as any).callTx.fundOffer(makerSecret, remainingEscrow);
    console.log(`  Maker escrow funded: ${fundTx.public.txId}`);
  } else {
    console.log('  Maker escrow is already fully funded.');
  }
  console.log('  ✅ Contract deployed successfully!\n');
  console.log(`  Contract Address: ${contractAddress}\n`);
  console.log(`  Demo Token Address: ${tokenContractAddress}`);
  console.log(`  Demo Token Domain: ${Buffer.from(tokenDomain).toString('hex')}\n`);

  recordDeployment(network, contractAddress, address.toString());
  console.log('  Saved to .midnight-state.json\n');

  await persistWalletState(network, walletCtx);
  await walletCtx.wallet.stop();
  console.log('─── Deployment complete ────────────────────────────────────────\n');
  console.log('  Test token/market secrets are saved in the gitignored .midnight-demo-assets.json.');
  console.log('  Next: npm run market:payment-smoke -- --network ' + network + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
