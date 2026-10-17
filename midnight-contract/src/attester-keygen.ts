import { randomBytes } from 'node:crypto';
import { ecMulGenerator } from '@midnight-ntwrk/compact-runtime';

const JUBJUB_ORDER = 6554484396890773809930967563523245729705921265872317281365359162392183254199n;

let secretKey = 0n;
while (secretKey === 0n) secretKey = BigInt(`0x${randomBytes(32).toString('hex')}`) % JUBJUB_ORDER;
const publicKey = ecMulGenerator(secretKey);

console.log('Keep this private key in the attester secret store; never commit it.');
console.log(`HANDSHAKE_ATTESTER_SECRET_KEY=${secretKey.toString(16).padStart(64, '0')}`);
console.log(`HANDSHAKE_ATTESTER_PUBLIC_KEY_X=${publicKey.x.toString()}`);
console.log(`HANDSHAKE_ATTESTER_PUBLIC_KEY_Y=${publicKey.y.toString()}`);
