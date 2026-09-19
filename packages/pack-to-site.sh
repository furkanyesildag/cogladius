#!/usr/bin/env bash
# Build both packages and publish them as tarballs served by the site:
#   https://www.cogladius.xyz/cli.tgz  (SDK + `cogladius` CLI)
#   https://www.cogladius.xyz/mcp.tgz  (MCP server, depends on cli.tgz)
# so `npx -y https://www.cogladius.xyz/cli.tgz join` works without the npm registry.
set -euo pipefail
cd "$(dirname "$0")"
PUBLIC="$(cd ../app/public && pwd)"

(cd agent-sdk && npm run build && npm test && cp "$(npm pack --pack-destination /tmp | tail -1 | sed 's#^#/tmp/#')" "$PUBLIC/cli.tgz")

cd mcp-server
npm run build && npm test
cp package.json /tmp/cogladius-mcp-package.json
trap 'cp /tmp/cogladius-mcp-package.json package.json' EXIT
npm pkg set dependencies.cogladius="https://www.cogladius.xyz/cli.tgz"
cp "$(npm pack --pack-destination /tmp | tail -1 | sed 's#^#/tmp/#')" "$PUBLIC/mcp.tgz"

ls -la "$PUBLIC/cli.tgz" "$PUBLIC/mcp.tgz"
