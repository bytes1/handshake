import { createHash, sign as rsaSign } from 'node:crypto';
import type { VerifiedDkimEmail } from './dkim-attester';

export type SyntheticPayPalClaims = {
  transactionId: string;
  tradeReference: string;
  amountMinor: bigint;
  recipient: string;
};

const DOMAIN = 'paypal.handshake-demo.test';
const signedHeaders = ['from', 'to', 'subject', 'date', 'message-id'];
const canonicalHeader = (name: string, value: string) => `${name.toLowerCase()}:${value.replace(/[\t ]+/g, ' ').trim()}\r\n`;
const canonicalBody = (body: string) => {
  const lines = body.split('\r\n').map((line) => line.replace(/[\t ]+/g, ' ').replace(/[\t ]+$/g, ''));
  while (lines.length && lines.at(-1) === '') lines.pop();
  return `${lines.join('\r\n')}\r\n`;
};

export function createSyntheticPaypalEmail(claims: SyntheticPayPalClaims, privateKeyPem: string): Buffer {
  if (!/^[A-Za-z0-9._:-]{4,128}$/.test(claims.transactionId) || !/^[A-Za-z0-9._:-]{4,128}$/.test(claims.tradeReference)) throw new Error('Invalid synthetic receipt identifier');
  if (claims.amountMinor <= 0n || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.recipient)) throw new Error('Invalid synthetic receipt amount or recipient');
  const headers = [
    `From: service@${DOMAIN}`,
    'To: buyer@example.test',
    'Subject: Your PayPal payment is complete',
    'Date: Tue, 15 Sep 2026 12:00:00 +0000',
    `Message-ID: <${claims.transactionId}@${DOMAIN}>`,
  ];
  const body = [
    'Handshake Synthetic PayPal Receipt (TEST ONLY)',
    'Status: COMPLETED',
    `Transaction ID: ${claims.transactionId}`,
    `Trade Reference: ${claims.tradeReference}`,
    `Amount Minor: ${claims.amountMinor}`,
    'Currency: USD',
    `Recipient: ${claims.recipient.toLowerCase()}`,
    '',
  ].join('\r\n');
  const bodyHash = createHash('sha256').update(canonicalBody(body), 'utf8').digest('base64');
  const unsignedDkim = `v=1; a=rsa-sha256; c=relaxed/relaxed; d=${DOMAIN}; s=demo; h=${signedHeaders.join(':')}; bh=${bodyHash}; b=`;
  const signingInput = signedHeaders.map((name) => canonicalHeader(name, headers.find((h) => h.toLowerCase().startsWith(`${name}:`))!.slice(name.length + 1))).join('') +
    canonicalHeader('dkim-signature', unsignedDkim);
  const signature = rsaSign('RSA-SHA256', Buffer.from(signingInput), privateKeyPem).toString('base64');
  return Buffer.from(`${headers.join('\r\n')}\r\nDKIM-Signature: ${unsignedDkim}${signature}\r\n\r\n${body}`, 'utf8');
}

export function parseSyntheticPayPalEmail(verified: VerifiedDkimEmail) {
  if (verified.signingDomain !== DOMAIN || verified.headers.get('subject')?.[0] !== 'Your PayPal payment is complete') {
    throw new Error('Email does not match the synthetic PayPal template');
  }
  const fields = new Map<string, string>();
  for (const line of verified.body.replace(/\r\n$/, '').split('\r\n')) {
    const match = /^([A-Za-z ]+): ([^\r\n]+)$/.exec(line);
    if (!match) continue;
    if (fields.has(match[1])) throw new Error(`Duplicate receipt field: ${match[1]}`);
    fields.set(match[1], match[2]);
  }
  if (!verified.body.startsWith('Handshake Synthetic PayPal Receipt (TEST ONLY)\r\n')) throw new Error('Synthetic test marker missing');
  if (fields.get('Status') !== 'COMPLETED' || fields.get('Currency') !== 'USD') throw new Error('Receipt is not a completed USD payment');
  for (const field of ['Transaction ID', 'Trade Reference', 'Recipient']) {
    if (!fields.has(field)) throw new Error(`Missing receipt field: ${field}`);
  }
  const amountText = fields.get('Amount Minor') ?? '';
  if (!/^\d+$/.test(amountText)) throw new Error('Malformed amount in synthetic receipt');
  return {
    provider: 'paypal' as const,
    status: fields.get('Status') as 'COMPLETED',
    transactionId: fields.get('Transaction ID') ?? '',
    tradeReference: fields.get('Trade Reference') ?? '',
    amountMinor: BigInt(amountText),
    currency: fields.get('Currency') as 'USD',
    recipient: fields.get('Recipient') ?? '',
    dkimBodyHash: verified.bodyHash,
  };
}
