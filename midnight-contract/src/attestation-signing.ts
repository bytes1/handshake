import { createHash, randomBytes } from 'node:crypto';
import { ecMulGenerator, type JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import { pureCircuits } from '../contracts/managed/handshake-market/contract/index.js';

const JUBJUB_ORDER = 6554484396890773809930967563523245729705921265872317281365359162392183254199n;
const TWO_248 = 452312848583266388373324160190187140051835877600158453279131187530910662656n;

export type SchnorrSignature = {
  announcement: JubjubPoint;
  response: bigint;
};

export type SignedPaymentAttestation = {
  signature: SchnorrSignature;
  quotient: bigint;
  challengeRemainder: bigint;
};

const circuits = pureCircuits as typeof pureCircuits & {
  paymentAttestationMessage: (
    contractId: Uint8Array,
    buyerCommitment: Uint8Array,
    intentNonce: bigint,
    amount: bigint,
    providerId: bigint,
    receiptCommitment: Uint8Array,
    nullifier: Uint8Array,
  ) => bigint[];
  schnorrChallenge: (
    annX: bigint,
    annY: bigint,
    publicKeyX: bigint,
    publicKeyY: bigint,
    message: bigint[],
  ) => bigint;
};

export type PaymentAttestationInput = {
  contractId: Uint8Array;
  buyerCommitment: Uint8Array;
  intentNonce: bigint;
  amount: bigint;
  providerId: bigint;
  receiptCommitment: Uint8Array;
  nullifier: Uint8Array;
};

export function readAttesterSecretKey(value = process.env.HANDSHAKE_ATTESTER_SECRET_KEY): bigint {
  const normalized = value?.trim().replace(/^0x/i, '');
  if (!normalized || !/^[a-f0-9]{64}$/i.test(normalized)) {
    throw new Error('HANDSHAKE_ATTESTER_SECRET_KEY must be a 32-byte hex scalar');
  }
  const secretKey = BigInt(`0x${normalized}`);
  if (secretKey === 0n || secretKey >= JUBJUB_ORDER) {
    throw new Error('HANDSHAKE_ATTESTER_SECRET_KEY must be a nonzero canonical Jubjub scalar');
  }
  return secretKey;
}

export type VerifiedPaymentClaims = {
  provider: 'paypal';
  transactionId: string;
  tradeReference: string;
  amountMinor: bigint;
  currency: 'USD';
  recipient: string;
  dkimBodyHash: string;
};

/** Hash the normalized claims only after the provider-specific email parser validates them. */
export function paymentReceiptCommitment(claims: VerifiedPaymentClaims): Uint8Array {
  const transactionId = claims.transactionId.trim();
  const tradeReference = claims.tradeReference.trim();
  const recipient = claims.recipient.trim().toLowerCase();
  const dkimBodyHash = Buffer.from(claims.dkimBodyHash.trim(), 'base64');
  if (!/^[A-Za-z0-9._:-]{4,128}$/.test(transactionId)) throw new Error('Invalid PayPal transaction ID');
  if (!/^[A-Za-z0-9._:-]{4,128}$/.test(tradeReference)) throw new Error('Invalid trade reference');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error('Invalid recipient email');
  if (dkimBodyHash.length !== 32) throw new Error('Invalid DKIM body hash');
  if (claims.amountMinor <= 0n || claims.amountMinor >= 1n << 64n) throw new Error('Invalid payment amount');

  const canonical = [
    'handshake:paypal:email-payment:v1',
    transactionId,
    tradeReference,
    claims.amountMinor.toString(),
    claims.currency,
    recipient,
    dkimBodyHash.toString('hex'),
  ].join('\n');
  return new Uint8Array(createHash('sha256').update(canonical, 'utf8').digest());
}

export function paymentAttestationMessage(input: PaymentAttestationInput): bigint[] {
  for (const [name, value] of [
    ['contractId', input.contractId],
    ['buyerCommitment', input.buyerCommitment],
    ['receiptCommitment', input.receiptCommitment],
    ['nullifier', input.nullifier],
  ] as const) {
    if (value.length !== 32) throw new Error(`${name} must be exactly 32 bytes`);
  }
  if (input.intentNonce <= 0n || input.intentNonce >= 1n << 32n) throw new Error('Intent nonce must fit Uint<32> and be positive');
  if (input.amount <= 0n || input.amount >= 1n << 64n) throw new Error('Amount must fit Uint<64> and be positive');
  if (input.providerId !== 1n) throw new Error('Unsupported payment provider');

  return circuits.paymentAttestationMessage(
    input.contractId,
    input.buyerCommitment,
    input.intentNonce,
    input.amount,
    input.providerId,
    input.receiptCommitment,
    input.nullifier,
  );
}

function randomScalar(): bigint {
  return BigInt(`0x${randomBytes(32).toString('hex')}`) % JUBJUB_ORDER;
}

export function attesterPublicKey(secretKey: bigint): JubjubPoint {
  const normalized = ((secretKey % JUBJUB_ORDER) + JUBJUB_ORDER) % JUBJUB_ORDER;
  if (normalized === 0n) throw new Error('Attester Jubjub secret key cannot be zero');
  return ecMulGenerator(normalized);
}

/**
 * Sign a message produced by the contract's paymentAttestationMessage pure
 * circuit. Call this only after DKIM and provider-claim validation succeeds.
 */
export function signPaymentAttestation(
  secretKey: bigint,
  message: bigint[],
): SignedPaymentAttestation {
  if (message.length !== 4) throw new Error('Compact attestation message must contain four fields');
  const sk = ((secretKey % JUBJUB_ORDER) + JUBJUB_ORDER) % JUBJUB_ORDER;
  if (sk === 0n) throw new Error('Attester Jubjub secret key cannot be zero');

  const publicKey = ecMulGenerator(sk);
  const nonce = randomScalar();
  if (nonce === 0n) return signPaymentAttestation(sk, message);
  const announcement = ecMulGenerator(nonce);
  const fullChallenge = circuits.schnorrChallenge(
    announcement.x,
    announcement.y,
    publicKey.x,
    publicKey.y,
    message,
  );
  const challengeRemainder = fullChallenge % TWO_248;
  const response = (nonce + challengeRemainder * sk) % JUBJUB_ORDER;

  return {
    signature: { announcement, response },
    quotient: fullChallenge / TWO_248,
    challengeRemainder,
  };
}
