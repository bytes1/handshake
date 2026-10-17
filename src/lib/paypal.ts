import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

const API_BASE = 'https://api-m.sandbox.paypal.com';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

async function accessToken(): Promise<string> {
  const clientId = requiredEnv('PAYPAL_CLIENT_ID');
  const secret = requiredEnv('PAYPAL_CLIENT_SECRET');
  const response = await fetch(`${API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  });
  const payload = await response.json();
  if (!response.ok || typeof payload.access_token !== 'string') {
    throw new Error('PayPal Sandbox authentication failed');
  }
  return payload.access_token;
}

async function paypalFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });
  const payload = await response.json();
  if (!response.ok) {
    const message = typeof payload.message === 'string' ? payload.message : 'PayPal Sandbox request failed';
    throw new Error(message);
  }
  return payload as T;
}

export type PayPalOrder = {
  id: string;
  status?: string;
  links?: Array<{ rel: string; href: string }>;
  purchase_units?: Array<{
    custom_id?: string;
    amount?: { currency_code?: string; value?: string };
    payments?: { captures?: Array<{ id: string; status: string; amount?: { currency_code?: string; value?: string } }> };
  }>;
};

function intentMac(intentId: string, amount: string): string {
  return createHmac('sha256', requiredEnv('PAYPAL_INTENT_SECRET'))
    .update(`handshake:paypal:v1:${intentId}:${amount}:USD`)
    .digest('hex');
}

export function makeIntentReference(intentId: string, amount: string): string {
  return `handshake:${intentId}:${amount}:${intentMac(intentId, amount)}`;
}

export function verifyIntentReference(value: unknown, amount: string): string | null {
  if (typeof value !== 'string') return null;
  const match = /^handshake:([0-9a-f-]{36}):(\d+\.\d{2}):([0-9a-f]{64})$/i.exec(value);
  if (!match || match[2] !== amount) return null;
  const expected = Buffer.from(intentMac(match[1], amount), 'hex');
  const actual = Buffer.from(match[3], 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return match[1];
}

export function createPayPalOrder(amount: string, intentId: string, returnUrl: string, cancelUrl: string) {
  return paypalFetch<PayPalOrder>('/v2/checkout/orders', {
    method: 'POST',
    headers: { 'PayPal-Request-Id': `handshake-${intentId}` },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        custom_id: makeIntentReference(intentId, amount),
        description: 'Handshake Peer-to-Peer testnet demo',
        amount: { currency_code: 'USD', value: amount },
      }],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: 'Handshake Demo',
            user_action: 'PAY_NOW',
            return_url: returnUrl,
            cancel_url: cancelUrl,
          },
        },
      },
    }),
  });
}

export function getPayPalOrder(orderId: string) {
  return paypalFetch<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
}

export function capturePayPalOrder(orderId: string) {
  return paypalFetch<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    headers: { 'PayPal-Request-Id': `capture-${orderId}` },
    body: '{}',
  });
}
