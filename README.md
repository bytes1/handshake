# Handshake

A peer-to-peer marketplace frontend and a separate Midnight contract
workspace. The browser connects to Lace on Midnight Preview by default,
reads the configured offer from the indexer, and submits buyer reserve, cancel,
and attested-payment-proof calls through Lace. The receipt path currently uses
an explicitly synthetic PayPal-style email for local testing; it does not
contact PayPal or move real money.

## Stack

- Next.js App Router with TypeScript
- Tailwind CSS 4
- shadcn/ui (`base-nova` style)
- Next.js Route Handlers for backend HTTP endpoints

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The backend scaffold health check is available at [http://localhost:3000/api/health](http://localhost:3000/api/health).

## Windows development container

Install and start Docker Desktop with Linux containers enabled, install the VS Code **Dev Containers** extension, open this folder in VS Code, then run **Dev Containers: Reopen in Container**. The container installs Compact 0.31.1 and keeps Linux dependencies in Docker volumes separate from Windows `node_modules`. From the container terminal, run `cd midnight-contract && npm run setup` to compile and start the local Midnight devnet.

## Project layout

- `src/app/` — routes, layouts, and API route handlers
- `src/components/ui/` — shadcn/ui components
- `src/lib/` — shared utilities; keep server-only Midnight integration here
- `midnight-contract/` — Compact contract, Midnight.js scripts, and local devnet setup

Add UI primitives with `npx shadcn@latest add <component>`.

## Midnight Preview marketplace demo

The frontend defaults to the Handshake Preview market
`504c51b8d68937256839793c882f59d92d7c7eb1b9576f50cc13483e0a676ea1` deployed
by `midnight-contract` setup. Set `NEXT_PUBLIC_MIDNIGHT_NETWORK` and
`NEXT_PUBLIC_MARKET_CONTRACT_ADDRESS` together in `.env.local` if using a
different deployment. The `predev` and `prebuild` scripts copy the compiled
market proving/verifier artifacts into `public/market-artifacts`.

1. From `midnight-contract`, keep the Preview proof server running. The Preview
   node and indexer are public endpoints; the proof server used by Lace defaults
   to `http://127.0.0.1:6300`. If Lace provides a different proof server URL,
   the connector configuration takes precedence. If the compiled
   `contracts/managed/handshake-market` folder is absent, run
   `npm run compile:market` there first (do not redeploy the already deployed
   market just to generate frontend artifacts).
2. Install dependencies with `npm install` in the repository root. Install in
   `midnight-contract` as well if you need its compiler/attester scripts.
3. Run `npm run dev` from the repository root and open
   [http://localhost:3000](http://localhost:3000).
4. In Lace, select **Preview**, ensure it uses the Preview node and indexer,
   unlock the wallet, then connect from the app. The buyer wallet needs Preview
   tNIGHT/DUST to pay transaction fees; maker liquidity is already escrowed in
   the deployed offer.
5. The displayed offer values come from the Preview contract state. The buy
   panel also shows the connected Lace account's available unshielded tUSDC
   balance. Enter a USD amount and reserve; Lace asks you to approve the
   Midnight transaction.
6. After the reservation, start the local attester in a second terminal from
   `midnight-contract` with `npm run attester:start`. It needs
   `HANDSHAKE_ATTESTER_SECRET_KEY` and
   `HANDSHAKE_SYNTHETIC_DKIM_PRIVATE_KEY` in that folder's `.env`. Return to
   the open trade dialog and choose **Create synthetic proof and submit**.
   Lace submits the proof, and the contract releases test tUSDC to the
   connected wallet.

The frontend is configured for the Preview deployment address above and uses
the selected Lace connector's indexer settings. The local attester only creates
synthetic PayPal-shaped email evidence; it does not verify real PayPal emails or
move real money. The buyer recovery secret is saved in this browser so a
pending reservation can be resumed or cancelled across refreshes. Clear the
intent when the trade is complete. The synthetic email is only for local end-to-end testing;
real provider integration remains separate work. The old PayPal Sandbox API
routes remain in the codebase but are no longer part of this trade path.
