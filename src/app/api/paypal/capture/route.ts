import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { capturePayPalOrder, getPayPalOrder, verifyIntentReference } from '@/lib/paypal';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const { orderId } = await request.json();
    if (typeof orderId !== 'string' || !/^[A-Z0-9-]{10,64}$/i.test(orderId)) {
      return NextResponse.json({ error: 'A valid PayPal Sandbox order ID is required.' }, { status: 400 });
    }

    // Read the order from PayPal before capture. Never trust amount, status,
    // custom_id, or a capture ID sent by the browser.
    const before = await getPayPalOrder(orderId);
    const unit = before.purchase_units?.[0];
    const amount = unit?.amount?.value;
    if (
      before.id !== orderId || !['APPROVED', 'COMPLETED'].includes(before.status ?? '') || !amount || !verifyIntentReference(unit?.custom_id, amount) ||
      unit?.amount?.currency_code !== 'USD' || !/^\d+\.\d{2}$/.test(amount)
    ) {
      return NextResponse.json({ error: 'PayPal order is not an approved Handshake demo order.' }, { status: 409 });
    }

    // PayPal return redirects and browsers may retry. An already completed
    // capture is a successful idempotent result; do not capture it again.
    const captured = before.status === 'COMPLETED' ? before : await capturePayPalOrder(orderId);
    const capture = captured.purchase_units?.[0]?.payments?.captures?.[0];
    if (
      captured.id !== orderId || captured.status !== 'COMPLETED' || capture?.status !== 'COMPLETED' ||
      capture.amount?.currency_code !== 'USD' || capture.amount.value !== amount || !capture.id
    ) {
      return NextResponse.json({ error: 'PayPal did not confirm a completed capture.' }, { status: 409 });
    }

    // This is a receipt commitment for the demo UI. It is not a ZK proof and
    // is not an on-chain attestation. The capture is verified by this server.
    const receiptCommitment = createHash('sha256')
      .update(`${captured.id}:${capture.id}:${amount}:USD`)
      .digest('hex');
    return NextResponse.json({
      status: 'COMPLETED',
      orderId: captured.id,
      captureId: capture.id,
      amount,
      currency: 'USD',
      receiptCommitment,
      intentId: verifyIntentReference(unit?.custom_id, amount),
      verification: 'paypal-sandbox-server-verified',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to verify the PayPal Sandbox capture.';
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
