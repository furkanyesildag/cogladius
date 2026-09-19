const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  experimental: {
    // The agent SDK source (../packages/agent-sdk) is compiled into the app so
    // the leaderboard, relayer and MPP provider run the exact same code the
    // published SDK ships.
    externalDir: true,
    // MPP libraries are ESM with optional peers (viem/ox tempo, MCP) that
    // webpack cannot tree-shake safely; load them from node_modules at runtime.
    serverComponentsExternalPackages: ["@stellar/mpp", "mppx", "viem", "ox", "@modelcontextprotocol/sdk"],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        fs: false,
        path: false,
        os: false,
        crypto: false,
        stream: false,
        http: false,
        https: false,
        zlib: false,
      };
    }
    config.resolve.alias = {
      ...config.resolve.alias,
      "@cogladius/agent-sdk": path.resolve(__dirname, "../packages/agent-sdk/src"),
    };
    // SDK sources use NodeNext-style ".js" specifiers for ".ts" files.
    config.resolve.extensionAlias = { ".js": [".ts", ".js"] };
    // Resolve every dependency (including the SDK's) from the app's
    // node_modules, so there is exactly one copy of @stellar/stellar-sdk.
    config.resolve.modules = [path.resolve(__dirname, "node_modules"), "node_modules"];
    return config;
  },
};

module.exports = nextConfig;
