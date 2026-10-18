# Handshake

**Payment evidence in. Escrowed tokens out.**

Handshake is a privacy-aware peer-to-peer settlement prototype on Midnight. A buyer reserves seller-funded test tokens, submits the original payment email to an off-chain verifier, then uses Lace to submit a signed claim to a Compact contract. The contract verifies the claim and releases the reserved tokens.

> **Wave 2 demo:** Handshake runs against Midnight Preview. Its receipt is generated for demonstration and does not represent a fiat payment. Handshake tUSDC is a test token, not Circle USDC, and has no redemption value.

[Open the Wave 2 pitch deck](pitch/Handshake-Wave-2-Pitch.pptx) · [Explore the contract](midnight-contract/contracts/handshake-market.compact) · [View the public repository](https://github.com/bytes1/handshake)

## Why Handshake

In a peer-to-peer marketplace, an off-chain payment and an on-chain asset move through separate systems. That leaves marketplace operators with a coordination problem: how can an asset be released against payment evidence without putting a buyer’s full receipt on a public ledger?

Handshake explores that handoff for marketplace operators and builders working with tokenized assets. A verifier checks the receipt off-chain; a Compact contract enforces the reservation and payout rule on Midnight. The Wave 2 demo uses a clearly labeled Gmail receipt and test tUSDC to make this flow concrete.

The Wave 2 build connects the full demo path: live Preview offer state, Lace reservations, Gmail demo receipts, verification of the original `.eml` file, and Compact settlement with replay protection. This is a working testnet prototype, not a production payment rail.

## System architecture

![Handshake Wave 2 architecture showing the buyer app, Lace wallet, email verifier, Compact marketplace contract, and Midnight indexer](docs/handshake-architecture.svg)

### Buyer settlement lifecycle

![Five-step buyer flow from offer funding and reservation through off-chain email verification to Compact settlement](docs/handshake-settlement-flow.svg)

The diagrams use a layered, component-first presentation. Their components and trust boundaries describe Handshake's implementation.

## What the contract does

The Compact marketplace contract:

- Holds maker-funded Midnight test tUSDC and enforces offer limits.
- Reserves inventory for buyer intents and supports concurrent buyers against shared liquidity.
- Allows a buyer to cancel an active intent, and lets anyone clear an intent after offer expiry.
- Verifies an attester's Jubjub Schnorr signature against the contract, buyer commitment, amount, receipt commitment, and nullifier.
- Rejects consumed receipt commitments and nullifiers, then transfers the reserved tokens in the same transaction as proof acceptance.

The deployed Preview instance uses one configured maker offer. The app reads its live state through the Midnight indexer. Buyers approve and submit their own transactions through Lace.

## Privacy and trust model

The original `.eml` file and DKIM parsing stay off-chain. The attester checks Gmail's DKIM signature and matches the signed receipt fields to the buyer's reservation. It then signs a claim for the Compact contract to verify. The email body is never placed on-chain.

The demo still exposes the buyer's recipient address, reservation amount, and offer state on-chain. Gmail DKIM validation and receipt parsing happen in the attester, so the contract trusts that service to check the email correctly. The demo receipt confirms only that the demo flow ran; it does not show that money moved.

## Wave 2 progress

Compared with the earlier buyer-flow prototype, Wave 2 connects receipt verification to contract settlement:

- The app sends a clearly labeled demo receipt and accepts the unchanged Gmail `.eml` file.
- The attester validates DKIM and signed trade fields before issuing a contract-bound Schnorr signature.
- The buyer submits the proof through Lace, and the contract verifies the attestation before releasing escrowed tUSDC.
- The app reads live offer state and supports multiple buyer reservations, cancellation, and recovery of a saved reservation.

These capabilities are designed to make the privacy boundary and settlement path reviewable in a live testnet walkthrough.

## Run the Preview demo

### Requirements

- Node.js 22 or newer
- Lace connected to **Midnight Preview**
- A Midnight proof server reachable at `http://127.0.0.1:6300`, unless Lace supplies another URL
- A running Handshake attester and configured Gmail sender

### Start the app

From the repository root:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), select **Preview** in Lace, connect the wallet, and refresh the market. The buyer wallet needs Preview transaction fees. The configured offer already holds the demo tUSDC inventory.

The frontend defaults to these Preview contracts:

| Contract | Address |
| --- | --- |
| Handshake marketplace | `5bc81b4a60166225d0063d189190e347f65c567b1f6e9717095bed9acb057894` |
| Handshake test tUSDC | `6feb3cc3d2d9f4d2c9f27332757adb898354b5d3a10376f75d66d299689ec82f` |

Set `NEXT_PUBLIC_MIDNIGHT_NETWORK` and `NEXT_PUBLIC_MARKET_CONTRACT_ADDRESS` together in `.env.local` to use another deployment. Set `NEXT_PUBLIC_DEMO_TOKEN_ADDRESS` and `NEXT_PUBLIC_DEMO_TOKEN_DOMAIN_HEX` for its token as well. The app's `predev` and `prebuild` steps copy the market proving artifacts into `public/market-artifacts`.

### Configure receipt delivery and attestation

Create a Google App Password for the Gmail sender and set the following in the root `.env.local`:

```dotenv
GMAIL_EMAIL=your-sender@gmail.com
GMAIL_APP_PASSWORD=your-google-app-password
RESEND_DEMO_RECEIPT_SECRET=shared-random-secret
NEXT_PUBLIC_ATTESTER_URL=https://your-attester.example
```

Set the same `RESEND_DEMO_RECEIPT_SECRET` in `midnight-contract/.env`. Set `HANDSHAKE_DEMO_RECEIPT_FROM` there to the sender address in `GMAIL_EMAIL`. See [`midnight-contract/ATTESTOR_DEPLOYMENT.md`](midnight-contract/ATTESTOR_DEPLOYMENT.md) for attester deployment details.

From `midnight-contract`, start the attester:

```bash
npm install
npm run attester:start
```

### Buyer walkthrough

1. Connect Lace on Preview and enter an amount within the offer limits.
2. Review the quote and approve the reservation transaction in Lace.
3. Enter a recipient inbox and send the demo receipt.
4. In Gmail, choose **Show original** and download the unchanged `.eml` file.
5. Upload the file and submit the verified proof through Lace.

## Build and quality checks

The repository includes Compact compilation and two contract smoke flows. On Windows, run the Compact compiler from WSL because it does not publish a native Windows binary.

```bash
cd midnight-contract
npm install
npm run compile:all
npm run market:smoke -- --network undeployed
npm run market:payment-smoke -- --network undeployed
```

The reservation smoke flow checks `reserveIntent` and `cancelIntent`. The payment smoke flow exercises the signed proof path and checks token release and replay state. These scripts use the local devnet and test assets. Run them before presenting test results; this README does not claim a test run.

## Product direction

### Initial customer and adoption path

The initial customer is a marketplace operator that needs to coordinate an off-chain checkout with release of an on-chain asset. A practical first pilot would focus on one marketplace and one payment source, then measure settlement completion, disputes, verifier errors, and support effort before expanding integrations.

### Sustainability hypothesis

A future product could charge marketplace operators an integration or per-settlement fee for evidence verification and contract-based release. That is a business hypothesis, not revenue generated by this prototype; it needs validation with marketplace operators and a real payment provider.

### Wave 3 direction

Wave 3 will explore a browser extension that helps buyers verify payment transactions across supported providers, then settle the corresponding on-chain trade. The extension is a planned product milestone; the current app still uses a Gmail receipt flow on Midnight Preview.

The roadmap is to:

1. Build a browser extension with provider-specific adapters that guide buyers through proving transactions with a privacy-preserving proof source, such as zkTLS.
2. Validate each proof off-chain and convert it into a common signed payment attestation containing only the fields needed for settlement, such as provider, amount, currency, recipient, and transaction status.
3. Extend the Compact settlement flow with a shared verifier that checks attestations, binds them to buyer reservations, and prevents replay. Provider adapters can then reuse the same contract verification path.
4. Start with one provider end to end, define safe amount and currency tolerances, and add providers after the extension and verifier have been tested and reviewed.

This direction uses provider-agnostic proof verification and standardized payment attestations as design goals. Handshake will need its own provider integrations, trust model, privacy review, and contract design. These capabilities remain planned beyond the current testnet flow.

### Next product milestones

The next steps are to prototype the extension with one payment provider, document its evidence and privacy boundaries, independently review the verifier and contract, and test the workflow with a marketplace partner. Wave 2 covers the testnet settlement path. Production readiness and real-payment verification require further validation.

## Buildathon submission notes

- Public repository: [github.com/bytes1/handshake](https://github.com/bytes1/handshake)
- Pitch deck: [Wave 2 pitch presentation](pitch/Handshake-Wave-2-Pitch.pptx)
- The Buildathon requires the GitHub repository to carry the `midnightntwrk` topic.
- The Wave 2 submission also needs a demo video or video pitch and a concise description of the progress for this Wave.
- The provided program brief requires newly developed Midnight-related code, including the Compact contract, to be available under Apache 2.0. Confirm the repository's license before submission.

The Official Rules control if they differ from the program summary. Confirm the final submission requirements on AKINDO.
