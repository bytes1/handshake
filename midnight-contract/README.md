# Handshake Contracts & Attester ⚡

<p align="center">
  <strong>Zero-knowledge marketplace contracts, test token minter, and off-chain DKIM attester for Midnight.</strong>
</p>

<p align="center">
  <a href="https://midnight.network"><img src="https://img.shields.io/badge/Midnight-Preview_Testnet-101820?style=for-the-badge&logo=shield" alt="Midnight Preview" /></a>
  <a href="https://docs.midnight.network"><img src="https://img.shields.io/badge/Compact-v0.31.1-7057ff?style=for-the-badge" alt="Compact Compiler" /></a>
  <a href="https://www.docker.com"><img src="https://img.shields.io/badge/Docker-Compose_v2-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker Compose" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-22.0+-5FA04E?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" /></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-5.0-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" /></a>
</p>

<p align="center">
  <a href="../README.md">🏠 <b>Root Project README</b></a> •
  <a href="contracts/handshake-market.compact">📜 <b>Marketplace Compact Contract</b></a> •
  <a href="contracts/handshake-demo-usdc.compact">🪙 <b>Demo tUSDC Contract</b></a> •
  <a href="contracts/schnorr.compact">🔐 <b>Schnorr Circuit</b></a> •
  <a href="ATTESTOR_DEPLOYMENT.md">🚀 <b>Attester Deployment Guide</b></a>
</p>

---

> [!IMPORTANT]
> **Prototype & Testnet Scope**
> - **Testnet Assets Only:** Mints and settles **Handshake test tUSDC** (6 decimals). This is a custom test token on Midnight Preview with zero fiat redemption value; it is **not** Circle USDC.
> - **Attester Trust Boundary:** DKIM signature validation and receipt parsing execute off-chain in the attester service. The on-chain Compact circuit verifies the attester's Jubjub Schnorr signature against trade commitments and consumes double nullifiers to prevent replay.

---

## 📑 Table of Contents

- [Overview & Architecture](#overview--architecture)
- [Smart Contracts & Circuits](#smart-contracts--circuits)
  - [1. Handshake Market (`handshake-market.compact`)](#1-handshake-market-handshake-marketcompact)
  - [2. Demo Token (`handshake-demo-usdc.compact`)](#2-demo-token-handshake-demo-usdccompact)
  - [3. Schnorr Verification (`schnorr.compact`)](#3-schnorr-verification-schnorrcompact)
- [Contract State Machine](#contract-state-machine)
- [Off-Chain Attester Service](#off-chain-attester-service)
- [Quick Start: Local Devnet](#quick-start-local-devnet)
  - [Prerequisites](#prerequisites)
  - [Automated Setup](#automated-setup)
- [Testing & Quality Checks (Smoke Tests)](#testing--quality-checks-smoke-tests)
- [Multi-Network Support](#multi-network-support)
  - [Supported Networks](#supported-networks)
  - [Deploying to Midnight Preview](#deploying-to-midnight-preview)
- [Wallet Architecture & Lace Compatibility](#wallet-architecture--lace-compatibility)
- [Environment Configuration](#environment-configuration)
- [Available NPM Scripts](#available-npm-scripts)
- [Project Directory Structure](#project-directory-structure)

---

## Overview & Architecture

This package contains the core blockchain logic and attestation infrastructure for the Handshake protocol:

1. **Compact Smart Contracts:** Native ZK contracts written in Compact that manage seller liquidity escrow, reserve tokens against concurrent buyer intents, enforce fill limits, verify Schnorr attestation proofs, and atomically release tokens.
2. **Jubjub Schnorr Verifier:** A specialized in-circuit curve library providing cryptographic signature validation over Twisted Edwards curve points (Jubjub).
3. **Off-Chain DKIM Attester:** An Express/TypeScript microservice that parses raw `.eml` email receipts, verifies cryptographic DKIM signatures against live DNS records, and signs contract-bound claims.
4. **Devnet Orchestration:** Complete Docker Compose stack (Midnight node, GraphQL indexer, and proof server) for zero-dependency local testing.

---

## Smart Contracts & Circuits

```
contracts/
├── handshake-market.compact      # Liquidity escrow, buyer reservation, and atomic settlement
├── handshake-demo-usdc.compact   # Capped test tUSDC unshielded token contract
├── schnorr.compact               # Jubjub curve point operations & Schnorr signature verification
└── hello-world.compact           # Base reference template from create-mn-app
```

### 1. Handshake Market (`handshake-market.compact`)

The primary protocol contract managing the peer-to-peer settlement lifecycle:

- **State Ledgers:**
  - `makerCommitment`: Cryptographic commitment binding the maker secret.
  - `availableLiquidity` & `escrowedBalance`: Real Midnight unshielded tUSDC tokens held in contract escrow.
  - `intentCommitments`, `intentAmounts`, `intentPaymentMinors`, `intentNonces`: Maps storing concurrent buyer reservation state keyed by recipient address.
  - `consumedNullifiers` & `consumedReceipts`: Sets tracking spent replay keys.
- **Key Circuits:**
  - `fundOffer(makerSecret, amount)`: Maker deposits test tUSDC inventory into escrow.
  - `withdrawOffer(makerSecret, recipient, amount)`: Maker recovers unreserved inventory.
  - `reserveIntent(takerSecret, amount, paymentAmountMinor, recipient)`: Buyer locks liquidity for a specific trade amount.
  - `cancelIntent(takerSecret, recipient)`: Buyer releases locked inventory back to the offer pool.
  - `expireIntent(recipient)`: Permissionless release of reserved liquidity if the offer passes its expiry timestamp.
  - `submitPaymentProof(...)`: Atomically verifies the attester's Schnorr signature, verifies provider ID, records the nullifiers to prevent replay, and transfers unshielded tokens to the buyer.

### 2. Demo Token (`handshake-demo-usdc.compact`)

- Mints **Handshake test tUSDC** with 6 decimal places.
- Enforces max supply capacity and minting permissions.
- Supplies the native token domain hex (`NEXT_PUBLIC_DEMO_TOKEN_DOMAIN_HEX`) required for Midnight token routing.

### 3. Schnorr Verification (`schnorr.compact`)

- Implements Twisted Edwards point addition and scalar multiplication for the Jubjub curve.
- Computes deterministic challenge digests (`schnorrChallenge`).
- Verifies that $s \cdot G == R + e \cdot PK$ within the zero-knowledge circuit, ensuring non-forgeable off-chain attestations.

---

## Contract State Machine

The diagram below details the state lifecycle of an offer and its buyer intents:

```
                  ┌────────────────────────┐
                  │      Unfunded Offer    │
                  └───────────┬────────────┘
                              │ fundOffer()
                              ▼
                     ┌──────────────────┐
        ┌───────────►│   Offer Funded   │◄───────────┐
        │            └────────┬─────────┘            │
        │ cancelIntent()      │ reserveIntent()      │ expireIntent()
        │                     ▼                      │
        └─────────────[ Intent Active ]──────────────┘
                              │
                              │ submitPaymentProof()
                              │ (Verifies Schnorr + Replay check)
                              ▼
                  ┌────────────────────────┐
                  │    Atomic Payout &     │
                  │   Nullifiers Consumed  │
                  └────────────────────────┘
```

---

## Off-Chain Attester Service

The attester (`src/attester-server.ts`) bridges off-chain payment receipts with on-chain Compact verification:

```
  Raw .eml File (Gmail)
           │
           ▼
  [ 1. DKIM Verification ] ──► Validates RSA-SHA256 signature against DNS public key
           │
           ▼
  [ 2. Claim Matching ]    ──► Matches recipient, amount, currency, and trade reference
           │
           ▼
  [ 3. Jubjub Schnorr ]    ──► Signs contractId, buyerCommitment, amount, receipt, & nullifier
           │
           ▼
  Returns { signature, quotient, challengeRemainder } to Buyer for on-chain submission
```

### Production Route
- `POST /v1/demo/gmail/dkim-attest`
- Input: JSON payload with `emailRaw` (or `emailBase64`), `contractId`, `buyerCommitment`, `recipient`, `nullifier`.
- Verification: Full RFC-822 MIME parsing via `mailauth`, DNS TXT record DKIM lookup, verification of `From`, `To`, and `Subject` headers.

### Synthetic / Local Smoke Route
- `POST /v1/paypal/attest`
- Uses synthetic test emails generated via `npm run demo:email` for offline unit testing without external network or DNS dependencies.

---

## Quick Start: Local Devnet

### Prerequisites

- **Node.js:** `v22.0.0` or newer
- **Docker & Docker Compose v2:** Running locally
- **Compact Compiler:** `v0.31.1` (pinned in `.compact-version`)

> [!NOTE]
> **Windows Users:** The Compact compiler currently does not distribute a native Windows binary. Run `npm run compile:all` and `npm run setup` inside **WSL (Windows Subsystem for Linux)** or via Docker. The TypeScript test scripts and devnet services can be accessed from PowerShell.

---

### Automated Setup

From the `midnight-contract` directory, run:

```bash
npm install
npm run setup
```

`npm run setup` executes an end-to-end initialization workflow:
1. Starts the local Docker devnet (`docker compose up -d --wait`) with healthchecks.
2. Compiles all Compact contracts (`contracts/handshake-demo-usdc.compact` and `contracts/handshake-market.compact`).
3. Deploys the test token, mints initial inventory, and deploys the funded marketplace offer.

Devnet services started:

| Service | Port | Endpoint / Purpose |
| :--- | :---: | :--- |
| **Node** | `9944` | Midnight blockchain substrate node (`dev` preset) |
| **Indexer** | `8088` | GraphQL indexer API for public chain state |
| **Proof Server** | `6300` | Local client-side Zero-Knowledge proof generation |

To stop the devnet:

```bash
docker compose down -v
```

---

## Testing & Quality Checks (Smoke Tests)

The repository provides comprehensive contract smoke tests targeting the local devnet:

### 1. Reservation & Cancellation Flow
Tests `reserveIntent` and `cancelIntent` against live ledger state:

```bash
npm run market:smoke -- --network undeployed
```
- Submits an on-chain reservation intent with a generated taker secret.
- Verifies that available liquidity decrements correctly.
- Cancels the intent and confirms that liquidity returns to the open pool.

### 2. End-to-End Payment Proof Flow
Tests the full cryptographic attestation and settlement pipeline:

```bash
# Terminal 1: Start the local attester service
npm run attester:start

# Terminal 2: Run the payment smoke test
npm run market:payment-smoke -- --network undeployed
```
- Creates an intent on the market contract.
- Generates a synthetic receipt and validates its DKIM signature.
- Requests a Jubjub Schnorr attestation from the attester.
- Submits `submitPaymentProof` with the ZK proof.
- Asserts that token escrow decreases, tokens are transferred, and both nullifier sets are marked consumed.

---

## Multi-Network Support

### Supported Networks

| Network ID | Target Environment | Faucet URL |
| :--- | :--- | :--- |
| `undeployed` | Local Docker devnet (default) | Pre-funded via genesis seed |
| `preview` | Public Midnight Preview testnet | [Midnight Preview Faucet](https://midnight-tmnight-preview.nethermind.dev) |
| `preprod` | Public Midnight Preprod testnet | [Midnight Preprod Faucet](https://midnight-tmnight-preprod.nethermind.dev) |

Network selection is **sticky**:

```bash
# Switch active network
npm run network preview

# Check current active network
npm run network

# Switch back to local devnet
npm run network undeployed
```

---

### Deploying to Midnight Preview

To deploy fresh contracts to the live **Midnight Preview** network:

```bash
npm run setup -- --network preview --fresh-demo
```

1. On first run, the script outputs your generated 24-word recovery phrase and public wallet address.
2. Visit the faucet, paste your address, and request `tNIGHT`.
3. The setup script will automatically poll the indexer until funds are detected.
4. Once deployed, copy the output addresses into your root `.env.local`:
   - `NEXT_PUBLIC_MARKET_CONTRACT_ADDRESS`
   - `NEXT_PUBLIC_DEMO_TOKEN_ADDRESS`
   - `NEXT_PUBLIC_DEMO_TOKEN_DOMAIN_HEX`

---

## Wallet Architecture & Lace Compatibility

Public network wallets use standard BIP-39 mnemonic phrases with `mnemonicToSeed` derivation:

- **Lace Compatible:** Seeds are derived identically to the Lace browser wallet. A mnemonic generated here restores the exact same account in Lace, and vice versa.
- **Importing a Lace Wallet:**
  ```bash
  read -s MIDNIGHT_WALLET_MNEMONIC && export MIDNIGHT_WALLET_MNEMONIC
  npm run deploy
  ```
- **Sync State Cache:** Serialized wallet checkpoints are persisted in `.midnight-wallet-state/<network>/` to skip re-indexing from genesis on subsequent runs.

---

## Environment Configuration

Configure variables in `midnight-contract/.env`:

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `HANDSHAKE_ATTESTER_SECRET_KEY` | 32-byte hex scalar for the attester's Jubjub private key | Generated via `npm run attester:keygen` |
| `RESEND_DEMO_RECEIPT_SECRET` | Shared secret shared between the Next.js frontend and attester | Random 32-byte hex string |
| `HANDSHAKE_SYNTHETIC_DKIM_PRIVATE_KEY` | Base64 PEM RSA private key for synthetic fixtures | Generated via `npm run dkim:keygen` |
| `HANDSHAKE_SYNTHETIC_DKIM_PUBLIC_KEY` | Base64 PEM RSA public key for synthetic verification | Generated via `npm run dkim:keygen` |
| `PORT` | HTTP port for the attester server | `8787` |
| `MIDNIGHT_PROOF_SERVER_URL` | Local or remote proof server endpoint | `http://127.0.0.1:6300` |
| `MIDNIGHT_BLOCKFROST_PROJECT_ID` | Blockfrost project token (required for Preprod only) | Optional |

---

## Available NPM Scripts

| Script | Command | Purpose |
| :--- | :--- | :--- |
| `npm run setup` | `tsx src/setup.ts` | One-shot devnet start, contract compilation, and deployment |
| `npm run compile:all` | `compile:demo-token && compile:market` | Compiles both Compact contracts |
| `npm run compile:market` | `compact compile contracts/handshake-market.compact` | Compiles the marketplace contract |
| `npm run compile:demo-token` | `compact compile contracts/handshake-demo-usdc.compact` | Compiles the test tUSDC contract |
| `npm run deploy` | `tsx src/deploy.ts` | Deploys contracts to the currently active network |
| `npm run attester:start` | `tsx src/attester-server.ts` | Starts the HTTP DKIM / Jubjub attester service |
| `npm run attester:keygen` | `tsx src/attester-keygen.ts` | Generates a new Jubjub key pair for the attester |
| `npm run dkim:keygen` | `tsx src/synthetic-dkim-keygen.ts` | Generates RSA key pair for synthetic email fixtures |
| `npm run demo:email` | `tsx src/synthetic-email-demo.ts` | Creates a signed synthetic `.eml` test fixture |
| `npm run market:smoke` | `tsx src/market-smoke.ts` | Smoke test for reservation and cancellation circuits |
| `npm run market:payment-smoke`| `tsx src/market-payment-smoke.ts` | Full smoke test for payment proof and token release |
| `npm run network` | `tsx src/network.ts` | Inspects or switches the active target network |
| `npm run check-balance` | `tsx src/check-balance.ts` | Displays NIGHT and DUST balances for current wallet |
| `npm run proof-server:start` | `docker compose up -d` | Starts the proof server container |
| `npm run proof-server:stop` | `docker compose down` | Stops devnet containers |
| `npm run clean` | `node scripts/clean.mjs` | Cleans build artifacts, wallet cache, and state files |

---

## Project Directory Structure

```
midnight-contract/
├── contracts/
│   ├── handshake-market.compact      # Marketplace contract (escrow, reservations, claims)
│   ├── handshake-demo-usdc.compact   # Test tUSDC token contract
│   ├── schnorr.compact               # Jubjub Schnorr signature verification circuit
│   └── hello-world.compact           # create-mn-app template reference
├── scripts/
│   └── clean.mjs                     # Cleanup utility for cache and generated artifacts
├── src/
│   ├── attester-server.ts            # Express HTTP service verifying DKIM and issuing claims
│   ├── attester-keygen.ts            # Jubjub key generator
│   ├── synthetic-dkim-keygen.ts      # RSA key generator for synthetic tests
│   ├── synthetic-email-demo.ts       # Synthetic fixture generator
│   ├── market-smoke.ts               # Reservation/cancellation test runner
│   ├── market-payment-smoke.ts       # Payment proof/token release test runner
│   ├── network.ts                    # Network resolution, configs, and state management
│   ├── wallet.ts                     # BIP-39 wallet derivation and sync state cache
│   ├── deploy.ts                     # Contract deployment orchestrator
│   ├── setup.ts                      # Full setup runner
│   ├── cli.ts                        # Interactive CLI
│   └── check-balance.ts              # Balance query utility
├── Dockerfile.attester               # Container build definition for the attester
├── docker-compose.yml                # Midnight node, indexer, and proof-server services
├── ATTESTOR_DEPLOYMENT.md            # Standalone attester hosting and deployment guide
├── .compact-version                  # Pinned Compact compiler version (0.31.1)
├── package.json
└── tsconfig.json
```

---

<p align="center">
  Part of the <a href="../README.md"><b>Handshake Protocol</b></a> • Built for the Midnight Network
</p>
