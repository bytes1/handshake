import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicExponent: 0x10001,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
console.log('HANDSHAKE_SYNTHETIC_DKIM_PRIVATE_KEY=' + Buffer.from(privateKey).toString('base64'));
console.log('HANDSHAKE_SYNTHETIC_DKIM_PUBLIC_KEY=' + Buffer.from(publicKey).toString('base64'));
console.warn('TEST ONLY: this key signs synthetic .test emails and is not a PayPal DKIM key.');
