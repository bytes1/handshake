# Peer on Midnight

A Next.js app foundation for a Peer-inspired social experience built on Midnight. It includes the frontend scaffold, shadcn/ui setup, and a backend health endpoint. A separate official Midnight contract workspace is initialized under `midnight-contract/`; connecting that contract to the Next.js app is a later build step.

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

## Midnight contract workspace

The separate [Midnight contract workspace](./midnight-contract/README.md) contains a Compact hello-world contract and scripts for compiling and deploying it to the bundled local devnet. Its demo stores the supplied message publicly; it is only a toolchain smoke example, not the privacy model for social posts or profiles. The Compact compiler must run under WSL on this Windows machine, and local deployment also needs Docker Desktop running.
