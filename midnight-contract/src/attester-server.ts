import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { attestPayPalEmail } from './email-attestation-flow';
import { createSyntheticPaypalEmail, parseSyntheticPayPalEmail } from './synthetic-paypal-email';

try {
  process.loadEnvFile();
} catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
}

const port = Number(process.env.HANDSHAKE_ATTESTER_PORT ?? '8787');
const maxBodyBytes = 180 * 1024;
const server = createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  const origin = request.headers.origin;
  if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    response.setHeader('access-control-allow-origin', origin);
    response.setHeader('vary', 'origin');
    response.setHeader('access-control-allow-methods', 'POST, OPTIONS');
    response.setHeader('access-control-allow-headers', 'content-type');
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }
  const demoEndpoint = request.url === '/v1/demo/paypal/attest';
  if (request.method !== 'POST' || (!demoEndpoint && request.url !== '/v1/paypal/attest')) {
    response.writeHead(404).end(JSON.stringify({ error: 'Not found' }));
    return;
  }
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const data = Buffer.from(chunk);
      size += data.length;
      if (size > maxBodyBytes) throw new Error('Request too large');
      chunks.push(data);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    const hex = (name: string) => {
      const value = body[name];
      if (typeof value !== 'string' || !/^(?:[a-f0-9]{2})+$/i.test(value)) throw new Error(`${name} must be even-length hex`);
      const bytes = Buffer.from(value, 'hex');
      if (bytes.length !== 32) throw new Error(`${name} must be 32 bytes`);
      return new Uint8Array(bytes);
    };
    if (typeof body.tradeReference !== 'string' || typeof body.recipient !== 'string' || typeof body.amountMinor !== 'string' || typeof body.intentNonce !== 'string') {
      throw new Error('tradeReference, recipient, amountMinor, and intentNonce are required as strings');
    }
    const expected = {
      contractId: hex('contractId'),
      buyerCommitment: hex('buyerCommitment'),
      nullifier: hex('nullifier'),
      intentNonce: BigInt(body.intentNonce),
      tradeReference: body.tradeReference,
      amountMinor: BigInt(body.amountMinor),
      recipient: body.recipient,
    };
    let rawEmail: Buffer;
    if (demoEndpoint) {
      const privateKey = process.env.HANDSHAKE_SYNTHETIC_DKIM_PRIVATE_KEY;
      if (!privateKey) throw new Error('Synthetic demo signing key is not configured. Set HANDSHAKE_SYNTHETIC_DKIM_PRIVATE_KEY in midnight-contract/.env.');
      const pem = Buffer.from(privateKey, 'base64').toString('utf8');
      if (!pem.includes('PRIVATE KEY')) throw new Error('HANDSHAKE_SYNTHETIC_DKIM_PRIVATE_KEY must be a base64-encoded PEM private key.');
      rawEmail = createSyntheticPaypalEmail({
        transactionId: `TXN-${randomBytes(8).toString('hex')}`,
        tradeReference: expected.tradeReference,
        amountMinor: expected.amountMinor,
        recipient: expected.recipient,
      }, pem);
    } else {
      if (typeof body.emailBase64 !== 'string' || body.emailBase64.length > maxBodyBytes * 2) throw new Error('emailBase64 is required');
      rawEmail = Buffer.from(body.emailBase64, 'base64');
    }
    const result = await attestPayPalEmail({
      rawEmail,
      allowedDkimDomains: ['paypal.handshake-demo.test'],
      expected,
      parsePayPalEmail: parseSyntheticPayPalEmail,
    });
    response.writeHead(200).end(JSON.stringify({
      providerId: result.providerId.toString(),
      receiptCommitment: Buffer.from(result.receiptCommitment).toString('hex'),
      nullifier: Buffer.from(result.nullifier).toString('hex'),
      signature: {
        announcement: { x: result.signed.signature.announcement.x.toString(), y: result.signed.signature.announcement.y.toString() },
        response: result.signed.signature.response.toString(),
      },
      quotient: result.signed.quotient.toString(),
      challengeRemainder: result.signed.challengeRemainder.toString(),
      verifiedDkim: result.verifiedDkim,
      demoEvidence: 'SYNTHETIC TEST EMAIL; not sent or DKIM-signed by PayPal',
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Attestation failed';
    response.writeHead(400).end(JSON.stringify({ error: message }));
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Synthetic Handshake attester listening on http://127.0.0.1:${port}`));
