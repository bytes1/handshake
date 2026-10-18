# Handshake

**Handshake links an off-chain payment receipt to an on-chain release of escrowed test tokens.** A buyer reserves a seller's Midnight offer, sends a clearly labeled demo receipt, and submits the original email for Gmail DKIM verification. The attester signs the verified claim; the buyer's Lace wallet submits that attestation to the Compact contract, which checks the signature and releases tUSDC.

> **Wave 2 submission snapshot**  
> Handshake is a testnet prototype. Its demo receipt does not represent a payment, and its custom tUSDC is not Circle USDC and has no redemption value.

## Buildathon Wave 2

Wave 2 advances Handshake from a buyer-facing offer prototype to an end-to-end Midnight Preview demo. The current build adds concurrent buyer reservations against shared seller liquidity, browser recovery and cancellation for a buyer's reservation, original Gmail `.eml` verification, and an attested Compact settlement that releases test tokens.

This version demonstrates the core settlement path. It still uses one preconfigured maker offer. The app does not yet let a connected wallet create a seller listing. Payment evidence comes from a demo email, so no real fiat transfer occurs.

## What it does

- Reads a deployed offer and live contract state from the Midnight indexer.
- Connects to Lace on Midnight Preview and lets a buyer reserve an amount from the offer.
- Sends a conspicuously labeled demo receipt by Gmail SMTP.
- Verifies the original `.eml` file with Gmail DKIM and checks its signed trade fields in the off-chain attester.
- Returns a Jubjub Schnorr attestation bound to the contract, buyer commitment, amount, receipt commitment, and replay nullifier.
- Lets the buyer submit the attestation through Lace. The contract verifies it and transfers the reserved test tUSDC atomically.
- Supports concurrent buyers, buyer cancellation, saved-intent recovery, and expiry cleanup.

## Privacy and trust model

Handshake keeps the uploaded email and its contents off-chain. The attester receives the original email, verifies its DKIM signature and trade fields, then signs a claim. The Compact contract verifies that signature and binds it to the reserved trade. The contract also records receipt commitments and nullifiers to prevent replay.

This prototype uses selective disclosure for the attestation, but it does **not** hide every trade detail. The buyer's Midnight recipient address, reservation amount, and offer state are public on this demo contract. Gmail DKIM verification and email parsing happen off-chain, so the attester remains trusted to check the email correctly. A signed demo receipt proves only that the demo flow completed; it does not prove that money moved.

## Architecture

| Component | Role |
| --- | --- |
| Next.js app | Displays the offer, reads indexed contract state, and coordinates the buyer flow. |
| Lace wallet | Approves and submits the buyer's Midnight transactions. |
| Compact marketplace contract | Holds seller-funded test tUSDC, reserves buyer amounts, verifies the attester's Schnorr signature, blocks replay, and pays the buyer. |
| Demo receipt route | Sends an explicitly labeled test email through Gmail SMTP. |
| Off-chain attester | Verifies the uploaded original email's Gmail DKIM signature and signed fields, then creates the contract attestation. |
| Midnight Preview | Runs the deployed contract, indexer, and proof service used by the demo. |

The contract supports one configured maker offer with shared liquidity and concurrent buyer intents. Its maker secret is a bearer authorization for this prototype, not a wallet identity. The app currently implements the buyer journey only.

## Run the Preview demo

### Requirements

- Node.js 22 or newer
- Lace with the **Preview** network selected
- A local Midnight proof server reachable at `http://127.0.0.1:6300`, unless Lace supplies another URL
- A running Handshake attester. See [`midnight-contract/ATTESTOR_DEPLOYMENT.md`](midnight-contract/ATTESTOR_DEPLOYMENT.md) for deployment and secret configuration.
- Gmail sender credentials and the shared demo-receipt secret configured as described below

### Start the app

From the repository root:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), select **Preview** in Lace, connect the wallet, and refresh the market. The buyer wallet needs Preview transaction fees. The deployed offer already holds the demo tUSDC inventory.

The frontend defaults to the Handshake Preview deployment:

- Marketplace: `5bc81b4a60166225d0063d189190e347f65c567b1f6e9717095bed9acb057894`
- Demo token: `6feb3cc3d2d9f4d2c9f27332757adb898354b5d3a10376f75d66d299689ec82f`
- Network: `preview`

Set `NEXT_PUBLIC_MIDNIGHT_NETWORK` and `NEXT_PUBLIC_MARKET_CONTRACT_ADDRESS` together in `.env.local` to use another deployment. Configure `NEXT_PUBLIC_DEMO_TOKEN_ADDRESS` and `NEXT_PUBLIC_DEMO_TOKEN_DOMAIN_HEX` for that deployment's token as well. The predev and prebuild scripts copy the compiled market proof artifacts into `public/market-artifacts`.

### Configure the demo receipt

Set these values in the repository root `.env.local`:

```dotenv
GMAIL_EMAIL=your-sender@gmail.com
GMAIL_APP_PASSWORD=your-google-app-password
RESEND_DEMO_RECEIPT_SECRET=the-same-random-secret-as-the-attester
NEXT_PUBLIC_ATTESTER_URL=https://your-attester.example
```

Enable 2-Step Verification on the Gmail sender account and create a Google App Password. Generate a random secret for `RESEND_DEMO_RECEIPT_SECRET` and configure the same value in `midnight-contract/.env`. Set `HANDSHAKE_DEMO_RECEIPT_FROM` in the attester environment to the same sender address as `GMAIL_EMAIL`.

Start the attester from `midnight-contract`:

```bash
npm install
npm run attester:start
```

### Buyer walkthrough

1. Connect Lace on Preview and enter an amount within the offer limits.
2. Review the quote and approve the reservation transaction in Lace.
3. Enter a recipient inbox and send the demo receipt.
4. In Gmail, open **Show original** and download the unchanged `.eml` file.
5. Upload that file and submit the verified proof through Lace.

The demo email says **DEMO RECEIPT — NO PAYMENT WAS MADE**. Do not present it as a PayPal receipt or as evidence of a real payment.

## Contract development

The Compact contract and deployment scripts live in [`midnight-contract/`](midnight-contract/README.md). The current `.compact-version` pins the compiler used for this workspace. On Windows, run the Compact compiler from WSL because the compiler does not publish a native Windows binary.

```bash
cd midnight-contract
npm install
npm run compile:all
```

The contract's local smoke flows are documented in the contract README. Deployment scripts can create a local or testnet token and offer; they use test assets only. Do not use the local development seed for public networks or real value.

## Wave 3 direction

- Let a connected seller create, fund, manage, and withdraw their own offer.
- Replace the demo email receipt with payment-provider-backed evidence and a documented attester trust model.
- Reduce public trade metadata where the Midnight contract model allows it.
- Expand contract simulation and failure-case coverage before any production use.

## Buildathon submission checklist

- Public repository: [github.com/bytes1/handshake](https://github.com/bytes1/handshake)
- Pitch deck: [`pitch/Handshake-Wave-2-Pitch.pptx`](pitch/Handshake-Wave-2-Pitch.pptx)
- Add the `midnightntwrk` topic to the GitHub repository.
- Include the demo video or video pitch and a short Wave 2 progress description in the AKINDO submission.
- The Buildathon brief requires newly developed Midnight-related code, including the Compact contract, to be publicly available under Apache 2.0. Confirm the repository licensing and team registration meet the Official Rules before submitting.

The Buildathon brief says its Official Rules govern if a summary conflicts with them. Confirm the final submission details and deadline on AKINDO.
