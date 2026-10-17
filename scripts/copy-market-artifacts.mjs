import { cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'midnight-contract', 'contracts', 'managed', 'handshake-market');
const destination = path.join(root, 'public', 'market-artifacts');

for (const directory of ['keys', 'zkir']) {
  const from = path.join(source, directory);
  mkdirSync(path.join(destination, directory), { recursive: true });
  cpSync(from, path.join(destination, directory), { recursive: true, force: true });
}
console.log('Copied Handshake marketplace prover/verifier keys and ZKIR into public/market-artifacts.');
