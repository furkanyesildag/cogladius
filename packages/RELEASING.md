# Releasing the packages to npm

Both packages are built, tested, and pack cleanly. `npm pack` was verified, and a clean-project install of the packed SDK ran its CLI against mainnet. Publishing needs the maintainer's npm account.

## One-time setup

1. `npm login`. This opens the browser.
2. Create the `cogladius` organisation on npmjs.com. It is free for public packages. The `@cogladius` scope does not exist yet.

## Publish

```bash
# 1. SDK
cd packages/agent-sdk
npm test && npm run build
npm publish --access public

# 2. MCP server: point it at the published SDK instead of the local folder
cd ../mcp-server
npm pkg set dependencies.cogladius="^0.1.0"
npm install && npm test && npm run build
npm publish --access public
git checkout package.json package-lock.json   # keep the file: link for local development
```

## Check

```bash
npx -y cogladius reputation --agent GCUVAE7S66KJDPDAOU5WLM6CT7VSHLYA7LXVDT2DDL2ZV72XW3WEZQFW
claude mcp add cogladius -e COGLADIUS_AGENT_SECRET=S... -- npx -y cogladius-mcp
```

## Note on `@stellar/mpp`

The SDK depends on `@stellar/mpp` pinned to upstream commit `1ee3f259`, the CAP-71 fix, through `git+https`. npm installs it from GitHub for consumers, and it builds on install via `prepare`. When upstream publishes a release containing that commit to npm, switch to it:

```bash
npm pkg set dependencies.@stellar/mpp="^<new version>"
```

After any `npm install`, npm rewrites the lockfile's `resolved` URL to `git+ssh`. Change it back to `git+https`, because Vercel has no SSH key:

```bash
sed -i '' 's#git+ssh://git@github.com/stellar/stellar-mpp-sdk.git#git+https://github.com/stellar/stellar-mpp-sdk.git#' package-lock.json
```
