import { bech32m } from "@scure/base";
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import { findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { fromHex, toHex } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import { Binding, decodeContractAddress, Proof, rawTokenType, SignatureEnabled, Transaction } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { ZKConfigProvider } from "@midnight-ntwrk/midnight-js-types";
import * as Market from "../../midnight-contract/contracts/managed/handshake-market/contract/index.js";
import type { ConnectedMidnightWallet, MidnightNetworkId } from "@/lib/midnight-wallet";

const NETWORK_IDS: MidnightNetworkId[] = ["undeployed", "preview", "preprod"];
const requestedNetwork = process.env.NEXT_PUBLIC_MIDNIGHT_NETWORK ?? "preview";
export const NETWORK_ID: MidnightNetworkId = NETWORK_IDS.includes(requestedNetwork as MidnightNetworkId)
  ? requestedNetwork as MidnightNetworkId
  : "preview";
export const NETWORK_LABEL = NETWORK_ID === "preview"
  ? "Preview testnet"
  : NETWORK_ID === "preprod" ? "Preprod testnet" : "Undeployed localnet";
const MARKET_ADDRESSES: Partial<Record<MidnightNetworkId, string>> = {
  undeployed: "f8b526e99c5c7e8e3fd3a15a4e0de33a719e23cb068223d76b36c977150a8a47",
  // Concurrent-intent Preview deployment created by `setup --fresh-demo` on 2026-10-17.
  preview: "5bc81b4a60166225d0063d189190e347f65c567b1f6e9717095bed9acb057894",
};
export const MARKET_ADDRESS = process.env.NEXT_PUBLIC_MARKET_CONTRACT_ADDRESS ?? MARKET_ADDRESSES[NETWORK_ID] ?? "";
const DEMO_TOKEN_ADDRESS = process.env.NEXT_PUBLIC_DEMO_TOKEN_ADDRESS ?? (
  NETWORK_ID === "preview" ? "6feb3cc3d2d9f4d2c9f27332757adb898354b5d3a10376f75d66d299689ec82f" : ""
);
const DEMO_TOKEN_DOMAIN_HEX = process.env.NEXT_PUBLIC_DEMO_TOKEN_DOMAIN_HEX ?? (
  NETWORK_ID === "preview" ? "aff26d3a51388c32b94a8fe2cda8ed082ce644e07becaab28eb9486072e57082" : ""
);
const PROOF_SERVER_URI = process.env.NEXT_PUBLIC_MIDNIGHT_PROOF_SERVER_URL ?? "http://127.0.0.1:6300";
setNetworkId(NETWORK_ID);
const PRIVATE_STATE_ID = "handshake-market-browser";
const ARTIFACT_ROOT = "/market-artifacts";
const TOKEN_DECIMALS = 6;

export type MarketSnapshot = {
  address: string;
  availableLiquidity: string;
  escrowedBalance: string;
  initialLiquidity: string;
  minimumFill: string;
  maximumFill: string;
  exchangeRateBps: string;
  tradeState: number;
  activeIntentCount: string;
  buyerIntentActive: boolean;
  buyerAddress: string;
  intentAmount: string;
  intentPaymentMinor: string;
  intentRecipient: string;
  intentNonce: string;
  offerExpiresAt: string;
};

type ConnectorConfig = {
  indexerUri: string;
  indexerWsUri: string;
  proverServerUri?: string;
  networkId?: string;
};

type ActiveIntent = {
  contractAddress: string;
  takerSecret: string;
  nullifier: string;
  paymentMinor: string;
  amount: string;
  reservationTxId?: string;
  intentNonce?: string;
  tradeReference: string;
  recipientEmail: string;
  buyerAddress?: string;
  receiptToken?: string;
  resendEmailId?: string;
};

const INTENT_STORAGE_KEY = "handshake:market-intent:v1";
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const randomHex = (length: number) => {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return hex(bytes);
};
const bytesFromHex = (value: string) => new Uint8Array(value.match(/.{2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? []);

class BrowserZkConfigProvider extends ZKConfigProvider<string> {
  private async read(path: string) {
    // These files are replaced in place when the marketplace contract is
    // recompiled. Caching them indefinitely can pair an older verifier key
    // with a newly deployed contract and make every circuit look invalid.
    const response = await fetch(`${ARTIFACT_ROOT}/${path}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load Midnight proof artifact ${path} (${response.status}).`);
    return new Uint8Array(await response.arrayBuffer());
  }
  // Midnight.js / the proof server consume the compiler's binary ZKIR asset.
  // The adjacent .zkir file is the human-readable JSON form and is not valid
  // input for the proof server's /check endpoint.
  getZKIR(circuitId: string) { return this.read(`zkir/${circuitId}.bzkir`) as never; }
  getProverKey(circuitId: string) { return this.read(`keys/${circuitId}.prover`) as never; }
  getVerifierKey(circuitId: string) { return this.read(`keys/${circuitId}.verifier`) as never; }
}

function privateStateProvider() {
  const values = new Map<string, unknown>();
  return {
    setContractAddress: () => undefined,
    get: async (id: string) => values.get(id) ?? null,
    set: async (id: string, value: unknown) => { values.set(id, value); },
    remove: async (id: string) => { values.delete(id); },
    clear: async () => { values.clear(); },
    setSigningKey: async () => undefined,
    getSigningKey: async () => null,
  };
}

async function providers(wallet: ConnectedMidnightWallet) {
  const config = await wallet.getConfiguration() as ConnectorConfig;
  if (config.networkId && config.networkId !== NETWORK_ID) {
    throw new Error(`Lace is connected to ${config.networkId}; choose ${NETWORK_LABEL} in Lace and reconnect.`);
  }
  if (!MARKET_ADDRESS) throw new Error(`No marketplace address is configured for ${NETWORK_LABEL}. Set NEXT_PUBLIC_MARKET_CONTRACT_ADDRESS.`);
  if (!config.indexerUri || !config.indexerWsUri) throw new Error(`Lace did not provide the ${NETWORK_LABEL} indexer configuration. Check its network and indexer settings.`);
  const zkConfigProvider = new BrowserZkConfigProvider();
  const shielded = await wallet.getShieldedAddresses();
  const walletProvider = {
    getCoinPublicKey: () => shielded.shieldedCoinPublicKey,
    getEncryptionPublicKey: () => shielded.shieldedEncryptionPublicKey,
    async balanceTx(tx: { serialize(): Uint8Array }) {
      const balanced = await wallet.balanceUnsealedTransaction(toHex(tx.serialize()));
      return Transaction.deserialize<SignatureEnabled, Proof, Binding>("signature", "proof", "binding", fromHex(balanced.tx));
    },
  };
  const midnightProvider = {
    async submitTx(tx: { serialize(): Uint8Array; identifiers(): string[] }) {
      await wallet.submitTransaction(toHex(tx.serialize()));
      return tx.identifiers()[0];
    },
  };
  return {
    config,
    zkConfigProvider,
    publicDataProvider: indexerPublicDataProvider(config.indexerUri, config.indexerWsUri),
    privateStateProvider: privateStateProvider(),
    proofProvider: httpClientProofProvider(config.proverServerUri ?? PROOF_SERVER_URI, zkConfigProvider),
    walletProvider,
    midnightProvider,
  };
}

async function contractFor(wallet: ConnectedMidnightWallet) {
  const p = await providers(wallet);
  const compiled = CompiledContract.make("handshake-market", Market.Contract).pipe(
    CompiledContract.withVacantWitnesses,
    CompiledContract.withCompiledFileAssets(`${window.location.origin}${ARTIFACT_ROOT}`),
  );
  const contract = await findDeployedContract(p as any, {
    compiledContract: compiled as never,
    contractAddress: MARKET_ADDRESS as never,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: {},
  });
  return { ...p, contract };
}

export async function readMarket(wallet: ConnectedMidnightWallet, buyerAddress?: string): Promise<MarketSnapshot> {
  const { publicDataProvider } = await providers(wallet);
  const state = await publicDataProvider.queryContractState(MARKET_ADDRESS as never);
  if (!state) throw new Error(`The ${NETWORK_LABEL} indexer has not found marketplace ${MARKET_ADDRESS} yet. Confirm Lace uses the same network and that this contract address is deployed there.`);
  const ledger = Market.ledger(state.data) as any;
  const address = buyerAddress ?? (await wallet.getUnshieldedAddress()).unshieldedAddress;
  const recipientKey = address ? userAddressBytes(address).bytes : new Uint8Array(32);
  const buyerIntentActive = Boolean(address && ledger.intentActive.member(recipientKey) && ledger.intentActive.lookup(recipientKey));
  return {
    address: MARKET_ADDRESS,
    availableLiquidity: ledger.availableLiquidity.toString(),
    escrowedBalance: ledger.escrowedBalance.toString(),
    initialLiquidity: ledger.initialLiquidity.toString(),
    minimumFill: ledger.minimumFill.toString(),
    maximumFill: ledger.maximumFill.toString(),
    exchangeRateBps: ledger.exchangeRateBps.toString(),
    tradeState: Number(ledger.tradeState),
    activeIntentCount: ledger.activeIntentCount.toString(),
    buyerIntentActive,
    buyerAddress: address,
    intentAmount: buyerIntentActive ? ledger.intentAmounts.lookup(recipientKey).toString() : "0",
    intentPaymentMinor: buyerIntentActive ? ledger.intentPaymentMinors.lookup(recipientKey).toString() : "0",
    intentRecipient: buyerIntentActive ? hex(recipientKey) : "",
    intentNonce: ledger.intentNonce.toString(),
    offerExpiresAt: ledger.offerExpiresAt.toString(),
  };
}

export function isReservedIntentBuyer(snapshot: MarketSnapshot, buyerAddress: string): boolean {
  if (!snapshot.buyerIntentActive || !buyerAddress) return false;
  try {
    return snapshot.intentRecipient === hex(userAddressBytes(buyerAddress).bytes);
  } catch {
    return false;
  }
}

export function loadActiveIntent(buyerAddress?: string): ActiveIntent | null {
  try {
    const key = buyerAddress ? `${INTENT_STORAGE_KEY}:${hex(userAddressBytes(buyerAddress).bytes)}` : INTENT_STORAGE_KEY;
    const raw = sessionStorage.getItem(key) ?? localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveIntent;
    return parsed.contractAddress === MARKET_ADDRESS ? parsed : null;
  } catch { return null; }
}

function saveActiveIntent(intent: ActiveIntent): void {
  const serialized = JSON.stringify(intent);
  const key = intent.buyerAddress ? `${INTENT_STORAGE_KEY}:${hex(userAddressBytes(intent.buyerAddress).bytes)}` : INTENT_STORAGE_KEY;
  sessionStorage.setItem(key, serialized);
  try { localStorage.setItem(key, serialized); } catch { /* Session storage still supports this tab. */ }
}

export function updateSavedActiveIntent(intent: ActiveIntent, update: Partial<Pick<ActiveIntent, "recipientEmail" | "receiptToken" | "resendEmailId">>): ActiveIntent {
  const next = { ...intent, ...update };
  saveActiveIntent(next);
  return next;
}

export function clearSavedActiveIntent(buyerAddress?: string): void {
  const key = buyerAddress ? `${INTENT_STORAGE_KEY}:${hex(userAddressBytes(buyerAddress).bytes)}` : INTENT_STORAGE_KEY;
  sessionStorage.removeItem(key);
  try { localStorage.removeItem(key); } catch { /* Ignore unavailable persistent storage. */ }
}

export function paymentMinorFromDollars(input: string): bigint {
  if (!/^\d+(?:\.\d{1,2})?$/.test(input)) throw new Error("Enter an amount with up to two decimal places.");
  const [whole, fraction = ""] = input.split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
}

export function quoteTokenAmount(paymentMinor: bigint, exchangeRateBps: bigint): bigint {
  return paymentMinor * exchangeRateBps;
}

export function formatTokenAmount(baseUnits: string | bigint): string {
  const raw = typeof baseUnits === "string" ? BigInt(baseUnits) : baseUnits;
  const scale = 10n ** BigInt(TOKEN_DECIMALS);
  const whole = raw / scale;
  const fraction = (raw % scale).toString().padStart(TOKEN_DECIMALS, "0").replace(/0+$/, "");
  return fraction ? `${whole.toLocaleString("en-US")}.${fraction}` : whole.toLocaleString("en-US");
}

export async function readBuyerDemoTokenBalance(wallet: ConnectedMidnightWallet): Promise<string> {
  if (!wallet.getUnshieldedBalances) {
    throw new Error("This Lace connection does not expose unshielded balances. Reconnect Lace and approve balance access.");
  }
  if (!DEMO_TOKEN_ADDRESS || !/^(?:[a-f0-9]{2}){32}$/i.test(DEMO_TOKEN_DOMAIN_HEX)) {
    throw new Error(`The demo tUSDC token metadata is not configured for ${NETWORK_LABEL}. Set NEXT_PUBLIC_DEMO_TOKEN_ADDRESS and NEXT_PUBLIC_DEMO_TOKEN_DOMAIN_HEX.`);
  }
  const tokenType = rawTokenType(
    bytesFromHex(DEMO_TOKEN_DOMAIN_HEX),
    decodeContractAddress(bytesFromHex(DEMO_TOKEN_ADDRESS)),
  );
  const balances = await wallet.getUnshieldedBalances();
  const value = balances[tokenType];
  let baseUnits = 0n;
  if (typeof value === "bigint" || typeof value === "string" || typeof value === "number") {
    baseUnits = BigInt(value);
  }
  return formatTokenAmount(baseUnits);
}

function userAddressBytes(bech32Address: string): { bytes: Uint8Array } {
  const decoded = bech32m.decodeToBytes(bech32Address);
  return { bytes: decoded.bytes };
}

export async function reserveMarketIntent(wallet: ConnectedMidnightWallet, input: string, buyerAddress: string) {
  const market = await readMarket(wallet, buyerAddress);
  if (market.buyerIntentActive) throw new Error("This wallet already has an active reservation for this offer. Continue or cancel it first.");
  const paymentMinor = paymentMinorFromDollars(input);
  const amount = quoteTokenAmount(paymentMinor, BigInt(market.exchangeRateBps));
  if (amount < BigInt(market.minimumFill) || amount > BigInt(market.maximumFill) || amount > BigInt(market.availableLiquidity)) {
    throw new Error("That amount is outside this offer’s fill range or available liquidity.");
  }
  const intent: ActiveIntent = {
    contractAddress: MARKET_ADDRESS,
    takerSecret: randomHex(32),
    nullifier: randomHex(32),
    paymentMinor: paymentMinor.toString(),
    amount: amount.toString(),
    tradeReference: `HS-${randomHex(8).toUpperCase()}`,
    recipientEmail: "",
    buyerAddress,
  };
  saveActiveIntent(intent);
  const { contract } = await contractFor(wallet);
  let tx: any;
  try {
    tx = await (contract as any).callTx.reserveIntent(
      bytesFromHex(intent.takerSecret), amount, paymentMinor, userAddressBytes(buyerAddress),
    );
  } catch (error) {
    const messages: string[] = [];
    let cause: unknown = error;
    while (cause instanceof Error) {
      messages.push(cause.message);
      cause = cause.cause;
    }
    // A ZKIR/proof-server check rejection happens before wallet submission;
    // don't leave a phantom buyer intent that the UI could later misrestore.
    if (/Failed Proof Server response|Unsupported ZKIR version|status=.?Bad Request/i.test(messages.join(" "))) {
      clearSavedActiveIntent(buyerAddress);
    }
    throw error;
  }
  intent.reservationTxId = tx.public.txId;
  saveActiveIntent(intent);
  return { intent, txId: tx.public.txId as string };
}

export async function cancelMarketIntent(wallet: ConnectedMidnightWallet, intent: ActiveIntent) {
  const { contract } = await contractFor(wallet);
  if (!intent.buyerAddress) throw new Error("This saved reservation is missing its buyer wallet address.");
  const tx = await (contract as any).callTx.cancelIntent(bytesFromHex(intent.takerSecret), userAddressBytes(intent.buyerAddress));
  clearSavedActiveIntent(intent.buyerAddress);
  return tx.public.txId as string;
}

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

export async function attestAndSubmitDemoPayment(wallet: ConnectedMidnightWallet, intent: ActiveIntent, rawEmailBase64: string) {
  if (!rawEmailBase64) throw new Error("Upload the original Gmail .eml file to verify this receipt.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(intent.recipientEmail)) throw new Error("Send the demo receipt to a valid email address before uploading its .eml file.");
  const { publicDataProvider, contract } = await contractFor(wallet);
  if (!intent.buyerAddress) throw new Error("This saved reservation is missing its buyer wallet address.");
  const recipientKey = userAddressBytes(intent.buyerAddress).bytes;
  let ledger: any = null;
  let observed: any = null;
  // Watching the reservation tx gives a useful signal that the configured
  // indexer has seen it; the contract-state check below still verifies the
  // exact amount before contacting the attester.
  if (intent.reservationTxId) {
    await Promise.race([
      (publicDataProvider as any).watchForTxData(intent.reservationTxId).catch(() => undefined),
      new Promise((resolve) => window.setTimeout(resolve, 20_000)),
    ]);
  }
  for (let attempt = 0; attempt < 40; attempt++) {
    const state = await publicDataProvider.queryContractState(MARKET_ADDRESS as never);
    if (state) {
      const indexed = Market.ledger(state.data) as any;
      observed = indexed;
      if (indexed.intentActive.member(recipientKey) && indexed.intentActive.lookup(recipientKey) &&
          indexed.intentAmounts.lookup(recipientKey).toString() === intent.amount) {
        ledger = indexed;
        break;
      }
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
  }
  if (!ledger) {
    const tx = intent.reservationTxId ? ` Reservation transaction: ${intent.reservationTxId}.` : " This saved intent has no reservation transaction ID.";
    const state = observed ? ` Active reservations on offer: ${observed.activeIntentCount.toString()}.` : " The indexer returned no marketplace state.";
    throw new Error(`The indexer has not confirmed this reservation.${tx}${state} Keep this tab open and check that Lace and the marketplace use the same ${NETWORK_LABEL} network.`);
  }
  const attesterUrl = process.env.NEXT_PUBLIC_ATTESTER_URL ?? "http://127.0.0.1:8787";
  const attestationInput = {
    buyerAddress: intent.buyerAddress,
    contractId: MARKET_ADDRESS,
    buyerCommitment: hex(ledger.intentCommitments.lookup(recipientKey)),
    nullifier: intent.nullifier,
    intentNonce: ledger.intentNonces.lookup(recipientKey).toString(),
    tradeReference: intent.tradeReference,
    amountMinor: intent.paymentMinor,
    recipient: intent.recipientEmail,
  };
  let response: Response;
  try {
    response = await fetch(`${attesterUrl}/v1/demo/resend/dkim-attest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...attestationInput, rawEmailBase64 }),
    });
  } catch {
    throw new Error("The reservation is safe, but the attester could not be reached. In midnight-contract, run `npm run attester:start`, then retry.");
  }
  const attestation = await response.json() as AttestationResponse;
  if (!response.ok) throw new Error(attestation.error ?? `Attester returned HTTP ${response.status}.`);
  if (!attestation.demoEvidence?.includes("GMAIL DKIM VERIFIED")) throw new Error("Attester did not return a Gmail-DKIM-verified receipt.");
  const tx = await (contract as any).callTx.submitPaymentProof(
    bytesFromHex(intent.takerSecret),
    userAddressBytes(intent.buyerAddress),
    BigInt(attestation.providerId),
    bytesFromHex(attestation.receiptCommitment),
    bytesFromHex(attestation.nullifier),
    {
      announcement: { x: BigInt(attestation.signature.announcement.x), y: BigInt(attestation.signature.announcement.y) },
      response: BigInt(attestation.signature.response),
    },
    BigInt(attestation.quotient),
    BigInt(attestation.challengeRemainder),
  );
  clearSavedActiveIntent(intent.buyerAddress);
  return { txId: tx.public.txId as string, evidence: attestation.demoEvidence };
}

export { MARKET_ADDRESS as deployedMarketAddress };
