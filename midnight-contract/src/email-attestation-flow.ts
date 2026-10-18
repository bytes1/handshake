import {
  paymentAttestationMessage,
  paymentReceiptCommitment,
  readAttesterSecretKey,
  signPaymentAttestation,
  type PaymentAttestationInput,
  type VerifiedPaymentClaims,
} from './attestation-signing';
import { verifyProviderDkimEmail, type VerifiedDkimEmail } from './dkim-attester';

export type ParsedPayPalEmailClaims = VerifiedPaymentClaims & {
  status: 'COMPLETED';
};

export type ExpectedPayPalPayment = {
  contractId: Uint8Array;
  buyerCommitment: Uint8Array;
  intentNonce: bigint;
  tradeReference: string;
  amountMinor: bigint;
  recipient: string;
  nullifier: Uint8Array;
};

/** Provider-specific parsing is injected and must read only the signed message. */
export type PayPalEmailParser = (email: VerifiedDkimEmail) => Promise<ParsedPayPalEmailClaims> | ParsedPayPalEmailClaims;

/**
 * End-to-end attester boundary: verify DKIM, parse claims from the verified
 * email, compare them to the current intent, then sign the Compact message.
 * A missing/misconfigured parser fails closed instead of signing client claims.
 */
export async function attestPayPalEmail(input: {
  rawEmail: Buffer;
  allowedDkimDomains: readonly string[];
  expected: ExpectedPayPalPayment;
  parsePayPalEmail: PayPalEmailParser;
  secretKey?: bigint;
}) {
  const verified = await verifyProviderDkimEmail(input.rawEmail, input.allowedDkimDomains);
  const claims = await input.parsePayPalEmail(verified);
  if (claims.provider !== 'paypal' || claims.status !== 'COMPLETED') {
    throw new Error('Email does not contain a completed PayPal payment');
  }
  if (claims.tradeReference.trim() !== input.expected.tradeReference.trim()) {
    throw new Error('Email trade reference does not match this intent');
  }
  if (claims.amountMinor !== input.expected.amountMinor || claims.currency !== 'USD') {
    throw new Error('Email payment amount or currency does not match this intent');
  }
  if (claims.recipient.trim().toLowerCase() !== input.expected.recipient.trim().toLowerCase()) {
    throw new Error('Email payment recipient does not match this offer');
  }

  const receiptCommitment = paymentReceiptCommitment({
    ...claims,
    dkimBodyHash: verified.bodyHash,
  });
  const attestationInput: PaymentAttestationInput = {
    contractId: input.expected.contractId,
    buyerCommitment: input.expected.buyerCommitment,
    intentNonce: input.expected.intentNonce,
    amount: input.expected.amountMinor,
    providerId: 1n,
    receiptCommitment,
    nullifier: input.expected.nullifier,
  };
  const message = paymentAttestationMessage(attestationInput);
  const signed = signPaymentAttestation(input.secretKey ?? readAttesterSecretKey(), message);

  return {
    providerId: 1n,
    receiptCommitment,
    nullifier: input.expected.nullifier,
    signed,
    verifiedDkim: {
      from: verified.from,
      signingDomain: verified.signingDomain,
      selector: verified.selector,
    },
  };
}
