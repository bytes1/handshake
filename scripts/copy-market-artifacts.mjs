import { cpSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
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

    const resolvedFrom = realpathSync(from);
    const resolvedTo = realpathSync(to);
    const fromTo = path.relative(resolvedFrom, resolvedTo);
    const toFrom = path.relative(resolvedTo, resolvedFrom);

    if (fromTo === '') continue;
    if (!fromTo.startsWith('..') && !path.isAbsolute(fromTo)) {
      throw new Error(`Cannot copy marketplace ${directory} artifacts: destination is inside the source directory (${resolvedTo}).`);
    }
    if (!toFrom.startsWith('..') && !path.isAbsolute(toFrom)) {
      throw new Error(`Cannot copy marketplace ${directory} artifacts: source is inside the destination directory (${resolvedFrom}).`);
    }

    cpSync(from, to, { recursive: true, force: true });
  } else if (!existsSync(to)) {
    throw new Error(`Missing marketplace ${directory} artifacts. Compile contracts/handshake-market.compact or restore public/market-artifacts/${directory} before building.`);
  }
}
console.log('Handshake marketplace prover/verifier keys and ZKIR are ready in public/market-artifacts.');
