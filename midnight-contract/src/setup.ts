// Orchestrator for `npm run setup`. Replaces the prior package.json chain
// `docker compose up -d --wait && npm run compile:market && npm run deploy` so
// we can branch on --network and forward it to deploy.
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { resolveNetwork, setActiveNetwork, parseNetworkFlag } from './network';

function run(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false });
  if (r.status !== 0) {
    process.stderr.write(`\nCommand failed: ${cmd} ${args.join(' ')}\n`);
    process.exit(r.status ?? 1);
  }
}

function configureDevcontainerProofServer(network: string): void {
  if (network !== 'preview' || !fs.existsSync('/.dockerenv') || process.env.MIDNIGHT_PROOF_SERVER_URL) return;

  // The devcontainer cannot reach a Compose-published host port through
  // 127.0.0.1 (or reliably through host.docker.internal). Attach it to the
  // Compose network so the deploy process can use Docker DNS for proof-server.
  const composeNetwork = 'midnight-contract-devnet_default';
  const containerId = fs.readFileSync('/etc/hostname', 'utf8').trim();
  if (!containerId) throw new Error('Could not identify the current devcontainer to connect it to the proof-server network.');

  const inspect = spawnSync('docker', [
    'inspect', '--format', '{{json .NetworkSettings.Networks}}', containerId,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (inspect.status !== 0) {
    throw new Error(`Could not inspect the current devcontainer (${containerId}) through Docker: ${inspect.stderr || inspect.error?.message || 'unknown Docker error'}`);
  }

  let attachedNetworks: Record<string, unknown>;
  try { attachedNetworks = JSON.parse(inspect.stdout.trim()) as Record<string, unknown>; }
  catch { throw new Error('Docker returned invalid network information for the current devcontainer.'); }

  if (!attachedNetworks[composeNetwork]) {
    run('docker', ['network', 'connect', composeNetwork, containerId]);
  }
  process.env.MIDNIGHT_PROOF_SERVER_URL = 'http://proof-server:6300';
  process.stdout.write(`Using Compose proof server at ${process.env.MIDNIGHT_PROOF_SERVER_URL} from the devcontainer.\n`);
}

async function main(): Promise<void> {
  const argv = process.argv;
  const flag = parseNetworkFlag(argv);
  if (flag) setActiveNetwork(flag);
  const { network, config } = resolveNetwork({ argv });

  process.stdout.write(`\n→ Setting up midnight-contract on network: ${network}\n\n`);

  // 1. Bring up only the services this network needs.
  run('docker', ['compose', 'up', '-d', '--wait', ...config.composeServices]);
  configureDevcontainerProofServer(network);

  // 2. Compile the contract (network-agnostic).
  run('npm', ['run', 'compile:all']);

  // 3. Deploy. Forward --network so deploy.ts sees the same network.
  const deployFlags = network === 'undeployed' ? [] : ['--network', network];
  if (argv.includes('--fresh-demo')) deployFlags.push('--fresh-demo');
  const deployArgs = deployFlags.length ? ['--', ...deployFlags] : [];
  run('npm', ['run', 'deploy', ...deployArgs]);
}

main().catch((e) => {
  process.stderr.write(`\nSetup failed: ${(e as Error).message}\n`);
  process.exit(1);
});
