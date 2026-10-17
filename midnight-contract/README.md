# midnight-contract

A Midnight Network smart contract scaffolded with create-mn-app.

## Quick start

Requirements: Node 22, Docker (with Compose v2), and Compact compiler 0.31.1, pinned in this workspace's `.compact-version` for the current public-network-compatible runtime.

> **On Windows:** the npm scripts in this project run natively (PowerShell or cmd.exe), but the Compact compiler publishes no native Windows binary — so `npm run compile`, and `npm run setup` which calls it, need to run inside WSL. See Midnight's [installation docs](https://docs.midnight.network/getting-started/installation).

```bash
npm install
npm run setup
```

`npm run setup` runs end-to-end with no prompts:

1. `docker compose up -d --wait` — starts a local Midnight devnet (node, indexer, proof-server) and blocks until all three pass their healthchecks.
2. `npm run compile:all` — compiles the capped demo tUSDC and marketplace contracts.
3. `npm run deploy` — deploys the test token and market, mints the initial inventory, and escrows it in the market.

The generated TypeScript CLI and deploy scripts are ready to connect to the local or selected public test network after the toolchain is available.

## Handshake marketplace contract (first pass)

`contracts/handshake-market.compact` starts the marketplace contract work with
a single maker offer and one active buyer intent. It enforces the offer's
minimum and maximum fill, reserves available quantity, lets the buyer cancel
their own intent, and lets the buyer submit a Schnorr-attested payment claim.
Maker and taker identifiers are contract-scoped commitments derived
from private 32-byte secrets. These secrets act as bearer authorization in
this prototype; they are not wallet identities, and losing the maker secret
makes the offer unmanageable. Do not use real secrets or funds with this
contract.

Compile the demo token and market contracts:

```bash
npm run compile:all
```

On Windows, run the Compact compiler from WSL as described above. The generated
files go under `contracts/managed/handshake-market/` and are ignored by Git.

For a public Preprod deployment, provide a Blockfrost project token and use a
separate, funded test wallet. Set `MIDNIGHT_BLOCKFROST_PROJECT_ID`, start the
local proof server with `npm run proof-server:start`, then run:

```sh
npm run setup -- --network preprod
```

The deployment script creates one sample offer. The market supports concurrent
buyer intents: each buyer reserves against shared available liquidity, and a
wallet can hold one active intent per offer. `HANDSHAKE_DEMO_LIQUIDITY`,
`HANDSHAKE_DEMO_MIN_FILL`, and `HANDSHAKE_DEMO_MAX_FILL` are tUSDC base units
(six decimals). `HANDSHAKE_DEMO_RATE_BPS` sets the fiat exchange rate in basis
points (10060 means 1.006 tUSDC per USD). The deployment mints and escrows the
offer liquidity as real Midnight unshielded tokens.

Deployment also requires `HANDSHAKE_ATTESTER_PUBLIC_KEY_X` and
`HANDSHAKE_ATTESTER_PUBLIC_KEY_Y`, the decimal Jubjub coordinates for the
off-chain attester's public key. Keep the corresponding secret only in the
attester service. Generate a key pair once with `npm run attester:keygen`, put
the secret in the attester's secret store, and set the two public coordinates
when deploying. Do not regenerate the key after deployment. The market circuit verifies the attester's Schnorr signature
in-circuit and binds it to the deployed contract, buyer commitment, amount,
provider, receipt commitment, and buyer-submitted nullifier. Used nullifiers
and receipt commitments are recorded to prevent replay. The buyer submits the
transaction directly; the attester is not a relayer.

The market escrows real tUSDC UTXOs using `fundOffer`. A buyer reservation
binds the tUSDC amount, expected fiat amount, buyer commitment, and recipient
address. A valid attester Schnorr proof sends the reserved tUSDC to that buyer
in the same transaction and consumes both replay keys. A buyer can cancel an
unproven reservation; after the fixed offer expiry, anyone can clear a stale
reservation and the maker can withdraw unreserved inventory. The Compact
contract cannot issue a fiat refund. DKIM/RSA verification and provider
receipt parsing remain off-chain responsibilities; do not describe this as
trustless DKIM verification or assume the signature proves that the attester
parsed a real provider receipt correctly.
The included email verifier supports only a synthetic, fixed-template receipt
signed with a locally pinned RSA key. Its sender uses
`paypal.handshake-demo.test`; it is not a PayPal email or a general-purpose,
DNS-backed DKIM verifier. The fixture exists to exercise the cryptographic
attestation path end to end. Do not use it as evidence of a real payment.

The token contract mints **Handshake test tUSDC**, a custom, capped Midnight
unshielded token with six decimal places. It is not Circle USDC and has no
redemption value. Every `npm run deploy` creates a new test token and offer,
mints the offer inventory to the maker wallet, and escrows it. Addresses and
the demo minter/maker secrets are saved in the gitignored,
owner-only `.midnight-demo-assets.json` file.

To run the synthetic attester locally, generate a dedicated Jubjub contract
attester key and a separate synthetic DKIM key:

```sh
npm run attester:keygen
npm run dkim:keygen
```

Keep the printed private keys in your local secret environment. Set
`HANDSHAKE_SYNTHETIC_DKIM_PUBLIC_KEY` to the base64 PEM public key and
`HANDSHAKE_SYNTHETIC_DKIM_PRIVATE_KEY` to the base64 PEM private key, then
start the local-only endpoint:

```sh
npm run attester:start
```

Create a signed fixture using the same trade reference, amount in minor units,
and recipient as the intent:

```sh
npm run demo:email -- TXN-DEMO-1001 HANDSHAKE-TRADE-01 2500 buyer@example.test receipt.eml
```

POST JSON to `http://127.0.0.1:8787/v1/paypal/attest` with base64 `emailBase64`
and hex fields `contractId`, `buyerCommitment`, and buyer-chosen `nullifier`,
plus string fields `intentNonce`, `tradeReference`, `amountMinor`, and
`recipient`. The endpoint returns the Schnorr attestation only after verifying
the RSA signature and matching the receipt to the supplied intent. The buyer's
wallet still submits `submitPaymentProof` directly; this service is not a
relayer. This local demo endpoint does not query chain state, so it is not a
production attester and must not be exposed publicly.

The Next.js PayPal Sandbox API flow is not yet connected to this attestation
circuit. The displayed peer offers are sample data. Do not use this version to
settle a trade. Production use needs a provider-backed email verification
source, production DKIM key discovery/rotation and policy, an independent chain
state check in the attester, wallet submission integration, and test-token
custody/settlement.
Peer V2 also separates escrow, intent coordination, and payment verification;
its contracts are built for Base, so their implementation cannot be dropped
into Compact unchanged.

## Local devnet

After local setup succeeds, run the Handshake market smoke test from a second
terminal in this directory:

```bash
npm run market:smoke -- --network undeployed
```

It connects with the same local wallet as deployment, submits a real
`reserveIntent` followed by `cancelIntent`, and checks that the offer returns to
the open state. By default it reserves a one-dollar fiat amount; override this
with `HANDSHAKE_SMOKE_PAYMENT_MINOR` in minor USD units. The script keeps a gitignored recovery secret while
the test intent is active, so it can retry cancellation if interrupted. This
checks those two contract circuits only. The older `npm run cli` command still targets the scaffolded
Hello World contract.

To exercise the payment-proof circuit locally, create a synthetic DKIM key pair
once with `npm run dkim:keygen`. Put the printed private and public PEM values
in `HANDSHAKE_SYNTHETIC_DKIM_PRIVATE_KEY` and
`HANDSHAKE_SYNTHETIC_DKIM_PUBLIC_KEY` as base64 in the local `.env`, and put
the matching Jubjub `HANDSHAKE_ATTESTER_SECRET_KEY` in the attester environment.
The deployed contract must have been initialized with that Jubjub key's public
coordinates. Start the attester in one terminal, then run the payment smoke
command in another terminal with the same `.env` loaded:

```bash
npm run attester:start
npm run market:payment-smoke -- --network undeployed
```

This test reserves an intent, creates and verifies a synthetic `.test` email,
requests an attestation, submits `submitPaymentProof`, and checks the accepted
state and consumed replay keys. It also verifies the escrow ledger decreases
by the paid amount. Token release and proof acceptance are one atomic contract
call. The email remains synthetic and is not a real PayPal message.

The project ships its own devnet via `docker-compose.yml`:

| Service        | Port | Purpose                                         |
| -------------- | ---- | ----------------------------------------------- |
| `node`         | 9944 | Midnight node, `dev` chain preset               |
| `indexer`      | 8088 | GraphQL indexer for chain state                 |
| `proof-server` | 6300 | Generates ZK proofs for contract transactions   |

State lives in container-managed volumes. Tear everything down with:

```bash
docker compose down -v
```

That removes all containers, networks, and volumes. The next `npm run setup` starts from a clean slate.

## ⚠️ LOCAL DEVNET ONLY

The deploy script uses a well-known genesis seed (`0000…0001`) so the
pre-minted NIGHT in the `dev` chain preset is immediately available. **Do
not use this seed against Preprod, mainnet, or any environment that
handles real value** — anyone running this devnet has full access to
funds at this seed.

## Networks

This DApp supports three networks:

| Network | When to use | Default? |
|---|---|---|
| `undeployed` | Local devnet bundled in `docker-compose.yml`. Genesis seed is hardcoded; no funding needed. | yes |
| `preview` | Public preview testnet. Faucet at `https://midnight-tmnight-preview.nethermind.dev`. |  |
| `preprod` | Public preprod testnet. Faucet at `https://midnight-tmnight-preprod.nethermind.dev`. |  |

The active network is **sticky**: whichever network you last interacted
with stays active until you switch. Any command run with `--network <name>`
also sets that network active for subsequent commands. The default on a
fresh project is `undeployed` (local devnet).

```sh
npm run setup -- --network preview   # runs on preview AND makes it active
npm run cli                          # still uses preview
npm run check-balance                # still uses preview
```

### Deploy a fresh Preview demo

The active marketplace contract cannot be upgraded in place. After changing
its Compact source, deploy a new demo instance with:

```sh
npm run setup -- --network preview --fresh-demo
```

Run this command inside WSL on Windows so the Midnight Compact compiler is
used. `--fresh-demo` deploys a new test token and marketplace; it does not move
test tokens or reservations from the old contracts. The previous local demo
secrets are archived in `.midnight-demo-assets.json`. Copy the new market
address (and new demo token address/domain, if the frontend reads buyer token
balances) from the deployment output into the corresponding
`NEXT_PUBLIC_MARKET_CONTRACT_ADDRESS`, `NEXT_PUBLIC_DEMO_TOKEN_ADDRESS`, and
`NEXT_PUBLIC_DEMO_TOKEN_DOMAIN_HEX` values in the frontend environment, then
restart/redeploy the frontend.

You can also switch without running anything else:

```sh
npm run network preview         # active network is now preview
npm run network                 # prints current active network
npm run network undeployed      # switch back to local devnet
```

### How wallets work across networks

- `undeployed` uses a hardcoded genesis seed. Local devnet pre-funds it.
- `preview` and `preprod` generate a fresh wallet on first use: a 24-word
  BIP-39 recovery phrase (printed once) plus its derived seed, both stored
  in `.midnight-state.json` (gitignored). The wallet survives switching
  networks — switch back later and your funded wallet returns.
- **Back up your recovery phrase** if you fund a public-network wallet you
  care about. It is printed when the wallet is created and kept in
  `.midnight-state.json` under `wallets.<network>.mnemonic`. Anyone holding
  the phrase controls the wallet.
- Wallets created before mnemonic support keep working from their stored
  `seed`; they just have no phrase to import into Lace.

### Using the same wallet as Lace

Seeds are derived with the standard BIP-39 `mnemonicToSeed` step — the same
convention Lace uses — so identity is portable in both directions:

- **Bring your Lace wallet here**: pass your recovery phrase via the
  `MIDNIGHT_WALLET_MNEMONIC` env var — the derived addresses match Lace.
  To keep the phrase out of your shell history, enter it with a hidden
  prompt instead of typing it inline:

  ```bash
  read -s MIDNIGHT_WALLET_MNEMONIC && export MIDNIGHT_WALLET_MNEMONIC
  npm run deploy
  ```
- **Take a scaffold wallet to Lace**: restore Lace from the 24-word phrase
  in `.midnight-state.json`.

### Funding a public-network wallet

On the first run with `--network preview` (or `preprod`):

1. `setup` will print your wallet address and the faucet URL.
2. Open the faucet URL, paste the address, request tNIGHT.
3. `setup` polls the wallet balance every 10 s and continues automatically
   once funds arrive.
4. The default poll budget is 10 minutes. Override with
   `MIDNIGHT_FAUCET_TIMEOUT_MS=1800000` (30 min) for unattended runs.

If the faucet is slow or the script times out, your seed is preserved.
Re-run `npm run setup -- --network preview` once the funds land.

### Environment overrides

These env vars override the active network's config (no per-network
suffix — they apply to whichever network is active for the run):

| Variable | Effect |
|---|---|
| `MIDNIGHT_WALLET_SEED` | Use this hex seed (32-128 hex chars; a Lace-compatible BIP-39 seed is 128) instead of generating/persisting one. Useful for CI with a pre-funded wallet. |
| `MIDNIGHT_WALLET_MNEMONIC` | Use this BIP-39 recovery phrase instead of generating a wallet — e.g. your Lace phrase, for the same addresses as Lace. Not persisted. Set only one of seed/mnemonic. |
| `MIDNIGHT_BLOCKFROST_PROJECT_ID` | Blockfrost project ID required for the current Preprod indexer and node. |
| `MIDNIGHT_INDEXER_URL` | Override the indexer GraphQL/API URL. |
| `MIDNIGHT_INDEXER_WS_URL` | Override the indexer WS URL. |
| `MIDNIGHT_NODE_URL` | Override the node RPC URL. |
| `MIDNIGHT_FAUCET_URL` | Override the faucet URL printed during setup. |
| `MIDNIGHT_PROOF_SERVER_URL` | Override the proof server URL — set to a public proof server (e.g. `https://lace-proof-pub.preview.midnight.network`) to skip running one locally. |
| `MIDNIGHT_FAUCET_TIMEOUT_MS` | Faucet poll budget in milliseconds (default 600000 = 10 min). |

By default all networks use the **local** proof server. Public proof
servers exist (see the env override above) but the local default keeps
your witness data on your machine and avoids depending on a remote
service for the deploy hot path.

### Switching back to local devnet

```sh
npm run network undeployed     # or: npm run setup -- --network undeployed
```

Your preview/preprod wallet seeds and deploy addresses stay in
`.midnight-state.json`. Switch back later, and they're still there.

### Wallet sync cache

After each `deploy`, `cli`, or `check-balance` run, the scripts serialize the
wallet's synced state to `.midnight-wallet-state/<network>/` (gitignored).
The next run on the same network restores from that snapshot and only catches
up to the latest block instead of replaying from genesis — meaningful on
`preview` / `preprod` where a from-seed sync takes minutes.

If the cache is stale or corrupt (e.g. after an SDK upgrade with an
incompatible state format) the wallet falls back to a fresh from-seed sync
with a one-line warning. `npm run clean` removes the cache along with other
generated state.

## Available scripts

| Script                  | Description                                                    |
| ----------------------- | -------------------------------------------------------------- |
| `npm run setup`         | One-shot: start devnet, compile, deploy.                       |
| `npm run compile:all`   | Compile the demo token and market Compact contracts.             |
| `npm run deploy`        | Deploy the compiled contract (requires devnet up + compiled).  |
| `npm run cli`           | Interactive CLI to call circuits on the deployed contract.     |
| `npm run check-balance` | Print the genesis-seed wallet's NIGHT and DUST balances.       |
| `npm run clean`         | Remove compiled contracts, network/wallet state, and local demo token secrets. |
| `npm run proof-server:start` / `:stop` | Compose lifecycle for just the proof-server service. |

## Project structure

```
midnight-contract/
├── contracts/
│   └── hello-world.compact     # Compact source
├── scripts/
│   └── clean.mjs               # remove generated state
├── src/
│   ├── network.ts              # network selection + state file management
│   ├── wallet.ts               # wallet construction + sync-state cache
│   ├── setup.ts                # orchestrator for `npm run setup`
│   ├── deploy.ts               # deploy the contract
│   ├── cli.ts                  # interact with deployed contract
│   └── check-balance.ts        # NIGHT / DUST balance
├── docker-compose.yml          # node + indexer + proof-server
├── .midnight-state.json        # written by deploy (gitignored)
├── .midnight-wallet-state/     # serialized sync state per network (gitignored)
├── package.json
└── tsconfig.json
```

## Compact compiler version

`.compact-version` at the create-mn-app repo root pinned the compiler
version this project was scaffolded against. To upgrade your local
compiler to that version:

```bash
compact update <version>
compact use <version>
```
