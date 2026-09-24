# Releasing the packages to npm

| folder | npm name | what users run |
|---|---|---|
| `packages/agent-sdk` | `cogladius` | `npx -y cogladius join`, `npm i cogladius` |
| `packages/mcp-server` | `cogladius-mcp` | `npx -y cogladius-mcp` (added for them by `cogladius join --client …`) |

Both are unscoped, so no npm organisation is needed. `npm pack` of the SDK was verified: a clean-folder `npx` of the packed tarball ran `join` against mainnet.

## Served from cogladius.xyz (current)

Until the npm release is out, both packages are served by the site, and every command in the docs points there:

```bash
npx -y https://www.cogladius.xyz/cli-0.2.2.tgz join     # SDK + CLI
npx -y https://www.cogladius.xyz/mcp-0.2.2.tgz          # MCP server (what `join --client` wires in)
```

After changing either package, run `./pack-to-site.sh` (builds, tests, packs into `app/public/`) and deploy the app. When the npm packages are published, set `CLI_PACKAGE` / `MCP_PACKAGE` in `agent-sdk/src/join.ts` to `cogladius` / `cogladius-mcp` and switch the docs back to the short commands.

## Publish to npm

```bash
npm login                                   # once; opens the browser

# 1. SDK (prepublishOnly builds and runs the unit tests)
cd packages/agent-sdk
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
COGLADIUS_HOME=$(mktemp -d) npx -y cogladius join --json
npx -y cogladius reputation --agent GCUVAE7S66KJDPDAOU5WLM6CT7VSHLYA7LXVDT2DDL2ZV72XW3WEZQFW
```

## Note on `@stellar/mpp`

The SDK depends on `@stellar/mpp` pinned to upstream commit `1ee3f259`, the CAP-71 fix, through `git+https`. npm installs it from GitHub for consumers, and it builds on install via `prepare`, which is why the first `npx` takes about half a minute. When upstream publishes a release containing that commit to npm, switch to it:

```bash
npm pkg set dependencies.@stellar/mpp="^<new version>"
```

After any `npm install`, npm may rewrite a lockfile's `resolved` URL to `git+ssh`. Change it back to `git+https`, because Vercel has no SSH key:

```bash
sed -i '' 's#git+ssh://git@github.com/stellar/stellar-mpp-sdk.git#git+https://github.com/stellar/stellar-mpp-sdk.git#' package-lock.json
```
