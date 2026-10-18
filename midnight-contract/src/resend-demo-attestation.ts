import { createHash } from 'node:crypto';
import { dkimVerify } from 'mailauth/lib/dkim/verify.js';
import { simpleParser } from 'mailparser';
import { paymentAttestationMessage, readAttesterSecretKey, signPaymentAttestation } from './attestation-signing';
import { verifyDemoReceiptToken } from './demo-receipt-token';

function extractUniqueField(text: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...text.matchAll(new RegExp(`^${escaped}:[ \\t]*([^\\r\\n]*)$`, 'gim'))];
  if (matches.length !== 1 || !matches[0][1]) throw new Error(`Email must contain exactly one “${label}” field.`);
  return matches[0][1].trim();
}

/** Verify an uploaded raw Gmail message with DKIM, then bind its claims to this reservation. */
export async function attestUploadedGmailDemoReceipt(body: Record<string, unknown>) {
  if (typeof body.rawEmailBase64 !== 'string' || !body.rawEmailBase64 || body.rawEmailBase64.length > 2_800_000) {
    throw new Error('Upload the complete original .eml file (maximum 2 MiB).');
  }
  const rawEmail = Buffer.from(body.rawEmailBase64, 'base64');
  if (!rawEmail.length || rawEmail.length > 2 * 1024 * 1024 || rawEmail.toString('base64') !== body.rawEmailBase64) {
    throw new Error('Uploaded email file is empty, too large, or not valid base64.');
  }

  const verification = await dkimVerify(rawEmail, { strict: true });
  const gmailSignatures = verification.results.filter((item) => item.signingDomain?.toLowerCase() === 'gmail.com');
  const passingGmailSignatures = gmailSignatures.filter((item) =>
    item.status.result === 'pass' && !item.canonBodyLengthLimited,
  );
  const requiredSignedHeaders = ['from', 'to', 'subject'];
  const signature = passingGmailSignatures.find((item) => {
    const keys = item.signingHeaders?.keys as unknown;
    const signedHeaders = (Array.isArray(keys) ? keys : typeof keys === 'string' ? keys.split(':') : [])
      .map((name) => String(name).trim().toLowerCase());
    return requiredSignedHeaders.every((name) => signedHeaders.includes(name));
  });
  if (!signature) {
    if (passingGmailSignatures.length) {
      throw new Error('The passing Gmail DKIM signature must cover the From, To, and Subject headers.');
    }
    const failed = gmailSignatures[0];
    if (failed) throw new Error(`Gmail DKIM verification failed (${failed.status.comment ?? failed.status.result}). The signed email may have been modified; upload the unmodified original .eml file.`);
    throw new Error('No Gmail DKIM signature was found. Upload the complete original .eml file.');
  }
  if (verification.fromFields !== 1 || verification.headerFrom.length !== 1 || verification.fromSyntax !== 'valid') {
    throw new Error('Email must have exactly one valid From address.');
  }

  const parsed = await simpleParser(rawEmail);
  const expectedSender = process.env.HANDSHAKE_DEMO_RECEIPT_FROM?.trim().toLowerCase() ?? process.env.GMAIL_EMAIL?.trim().toLowerCase();
  if (!expectedSender) throw new Error('Set HANDSHAKE_DEMO_RECEIPT_FROM to the receipt sender Gmail address in midnight-contract/.env.');
  const fromAddresses = parsed.from?.value ?? [];
  if (fromAddresses.length !== 1 || fromAddresses[0].address?.toLowerCase() !== expectedSender ||
      verification.headerFrom[0].toLowerCase() !== expectedSender) {
    throw new Error('DKIM-verified From address does not match the configured receipt sender.');
  }

  const text = parsed.text ?? '';
  const receiptToken = extractUniqueField(text, 'Receipt verification token');
  const claims = verifyDemoReceiptToken(receiptToken);
  if (!parsed.subject?.startsWith('Handshake DEMO receipt') || !parsed.subject.includes(claims.receiptId)) {
    throw new Error('Email subject does not match the signed demo receipt.');
  }
  const recipient = extractUniqueField(text, 'Recipient');
  const toObjects = parsed.to ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to]) : [];
  const toAddresses = toObjects.flatMap((address) => address.value);
  if (toAddresses.length !== 1 || toAddresses[0].address?.toLowerCase() !== claims.recipient.toLowerCase()) {
    throw new Error('Email To header does not match the signed receipt recipient.');
  }
  if (!text.includes('DEMO RECEIPT — NO PAYMENT WAS MADE')) {
    throw new Error('Email is not marked as a no-payment demo receipt.');
  }
  const status = extractUniqueField(text, 'Status');
  const receiptId = extractUniqueField(text, 'Receipt ID');
  const tradeReference = extractUniqueField(text, 'Trade reference');
  const amountMinor = extractUniqueField(text, 'Amount minor units');
  const currency = extractUniqueField(text, 'Currency');
  if (status !== 'DEMO_COMPLETED' || receiptId !== claims.receiptId || tradeReference !== claims.tradeReference ||
      !/^\d+$/.test(amountMinor) || amountMinor !== claims.amountMinor || currency !== 'USD' ||
      recipient.toLowerCase() !== claims.recipient.toLowerCase()) {
    throw new Error('DKIM-verified email fields do not match the signed receipt claims.');
  }
  if (body.buyerAddress !== claims.buyerAddress || body.tradeReference !== claims.tradeReference ||
      body.amountMinor !== claims.amountMinor || typeof body.recipient !== 'string' ||
      body.recipient.toLowerCase() !== claims.recipient.toLowerCase()) {
    throw new Error('Verified receipt does not match the reserved buyer, trade, amount, and email.');
  }
  return signDemoReceiptAttestation(claims, body, 'GMAIL DKIM VERIFIED DEMO RECEIPT; no payment was made');
}

function signDemoReceiptAttestation(
  claims: ReturnType<typeof verifyDemoReceiptToken>,
  body: Record<string, unknown>,
  demoEvidence: string,
) {
  const as32 = (name: string) => {
    const value = body[name];
    if (typeof value !== 'string' || !/^(?:[a-f0-9]{2}){32}$/i.test(value)) throw new Error(`${name} must be 32-byte hex.`);
    return new Uint8Array(Buffer.from(value, 'hex'));
  };
  const contractId = as32('contractId');
  const buyerCommitment = as32('buyerCommitment');
  const nullifier = as32('nullifier');
  const intentNonce = BigInt(String(body.intentNonce));
  const amountMinor = BigInt(claims.amountMinor);
  const receiptCommitment = new Uint8Array(createHash('sha256').update([
    'handshake:resend:demo-receipt:v1', claims.receiptId, claims.tradeReference,
    claims.amountMinor, claims.currency, claims.recipient.toLowerCase(), claims.buyerAddress,
  ].join('\n')).digest());
  const message = paymentAttestationMessage({
    contractId, buyerCommitment, intentNonce, amount: amountMinor,
    providerId: 1n, receiptCommitment, nullifier,
  });
  const signed = signPaymentAttestation(readAttesterSecretKey(), message);
  return {
    providerId: '1',
    receiptCommitment: Buffer.from(receiptCommitment).toString('hex'),
    nullifier: Buffer.from(nullifier).toString('hex'),
    signature: {
      announcement: { x: signed.signature.announcement.x.toString(), y: signed.signature.announcement.y.toString() },
      response: signed.signature.response.toString(),
    },
    quotient: signed.quotient.toString(),
    challengeRemainder: signed.challengeRemainder.toString(),
    demoEvidence,
  };
}
