# Standalone Gmail DKIM attestor

The Handshake attestor is an HTTP service that checks the original Gmail `.eml` receipt, validates its DKIM signature and trade-specific receipt claims, then returns a signed attestation for the Midnight contract. It can run on a public container host independently of the Next.js frontend.

This flow is for the Preview test network and clearly marked demo receipts. A passing Gmail DKIM signature proves that Gmail signed the message; it does not prove that an external payment happened or that the recipient owns a particular inbox.

## Build and run locally

From the repository's `midnight-contract` directory:

```sh
cd midnight-contract
npm ci
docker build -f Dockerfile.attester -t handshake-gmail-attestor .
docker run --rm -p 8787:8787 --env-file .env handshake-gmail-attestor
```

Create `midnight-contract/.env` from `.env.example` for local use. Do not commit `.env`. Check `http://localhost:8787/healthz`; a healthy service returns JSON with `"status":"ok"`.

The frontend defaults to `http://127.0.0.1:8787` for local development. For a remote deployment, set the frontend's `NEXT_PUBLIC_ATTESTER_URL` to the attestor's HTTPS base URL and rebuild/redeploy the frontend. Next.js embeds `NEXT_PUBLIC_*` values into the browser bundle at build time.

## Deploy as a container

Create a web service from this repository with its Docker build context set to `midnight-contract` and Dockerfile set to `Dockerfile.attester`. The included Dockerfile installs the service dependencies and runs the standalone attestor. Configure the host to provide HTTPS and route its assigned port to the container's `PORT` variable. The service listens on `0.0.0.0` in production.

Set these environment variables in the host's secret/environment settings:

| Variable | Required value |
| --- | --- |
| `NODE_ENV` | `production` |
| `HANDSHAKE_ATTESTER_HOST` | `0.0.0.0` |
| `PORT` | The port supplied by the host (often injected automatically) |
| `HANDSHAKE_ATTESTER_ALLOWED_ORIGINS` | Comma-separated exact frontend origins, such as `https://app.example.com`; no path or trailing slash |
| `HANDSHAKE_ATTESTER_SECRET_KEY` | The private signing key whose public key is configured in the deployed marketplace contract |
| `RESEND_DEMO_RECEIPT_SECRET` | The same random secret used by the frontend receipt-sending API |
| `HANDSHAKE_DEMO_RECEIPT_FROM` | The Gmail sender address used for the demo receipt |
| `HANDSHAKE_ATTESTER_RATE_LIMIT_PER_MINUTE` | Optional; defaults to `20` requests per source IP per minute |
| `HANDSHAKE_ATTESTER_TRUST_PROXY` | Optional; set to `1` only when the platform sanitizes/replaces `X-Forwarded-For` |

The frontend also sends demo receipt email. Configure its server-side Gmail SMTP variables and `RESEND_DEMO_RECEIPT_SECRET` in the frontend host. The receipt secret values on the frontend and attestor must match. Keep all private keys, app passwords, and receipt secrets server-side; never place them in a `NEXT_PUBLIC_*` variable.

Use the existing attester key that matches the contract's configured public key. Generating a different key without updating and redeploying the contract causes on-chain verification to fail. The frontend's `NEXT_PUBLIC_ATTESTER_URL` is the only public attestor setting.

Configure the host health check as `GET /healthz`. Restrict CORS to the actual frontend origin(s). CORS only limits browser origins; it does not authenticate callers. The built-in rate limit is per-process memory, so enable the hosting provider's edge rate limiting for a public deployment with multiple replicas. The `.eml` contents are sent to this service for verification; deploy it only where you are comfortable processing the receipt email data.

## Frontend setup

Set the following on the frontend deployment **before its build**:

```env
NEXT_PUBLIC_ATTESTER_URL=https://attestor.example.com
```

Add the same origin (`https://app.example.com`) to `HANDSHAKE_ATTESTER_ALLOWED_ORIGINS` on the attestor. If you use a preview/staging frontend, add each exact origin as a comma-separated entry. Redeploy both services after changing environment settings.

The browser submits the uploaded original `.eml` to:

```text
POST https://attestor.example.com/v1/demo/gmail/dkim-attest
Content-Type: application/json
```

The request and response are application-internal and are sent by the frontend code; callers should use the normal upload and verify controls in the app. An invalid signature, mismatched recipient/trade/receipt token, expired or altered claim, wrong attester key, or already-consumed receipt is rejected by the verifier or contract.

## Deployable source artifact

The service imports the generated pure-circuit module at `contracts/managed/handshake-market/contract/index.js`. This file is normally ignored as a generated artifact. It must exist in the Docker build context and be included in the repository/deployment source for a remote build. If it is missing, compile the marketplace contract with the project's supported Compact toolchain, then include this one generated JavaScript module in the deployment commit. The Docker build intentionally excludes the other generated managed artifacts.

## Troubleshooting

- **Health check fails or host says port unavailable:** confirm the service binds `0.0.0.0` and uses the host-injected `PORT`.
- **Browser CORS error:** add the browser's exact origin to `HANDSHAKE_ATTESTER_ALLOWED_ORIGINS`, then restart/redeploy the attestor.
- **Attestor URL/network error:** use the deployed HTTPS URL in `NEXT_PUBLIC_ATTESTER_URL`, then rebuild the frontend.
- **Missing environment or startup error:** check required secret values and ensure `HANDSHAKE_ATTESTER_SECRET_KEY` parses successfully.
- **DKIM/body hash or signed-header error:** upload the original Gmail downloaded `.eml` unchanged. In Gmail use **Show original → Download original**; do not paste, forward, or edit it. Its passing DKIM signature must cover `From`, `To`, and `Subject`.
- **Receipt token/recipient/trade mismatch:** send a fresh demo receipt for the active reservation to the same address, download that message's original `.eml`, and upload it for that reservation.
- **Contract signature verification failure:** verify the service uses the private key matching the attester public key stored in the deployed contract.

