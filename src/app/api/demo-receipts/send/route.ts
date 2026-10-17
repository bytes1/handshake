import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { createDemoReceipt } from "@/lib/demo-receipt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const recentSends = new Map<string, number[]>();
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character] ?? character));

export async function POST(request: NextRequest) {
  try {
    const emailAddress = process.env.GMAIL_EMAIL?.trim();
    const appPassword = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
    if (!emailAddress || !appPassword) throw new Error("Demo receipt email is not configured. Set GMAIL_EMAIL and GMAIL_APP_PASSWORD.");

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const now = Date.now();
    const sends = (recentSends.get(ip) ?? []).filter((timestamp) => now - timestamp < 60_000);
    if (sends.length >= 5) return NextResponse.json({ error: "Too many demo receipts. Try again in a minute." }, { status: 429 });

    const body = await request.json() as Record<string, unknown>;
    const to = typeof body.to === "string" ? body.to.trim().toLowerCase() : "";
    const tradeReference = typeof body.tradeReference === "string" ? body.tradeReference.trim() : "";
    const amountMinor = typeof body.amountMinor === "string" ? body.amountMinor : "";
    const buyerAddress = typeof body.buyerAddress === "string" ? body.buyerAddress : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error("Enter a valid email address for the demo receipt.");
    if (!/^HS-[A-F0-9]{16}$/i.test(tradeReference) || !/^\d+$/.test(amountMinor) || BigInt(amountMinor) <= 0n || !buyerAddress) {
      throw new Error("The reserved trade details are missing or invalid.");
    }
    const { claims, token } = createDemoReceipt({ tradeReference, amountMinor, currency: "USD", recipient: to, buyerAddress });
    const amount = (Number(BigInt(amountMinor)) / 100).toFixed(2);
    const safeRecipient = escapeHtml(to);
    const safeTradeReference = escapeHtml(tradeReference);
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: emailAddress, pass: appPassword },
    });
    let email: Awaited<ReturnType<typeof transporter.sendMail>>;
    try {
      email = await transporter.sendMail({
        from: emailAddress,
        to,
        subject: `Handshake DEMO receipt ${claims.receiptId}`,
        text: [
          "HANDSHAKE DEMO RECEIPT — NO PAYMENT WAS MADE",
          "This is a test email for a product demo. It is not a PayPal receipt and does not confirm a real payment.",
          `Status: DEMO_COMPLETED`,
          `Receipt ID: ${claims.receiptId}`,
          `Trade reference: ${tradeReference}`,
          `Amount: $${amount} USD`,
          `Amount minor units: ${amountMinor}`,
          `Currency: USD`,
          `Recipient: ${to}`,
          `Receipt verification token: ${token}`,
        ].join("\n"),
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#23352e"><p style="background:#fff5e8;padding:12px;color:#8a4b00"><b>DEMO RECEIPT — NO PAYMENT WAS MADE</b><br>This is a test email. It is not a PayPal receipt and does not confirm a real payment.</p><h1>Handshake demo receipt</h1><p><b>Status:</b> DEMO_COMPLETED</p><p><b>Receipt ID:</b> ${claims.receiptId}<br><b>Trade reference:</b> ${safeTradeReference}<br><b>Amount:</b> $${amount} USD<br><b>Amount minor units:</b> ${amountMinor}<br><b>Currency:</b> USD<br><b>Recipient:</b> ${safeRecipient}</p><p>Receipt verification token:</p><pre style="overflow-wrap:anywhere;white-space:pre-wrap">${token}</pre></div>`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/self-signed certificate|SELF_SIGNED_CERT_IN_CHAIN/i.test(message)) {
        throw new Error("Gmail SMTP TLS certificate validation failed. Check whether antivirus or a network proxy is intercepting SMTP; Node must trust its root CA. Do not disable certificate validation.");
      }
      throw new Error(`Gmail SMTP send failed: ${message}`);
    }
    sends.push(now);
    recentSends.set(ip, sends);
    return NextResponse.json({ receiptToken: token, receiptId: claims.receiptId, resendEmailId: email.messageId, sentTo: to });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send the demo receipt.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
