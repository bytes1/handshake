import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readAttesterSecretKey } from './attestation-signing';
import { attestUploadedGmailDemoReceipt } from './resend-demo-attestation';

try {
  process.loadEnvFile();
} catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
}

const port = Number(process.env.PORT ?? process.env.HANDSHAKE_ATTESTER_PORT ?? '8787');
const host = process.env.HANDSHAKE_ATTESTER_HOST ?? (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const maxBodyBytes = 3 * 1024 * 1024;
const rateWindowMs = 60_000;
const rateLimitPerMinute = Number(process.env.HANDSHAKE_ATTESTER_RATE_LIMIT_PER_MINUTE ?? '20');
const trustProxy = process.env.HANDSHAKE_ATTESTER_TRUST_PROXY === '1';
const allowedOrigins = new Set((process.env.HANDSHAKE_ATTESTER_ALLOWED_ORIGINS ??
  (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000,http://127.0.0.1:3000'))
  .split(',').map((value) => value.trim()).filter(Boolean));
const allowAnyOrigin = allowedOrigins.has('*');

function validateConfiguration() {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.');
  if (!Number.isInteger(rateLimitPerMinute) || rateLimitPerMinute < 1) {
    throw new Error('HANDSHAKE_ATTESTER_RATE_LIMIT_PER_MINUTE must be a positive integer.');
  }
  if (process.env.NODE_ENV === 'production' && allowedOrigins.size === 0) {
    throw new Error('Set HANDSHAKE_ATTESTER_ALLOWED_ORIGINS to the HTTPS frontend origins or *.');
  }
  const receiptSecret = process.env.RESEND_DEMO_RECEIPT_SECRET;
  if (!receiptSecret || receiptSecret.length < 32) throw new Error('RESEND_DEMO_RECEIPT_SECRET must be at least 32 characters.');
  const receiptSender = process.env.HANDSHAKE_DEMO_RECEIPT_FROM?.trim() ?? process.env.GMAIL_EMAIL?.trim();
  if (!receiptSender || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(receiptSender)) {
    throw new Error('Set HANDSHAKE_DEMO_RECEIPT_FROM to the Gmail address that sends demo receipts.');
  }
  // Fail at startup rather than accepting requests with a malformed private key.
  readAttesterSecretKey();
}

validateConfiguration();

const requestCounts = new Map<string, { startedAt: number; count: number }>();
let lastPrunedAt = 0;

function clientAddress(request: IncomingMessage): string {
  if (trustProxy) {
    const forwarded = request.headers['x-forwarded-for'];
    const address = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
    if (address?.trim()) return address.trim();
  }
  return request.socket.remoteAddress ?? 'unknown';
}

function takeRateLimit(request: IncomingMessage, response: ServerResponse): boolean {
  const now = Date.now();
  const address = clientAddress(request);
  const entry = requestCounts.get(address);
  if (!entry || now - entry.startedAt >= rateWindowMs) {
    requestCounts.set(address, { startedAt: now, count: 1 });
  } else if (entry.count >= rateLimitPerMinute) {
    response.setHeader('retry-after', String(Math.max(1, Math.ceil((rateWindowMs - (now - entry.startedAt)) / 1000))));
    response.writeHead(429).end(JSON.stringify({ error: 'Too many attestation requests. Wait a minute and try again.' }));
    return false;
  } else {
    entry.count++;
  }
  if (now - lastPrunedAt > rateWindowMs) {
    for (const [key, value] of requestCounts) if (now - value.startedAt >= rateWindowMs) requestCounts.delete(key);
    lastPrunedAt = now;
  }
  return true;
}

const server = createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('vary', 'Origin');
  const origin = request.headers.origin;
  if (origin) {
    if (!allowAnyOrigin && !allowedOrigins.has(origin)) {
      response.writeHead(403).end(JSON.stringify({ error: 'This frontend origin is not allowed to use the attester.' }));
      return;
    }
    response.setHeader('access-control-allow-origin', allowAnyOrigin ? '*' : origin);
    response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    response.setHeader('access-control-allow-headers', 'content-type');
    response.setHeader('access-control-max-age', '600');
  }

  let pathname: string;
  try { pathname = new URL(request.url ?? '/', 'http://attester.local').pathname; }
  catch { response.writeHead(400).end(JSON.stringify({ error: 'Invalid request URL.' })); return; }

  if (request.method === 'GET' && pathname === '/healthz') {
    response.writeHead(200).end(JSON.stringify({ status: 'ok', service: 'handshake-gmail-attester' }));
    return;
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }
  if (request.method !== 'POST' || pathname !== '/v1/demo/gmail/dkim-attest') {
    response.writeHead(404).end(JSON.stringify({ error: 'Not found' }));
    return;
  }
  if (!takeRateLimit(request, response)) return;
  const contentLength = Number(request.headers['content-length'] ?? 0);
  if (contentLength > maxBodyBytes) {
    response.writeHead(413).end(JSON.stringify({ error: 'Request too large.' }));
    return;
  }

  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const data = Buffer.from(chunk);
      size += data.length;
      if (size > maxBodyBytes) throw Object.assign(new Error('Request too large.'), { statusCode: 413 });
      chunks.push(data);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    const result = await attestUploadedGmailDemoReceipt(body);
    response.writeHead(200).end(JSON.stringify(result));
  } catch (error) {
    const statusCode = error instanceof Error && 'statusCode' in error ? Number(error.statusCode) : 400;
    const message = error instanceof Error ? error.message : 'Attestation failed.';
    response.writeHead(statusCode).end(JSON.stringify({ error: message }));
  }
});

server.listen(port, host, () => console.log(`Handshake Gmail attestor listening on http://${host}:${port}`));
