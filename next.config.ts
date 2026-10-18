import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Keep the Compact context symbol shared between the generated contract and
  // midnight-js-contracts. Mixing ESM/CJS copies loses the constructor stored
  // by CompiledContract.make(), causing reserve/callTx to fail with an
  // undefined `ctor` when the contract is instantiated in Next's client bundle.
  transpilePackages: [
    "@midnight-ntwrk/compact-js",
    "@midnight-ntwrk/compact-runtime",
    "@midnight-ntwrk/ledger-v8",
    "@midnight-ntwrk/midnight-js-contracts",
    "@midnight-ntwrk/midnight-js-protocol",
  ],
  turbopack: {
    resolveAlias: {
      "isomorphic-ws": "./src/lib/isomorphic-ws-shim.ts",
      // Midnight packages exchange WASM-backed ledger/runtime classes. Pin
      // each package to one entry per platform so Turbopack cannot instantiate
      // duplicate class constructors across the SDK and generated contract.
      "@midnight-ntwrk/ledger-v8": {
        browser: "./node_modules/@midnight-ntwrk/ledger-v8/midnight_ledger_wasm.js",
        node: "./node_modules/@midnight-ntwrk/ledger-v8/midnight_ledger_wasm_fs.js",
      },
      "@midnight-ntwrk/onchain-runtime-v3": {
        browser: "./node_modules/@midnight-ntwrk/onchain-runtime-v3/midnight_onchain_runtime_wasm.js",
        node: "./node_modules/@midnight-ntwrk/onchain-runtime-v3/midnight_onchain_runtime_wasm_fs.js",
      },
      "@midnight-ntwrk/compact-runtime": "./node_modules/@midnight-ntwrk/compact-runtime/dist/index.js",
    },
  },
  webpack(config, { isServer }) {
    config.resolve.alias["isomorphic-ws"] = path.resolve(process.cwd(), "src/lib/isomorphic-ws-shim.ts");
    if (!isServer) {
      config.resolve.alias["@midnight-ntwrk/ledger-v8"] = path.resolve(
        process.cwd(),
        "node_modules/@midnight-ntwrk/ledger-v8/midnight_ledger_wasm.js",
      );
      config.resolve.alias["@midnight-ntwrk/onchain-runtime-v3"] = path.resolve(
        process.cwd(),
        "node_modules/@midnight-ntwrk/onchain-runtime-v3/midnight_onchain_runtime_wasm.js",
      );
    }
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    config.target = isServer ? "node22" : ["web", "es2022"];
    return config;
  },
};

export default nextConfig;
