import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createPayPalOrder } from '@/lib/paypal';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const amountInput = typeof body?.amount === 'number' || typeof body?.amount === 'string'
      ? String(body.amount)
      : '';
    if (!/^\d{1,4}(?:\.\d{1,2})?$/.test(amountInput)) {
      return NextResponse.json({ error: 'Amount must be between $1.00 and $1,000.00 USD.' }, { status: 400 });
    }
    const amount = Number(amountInput);
    if (!Number.isFinite(amount) || amount < 1 || amount > 1000) {
      return NextResponse.json({ error: 'Amount must be between $1.00 and $1,000.00 USD.' }, { status: 400 });
    }

    const intentId = randomUUID();
    const origin = new URL(request.url).origin;
    const order = await createPayPalOrder(
      amount.toFixed(2),
      intentId,
      `${origin}/?paypal=return`,
      `${origin}/?paypal=cancel`,
    );
    const approvalUrl = order.links?.find((link) => link.rel === 'approve' || link.rel === 'payer-action')?.href;
    if (!order.id || !approvalUrl) {
      return NextResponse.json({ error: 'PayPal did not return a sandbox approval link.' }, { status: 502 });
    }
    return NextResponse.json({ orderId: order.id, approvalUrl, intentId, amount: amount.toFixed(2) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create PayPal Sandbox order.';
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
