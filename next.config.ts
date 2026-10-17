import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      "isomorphic-ws": "./src/lib/isomorphic-ws-shim.ts",
    },
  },
  webpack(config, { isServer }) {
    config.resolve.alias["isomorphic-ws"] = path.resolve(process.cwd(), "src/lib/isomorphic-ws-shim.ts");
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    config.target = isServer ? "node22" : ["web", "es2022"];
    return config;
  },
};

export default nextConfig;
