#!/usr/bin/env bash
# Build both packages and serve them from the site as versioned tarballs:
#   https://www.cogladius.xyz/cli-<version>.tgz  (SDK + `cogladius` CLI)
#   https://www.cogladius.xyz/mcp-<version>.tgz  (MCP server, depends on the cli tarball)
# npx caches a tarball URL forever, so every release must get a new URL:
# bump "version" in both package.json files and PACKAGE_VERSION in
# agent-sdk/src/join.ts (a unit test keeps them in sync), then run this.
set -euo pipefail
cd "$(dirname "$0")"
PUBLIC="$(cd ../app/public && pwd)"
V="$(node -p "require('./agent-sdk/package.json').version")"
[ "$V" = "$(node -p "require('./mcp-server/package.json').version")" ] || { echo "version mismatch between packages" >&2; exit 1; }
[ -e "$PUBLIC/cli-$V.tgz" ] && { echo "cli-$V.tgz already exists: bump the version (npx would keep serving the cached one)" >&2; exit 1; }

(cd agent-sdk && npm run build && npm test && cp "/tmp/$(npm pack --pack-destination /tmp | tail -1)" "$PUBLIC/cli-$V.tgz")

cd mcp-server
npm run build && npm test
cp package.json /tmp/cogladius-mcp-package.json
trap 'cp /tmp/cogladius-mcp-package.json package.json' EXIT
npm pkg set dependencies.cogladius="https://www.cogladius.xyz/cli-$V.tgz"
cp "/tmp/$(npm pack --pack-destination /tmp | tail -1)" "$PUBLIC/mcp-$V.tgz"

# Unversioned aliases stay for older links; docs always use the versioned URLs.
cp "$PUBLIC/cli-$V.tgz" "$PUBLIC/cli.tgz"
cp "$PUBLIC/mcp-$V.tgz" "$PUBLIC/mcp.tgz"
ls -la "$PUBLIC"/*.tgz
