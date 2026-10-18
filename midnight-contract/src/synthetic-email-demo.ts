import { writeFile } from 'node:fs/promises';
import { createSyntheticPaypalEmail } from './synthetic-paypal-email';

const privateKey = process.env.HANDSHAKE_SYNTHETIC_DKIM_PRIVATE_KEY;
if (!privateKey) throw new Error('HANDSHAKE_SYNTHETIC_DKIM_PRIVATE_KEY is required (base64-encoded PEM)');
const [transactionId, tradeReference, amountMinor, recipient, outputPath = 'synthetic-paypal-receipt.eml'] = process.argv.slice(2);
if (!transactionId || !tradeReference || !amountMinor || !recipient || !/^\d+$/.test(amountMinor)) {
  throw new Error('Usage: npm run demo:email -- <transaction-id> <trade-reference> <amount-minor> <recipient> [output.eml]');
}
const pem = Buffer.from(privateKey, 'base64').toString('utf8');
await writeFile(outputPath, createSyntheticPaypalEmail({
  transactionId,
  tradeReference,
  amountMinor: BigInt(amountMinor),
  recipient,
}, pem));
console.log(`Wrote TEST ONLY synthetic email: ${outputPath}`);
