import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';

export type VerifiedDkimEmail = {
  message: Buffer;
  from: string;
  signingDomain: string;
  selector: string;
  bodyHash: string;
  headers: Map<string, string[]>;
  body: string;
};

const DOMAIN = 'paypal.handshake-demo.test';
const SIGNED_HEADERS = ['from', 'to', 'subject', 'date', 'message-id'];

function relaxedHeader(name: string, value: string): string {
  return `${name.toLowerCase()}:${value.replace(/[\t ]+/g, ' ').trim()}\r\n`;
}

function relaxedBody(body: string): string {
  const lines = body.replace(/\r?\n/g, '\r\n').split('\r\n')
    .map((line) => line.replace(/[\t ]+/g, ' ').replace(/[\t ]+$/g, ''));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return `${lines.join('\r\n')}\r\n`;
}

function parseMessage(message: Buffer) {
  if (message.length > 128 * 1024) throw new Error('Email exceeds 128 KiB limit');
  const text = message.toString('utf8');
  if (text.includes('\uFFFD') || /\r(?!\n)|(?<!\r)\n/.test(text)) throw new Error('Email must be valid UTF-8 with CRLF line endings');
  const split = text.indexOf('\r\n\r\n');
  if (split < 0) throw new Error('Malformed email: missing header/body separator');
  const rawHeaders = text.slice(0, split).split('\r\n');
  const headers = new Map<string, string[]>();
  for (const line of rawHeaders) {
    if (/^[ \t]/.test(line)) {
      const last = [...headers.values()].at(-1);
      if (!last) throw new Error('Malformed folded email header');
      last[last.length - 1] += ` ${line.trim()}`;
      continue;
    }
    const match = /^([!-9;-~]+):[ \t]*(.*)$/.exec(line);
    if (!match) throw new Error('Malformed email header');
    const name = match[1].toLowerCase();
    headers.set(name, [...(headers.get(name) ?? []), match[2]]);
  }
  for (const key of ['from', 'to', 'subject', 'date', 'message-id', 'dkim-signature']) {
    if ((headers.get(key)?.length ?? 0) !== 1) throw new Error(`Expected exactly one ${key} header`);
  }
  return { headers, body: text.slice(split + 4) };
}

function dkimTags(value: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const part of value.split(';')) {
    const match = /^\s*([a-z]+)\s*=\s*(.*?)\s*$/.exec(part);
    if (!match) { if (part.trim()) throw new Error('Malformed DKIM-Signature tag'); else continue; }
    if (tags.has(match[1])) throw new Error(`Duplicate DKIM tag ${match[1]}`);
    tags.set(match[1], match[2].replace(/\s/g, ''));
  }
  return tags;
}

/** Verify the pinned-key synthetic demo format. This is intentionally not a DNS-backed general DKIM verifier. */
export async function verifyProviderDkimEmail(message: Buffer, allowedDomains: readonly string[]): Promise<VerifiedDkimEmail> {
  if (!allowedDomains.includes(DOMAIN)) throw new Error(`Attester must explicitly allow ${DOMAIN}`);
  const { headers, body } = parseMessage(message);
  const tags = dkimTags(headers.get('dkim-signature')![0]);
  if (tags.get('v') !== '1' || tags.get('a') !== 'rsa-sha256' || tags.get('c') !== 'relaxed/relaxed' ||
      tags.get('d') !== DOMAIN || tags.get('s') !== 'demo' || tags.get('h') !== SIGNED_HEADERS.join(':') || tags.has('l')) {
    throw new Error('Email is outside the supported synthetic DKIM profile');
  }
  const expectedBodyHash = createHash('sha256').update(relaxedBody(body), 'utf8').digest('base64');
  if (tags.get('bh') !== expectedBodyHash) throw new Error('DKIM body hash mismatch');
  const publicPem = process.env.HANDSHAKE_SYNTHETIC_DKIM_PUBLIC_KEY;
  if (!publicPem) throw new Error('HANDSHAKE_SYNTHETIC_DKIM_PUBLIC_KEY is required');
  const publicKey = createPublicKey(Buffer.from(publicPem, 'base64').toString('utf8'));
  const details = publicKey.asymmetricKeyDetails;
  if (publicKey.asymmetricKeyType !== 'rsa' || !details?.modulusLength || details.modulusLength < 2048) {
    throw new Error('Synthetic DKIM public key must be RSA with at least 2048 bits');
  }
  const signature = tags.get('b');
  if (!signature) throw new Error('Missing DKIM signature');
  const signatureHeader = headers.get('dkim-signature')![0].replace(/\bb\s*=\s*[^;]*/, 'b=');
  const signingInput = SIGNED_HEADERS.map((name) => relaxedHeader(name, headers.get(name)![0])).join('') +
    relaxedHeader('dkim-signature', signatureHeader);
  if (!verifySignature('RSA-SHA256', Buffer.from(signingInput, 'utf8'), publicKey, Buffer.from(signature, 'base64'))) {
    throw new Error('DKIM RSA signature is invalid');
  }
  const from = headers.get('from')![0];
  if (!new RegExp(`^service@${DOMAIN.replaceAll('.', '\\.')}$`, 'i').test(from)) throw new Error('Unexpected synthetic PayPal From address');
  return { message, from, signingDomain: DOMAIN, selector: 'demo', bodyHash: expectedBodyHash, headers, body };
}
