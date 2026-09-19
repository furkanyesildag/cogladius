/**
 * `cogladius join`: one command that turns any machine (or any AI agent with
 * a shell) into a registered Cogladius agent.
 *
 *   1. Reuse ~/.cogladius/agent.json, or create a fresh Stellar key.
 *   2. Register with a SEP-53 signed challenge and keep the API key.
 *   3. Check the account is funded (payouts need an existing account).
 *   4. Optionally wire the MCP server into Claude Code, Cursor or Codex.
 *      The MCP entry carries no secret: the server reads agent.json.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join as joinPath } from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { CogladiusClient } from "./client.js";
import { resolveNetwork } from "./network.js";
import { KeypairSigner } from "./signer.js";
import { identityPath, loadIdentity, saveIdentity, type AgentIdentity } from "./identity.js";

export type McpClientName = "claude" | "cursor" | "codex";

export interface JoinOptions {
  name?: string;
  network?: "mainnet" | "testnet";
  apiBaseUrl?: string;
  /** Use this secret instead of the stored or a new one. */
  secret?: string;
  rotateApiKey?: boolean;
  clients?: McpClientName[];
}

export interface JoinResult {
  publicKey: string;
  apiKey: string;
  network: "mainnet" | "testnet";
  identityFile: string;
  created: boolean;
  alreadyRegistered: boolean;
  funded: boolean;
  xlmBalance: string;
  mcp: { client: McpClientName; status: "added" | "already-present" | "skipped"; detail?: string }[];
  explorer: string;
}

export interface JoinDeps {
  fetch?: typeof fetch;
  identityFile?: string;
  home?: string;
  /** Runs an external command; returns its exit code. */
  run?: (cmd: string, args: string[]) => number | null;
}

export const MCP_PACKAGE = "@cogladius/mcp-server";
const MCP_ARGS = ["-y", MCP_PACKAGE];

export async function join(opts: JoinOptions = {}, deps: JoinDeps = {}): Promise<JoinResult> {
  const file = deps.identityFile ?? identityPath();
  const doFetch = deps.fetch ?? globalThis.fetch;
  const existing = loadIdentity(file);

  let identity: AgentIdentity;
  let created = false;
  if (opts.secret) {
    const kp = Keypair.fromSecret(opts.secret);
    if (existing && existing.publicKey !== kp.publicKey()) {
      // Never overwrite a key that may hold funds or earned reputation.
      throw new Error(
        `${file} already holds agent ${existing.publicKey}. Move it away or set COGLADIUS_HOME to join with a different key.`
      );
    }
    identity = existing ?? { version: 1, network: opts.network ?? "mainnet", publicKey: kp.publicKey(), secret: opts.secret, createdAt: new Date().toISOString() };
  } else if (existing) {
    identity = existing;
  } else {
    const kp = Keypair.random();
    identity = { version: 1, network: opts.network ?? "mainnet", publicKey: kp.publicKey(), secret: kp.secret(), createdAt: new Date().toISOString() };
    created = true;
  }
  // An API key belongs to one deployment: switching network or API drops it.
  if ((opts.network && opts.network !== identity.network) || (opts.apiBaseUrl && opts.apiBaseUrl !== identity.apiBaseUrl)) {
    delete identity.apiKey;
  }
  if (opts.network) identity.network = opts.network;
  if (opts.apiBaseUrl) identity.apiBaseUrl = opts.apiBaseUrl;
  if (opts.name) identity.name = opts.name;
  identity.name ??= `agent_${identity.publicKey.slice(-6)}`;
  // Persist the key before any network call, so a failure later never loses it.
  saveIdentity(identity, file);

  const net = resolveNetwork(identity.network, { apiBaseUrl: identity.apiBaseUrl });
  const client = new CogladiusClient({
    signer: KeypairSigner.fromSecret(identity.secret),
    network: net,
    apiKey: opts.rotateApiKey ? undefined : identity.apiKey,
    profile: { name: identity.name },
    fetch: doFetch,
  });
  let alreadyRegistered = !!identity.apiKey && !opts.rotateApiKey;
  if (!alreadyRegistered) {
    const reg = await client.register({ rotateApiKey: opts.rotateApiKey });
    identity.apiKey = reg.apiKey;
    alreadyRegistered = reg.alreadyRegistered;
    saveIdentity(identity, file);
  }

  const res = await doFetch(`${net.horizonUrl}/accounts/${identity.publicKey}`);
  const acct: any = res.status === 404 ? null : await res.json();
  const xlmBalance: string = acct?.balances?.find((b: any) => b.asset_type === "native")?.balance ?? "0";

  const mcp = (opts.clients ?? []).map((c) => addMcp(c, deps));

  return {
    publicKey: identity.publicKey,
    apiKey: identity.apiKey!,
    network: identity.network,
    identityFile: file,
    created,
    alreadyRegistered,
    funded: !!acct,
    xlmBalance,
    mcp,
    explorer: `https://stellar.expert/explorer/${identity.network === "mainnet" ? "public" : "testnet"}/account/${identity.publicKey}`,
  };
}

function defaultRun(cmd: string, args: string[]): number | null {
  return spawnSync(cmd, args, { stdio: "ignore" }).status;
}

export function addMcp(client: McpClientName, deps: JoinDeps = {}): JoinResult["mcp"][number] {
  const home = deps.home ?? homedir();
  const run = deps.run ?? defaultRun;
  if (client === "claude") {
    if (run("claude", ["--version"]) !== 0) return { client, status: "skipped", detail: "claude CLI not found on PATH" };
    if (run("claude", ["mcp", "get", "cogladius"]) === 0) return { client, status: "already-present" };
    const code = run("claude", ["mcp", "add", "--scope", "user", "cogladius", "--", "npx", ...MCP_ARGS]);
    return code === 0 ? { client, status: "added" } : { client, status: "skipped", detail: `claude mcp add exited ${code}` };
  }
  if (client === "cursor") {
    const path = joinPath(home, ".cursor", "mcp.json");
    const cfg = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
    cfg.mcpServers ??= {};
    if (cfg.mcpServers.cogladius) return { client, status: "already-present", detail: path };
    cfg.mcpServers.cogladius = { command: "npx", args: MCP_ARGS };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
    return { client, status: "added", detail: path };
  }
  const path = joinPath(home, ".codex", "config.toml");
  const toml = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (/^\[mcp_servers\.cogladius\]/m.test(toml)) return { client, status: "already-present", detail: path };
  mkdirSync(dirname(path), { recursive: true });
  const block = `[mcp_servers.cogladius]\ncommand = "npx"\nargs = ${JSON.stringify(MCP_ARGS)}\n`;
  writeFileSync(path, toml + (toml && !toml.endsWith("\n") ? "\n" : "") + (toml ? "\n" : "") + block);
  return { client, status: "added", detail: path };
}

/** Human-readable summary for the terminal. */
export function formatJoin(r: JoinResult): string {
  const lines = [
    ``,
    `  ✓ Cogladius agent ready on ${r.network}`,
    ``,
    `    address    ${r.publicKey}`,
    `    status     ${r.alreadyRegistered ? "already registered (same API key)" : "registered"}`,
    `    identity   ${r.identityFile}  (key + API key, owner-only)`,
    `    balance    ${r.funded ? `${r.xlmBalance} XLM` : "not funded yet"}`,
  ];
  if (!r.funded) {
    lines.push(
      ``,
      `  ! Fund this address with a few XLM (2 to 5 is plenty) before you can be paid:`,
      `    a payout needs an existing account, and buying data needs fees.`,
      `    ${r.explorer}`
    );
  }
  for (const m of r.mcp) {
    const what = m.status === "added" ? "MCP server added" : m.status === "already-present" ? "MCP server already configured" : `MCP not configured (${m.detail})`;
    lines.push(``, `  ${m.status === "skipped" ? "!" : "✓"} ${m.client}: ${what}${m.status !== "skipped" && m.detail ? ` in ${m.detail}` : ""}`);
  }
  if (r.mcp.length === 0) {
    lines.push(
      ``,
      `  Connect your AI agent (no secret needed, the server reads ${r.identityFile}):`,
      `    Claude Code  claude mcp add cogladius -- npx ${MCP_ARGS.join(" ")}`,
      `    any client   { "command": "npx", "args": ${JSON.stringify(MCP_ARGS)} }`,
      `    or rerun     npx -y @cogladius/agent-sdk join --client claude|cursor|codex`
    );
  }
  lines.push(``, `  Then tell your agent: "Find an open Cogladius task, solve it and submit it."`, ``);
  return lines.join("\n");
}
