import { createHmac, timingSafeEqual } from 'node:crypto';

export type DemoReceiptClaims = {
  receiptId: string;
  tradeReference: string;
  amountMinor: string;
  currency: 'USD';
  recipient: string;
  buyerAddress: string;
  issuedAt: number;
};

export function verifyDemoReceiptToken(token: unknown): DemoReceiptClaims {
  const secret = process.env.RESEND_DEMO_RECEIPT_SECRET;
  if (!secret || secret.length < 32) throw new Error('RESEND_DEMO_RECEIPT_SECRET must be at least 32 characters in midnight-contract/.env.');
  if (typeof token !== 'string' || token.length > 4096) throw new Error('Receipt token is missing or invalid.');
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra) throw new Error('Receipt token is malformed.');
  const expected = createHmac('sha256', secret).update(encoded).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, 'base64url'); } catch { throw new Error('Receipt token is malformed.'); }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Receipt token signature is invalid.');
  let claims: DemoReceiptClaims;
  try { claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as DemoReceiptClaims; }
  catch { throw new Error('Receipt token claims are invalid.'); }
  if (!claims.receiptId || !/^HS-[A-F0-9]{16}$/i.test(claims.tradeReference) || !/^\d+$/.test(claims.amountMinor) ||
      claims.currency !== 'USD' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.recipient) ||
      !claims.buyerAddress || !Number.isFinite(claims.issuedAt) || Date.now() - claims.issuedAt > 24 * 60 * 60 * 1000) {
    throw new Error('Receipt token claims are invalid or expired.');
  }
  return claims;
}
