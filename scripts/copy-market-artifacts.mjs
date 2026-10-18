import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'midnight-contract', 'contracts', 'managed', 'handshake-market');
const destination = path.join(root, 'public', 'market-artifacts');

for (const directory of ['keys', 'zkir']) {
  const from = path.join(source, directory);
  const to = path.join(destination, directory);
  if (existsSync(from)) {
    mkdirSync(to, { recursive: true });
    cpSync(from, to, { recursive: true, force: true });
  } else if (!existsSync(to)) {
    throw new Error(`Missing marketplace ${directory} artifacts. Compile contracts/handshake-market.compact or restore public/market-artifacts/${directory} before building.`);
  }
}
console.log('Handshake marketplace prover/verifier keys and ZKIR are ready in public/market-artifacts.');
