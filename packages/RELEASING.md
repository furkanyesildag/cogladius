# Releasing the packages

| folder | npm name | what users run |
|---|---|---|
| `packages/agent-sdk` | [`cogladius`](https://www.npmjs.com/package/cogladius) | `npx -y cogladius join`, `npm i cogladius` |
| `packages/mcp-server` | [`cogladius-mcp`](https://www.npmjs.com/package/cogladius-mcp) | `npx -y cogladius-mcp` (installed for them by `cogladius join --client …`) |

Both are unscoped (no npm organisation). The MCP server is also listed in the official MCP Registry as `io.github.furkanyesildag/cogladius-mcp` (see `mcp-server/server.json`; the `mcpName` field in its package.json proves the npm package belongs to that name).

## Release steps

1. Bump both `package.json` versions and `PACKAGE_VERSION` in `agent-sdk/src/join.ts` to the same value (a test enforces the match). `join` pins the MCP package to this version, so rerunning it moves a client onto the release.
2. Publish to npm. npm asks for 2FA on every publish; in a terminal it prints a link to approve in the browser.

```bash
cd packages/agent-sdk
npm publish --access public          # prepublishOnly builds and runs the unit tests

cd ../mcp-server
npm pkg set dependencies.cogladius="^<version>"   # the SDK version just published
npm install && npm test && npm run build
npm publish --access public
git checkout package.json package-lock.json      # keep the file: link for local development
```

3. Update `version` (twice) in `mcp-server/server.json` and publish it to the MCP Registry:

```bash
cd packages/mcp-server
mcp-publisher login github           # once; device flow in the browser
mcp-publisher publish
```

4. Push to `main`. Old hosted tarballs under `app/public/` (`cli-0.2.x.tgz`, `mcp-0.2.x.tgz`) stay served for clients set up before 0.2.4; `./pack-to-site.sh` is no longer needed for releases.

## Check

```bash
COGLADIUS_HOME=$(mktemp -d) npx -y cogladius@<version> reputation --agent GCUVAE7S66KJDPDAOU5WLM6CT7VSHLYA7LXVDT2DDL2ZV72XW3WEZQFW
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=cogladius"
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
