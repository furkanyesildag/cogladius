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
  mcp: { client: McpClientName; status: "added" | "updated" | "already-present" | "skipped"; detail?: string }[];
  explorer: string;
}

export interface JoinDeps {
  fetch?: typeof fetch;
  identityFile?: string;
  home?: string;
  /** Runs an external command; returns its exit code. */
  run?: (cmd: string, args: string[]) => number | null;
  /** Where `join --client` installs the MCP server (default: next to agent.json). */
  mcpDir?: string;
  exists?: (path: string) => boolean;
  /** COGLADIUS_HOME to hand to the MCP server, so it reads the same agent.json. */
  cogladiusHome?: string;
  /** Runs an external command and returns its stdout, or null if it failed. */
  output?: (cmd: string, args: string[]) => string | null;
  readText?: (path: string) => string | null;
  /** Codex's config directory (default: $CODEX_HOME, else ~/.codex). */
  codexHome?: string;
  /** Progress notes for a human at the terminal (the CLI sends them to stderr). */
  log?: (message: string) => void;
}

/** An MCP entry that an earlier `cogladius join` wrote (npx of our tarball, or the npm package). */
const OURS = /cogladius\.xyz\/mcp|cogladius-mcp|@cogladius\/mcp-server/;

/** How an MCP client should launch the Cogladius server. */
export interface McpLaunch {
  command: string;
  args: string[];
  /** true when the server was installed locally and starts in under a second. */
  local: boolean;
  detail?: string;
}

/**
 * Where npx fetches the packages. They are served from cogladius.xyz, so
 * onboarding does not depend on the npm registry; set COGLADIUS_MCP_PACKAGE
 * to "cogladius-mcp" to use the npm release instead.
 */
/** Bump with package.json: npx caches a tarball URL forever, so every release gets a new URL. */
export const PACKAGE_VERSION = "0.2.3";
export const CLI_PACKAGE = `https://www.cogladius.xyz/cli-${PACKAGE_VERSION}.tgz`;
export const MCP_PACKAGE = process.env.COGLADIUS_MCP_PACKAGE || `https://www.cogladius.xyz/mcp-${PACKAGE_VERSION}.tgz`;
export const JOIN_COMMAND = `npx -y ${CLI_PACKAGE} join`;
const MCP_ARGS = ["-y", MCP_PACKAGE];
/**
 * Fallback launch. It works, but npx reinstalls a tarball URL on every start and
 * the SDK builds @stellar/mpp from git, so a start takes 20 to 45 seconds: over
 * Codex's 10 s MCP startup timeout, and over Claude Code's 30 s on a cold cache.
 */
export const NPX_LAUNCH: McpLaunch = { command: "npx", args: MCP_ARGS, local: false };

/**
 * Install the MCP server once, next to agent.json, and launch it with plain
 * `node`. The one-off install takes about as long as a single npx start; every
 * start after that is local and takes well under a second.
 */
export function installMcp(deps: JoinDeps = {}): McpLaunch {
  const run = deps.run ?? defaultRun;
  const exists = deps.exists ?? existsSync;
  const dir = deps.mcpDir ?? joinPath(dirname(deps.identityFile ?? identityPath()), "mcp");
  const entry = joinPath(dir, "node_modules", "cogladius-mcp", "dist", "index.js");
  // Rerunning join is common; skip the ~40 s install when this version is already there.
  const read = deps.readText ?? readTextOrNull;
  const installed = read(joinPath(dir, "node_modules", "cogladius-mcp", "package.json"));
  if (installed && exists(entry) && JSON.parse(installed).version === PACKAGE_VERSION) {
    return { command: "node", args: [entry], local: true };
  }
  deps.log?.("Installing the Cogladius MCP server for your AI client (about 40 s, once)...");
  const code = run("npm", ["install", "--prefix", dir, "--no-audit", "--no-fund", "--loglevel=error", MCP_PACKAGE]);
  if (code === 0 && exists(entry)) return { command: "node", args: [entry], local: true };
  return { ...NPX_LAUNCH, detail: `local install failed (npm exited ${code}), using npx: the first start is slow` };
}

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

  const clients = opts.clients ?? [];
  const launch = clients.length ? installMcp(deps) : NPX_LAUNCH;
  const mcpDeps = { ...deps, cogladiusHome: deps.cogladiusHome ?? process.env.COGLADIUS_HOME };
  const mcp = clients.map((c) => addMcp(c, mcpDeps, launch));

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

function defaultOutput(cmd: string, args: string[]): string | null {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return r.status === 0 ? r.stdout : null;
}

function readTextOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Replace the [mcp_servers.cogladius] table, and its sub-tables, in a config.toml. */
function replaceCodexBlock(toml: string, block: string): string {
  const lines = toml.split("\n");
  const start = lines.findIndex((l) => /^\[mcp_servers\.cogladius\]\s*$/.test(l));
  let end = start + 1;
  while (end < lines.length && !(/^\s*\[/.test(lines[end]) && !/^\s*\[mcp_servers\.cogladius\./.test(lines[end]))) end++;
  const tail = lines.slice(end).join("\n");
  return [...lines.slice(0, start), ...block.replace(/\n$/, "").split("\n"), ...(tail ? ["", tail] : [""])].join("\n");
}

export function addMcp(client: McpClientName, deps: JoinDeps = {}, launch: McpLaunch = NPX_LAUNCH): JoinResult["mcp"][number] {
  const home = deps.home ?? homedir();
  const run = deps.run ?? defaultRun;
  const env: Record<string, string> = deps.cogladiusHome ? { COGLADIUS_HOME: deps.cogladiusHome } : {};
  const note = launch.detail;
  if (client === "claude") {
    if (run("claude", ["--version"]) !== 0) return { client, status: "skipped", detail: "claude CLI not found on PATH" };
    let status: "added" | "updated" = "added";
    if (run("claude", ["mcp", "get", "cogladius"]) === 0) {
      const current = (deps.output ?? defaultOutput)("claude", ["mcp", "get", "cogladius"]) ?? "";
      if (current.includes(launch.args[launch.args.length - 1])) return { client, status: "already-present" };
      if (!OURS.test(current)) return { client, status: "already-present", detail: "a different server named cogladius is configured; left untouched" };
      // Ours, but an older launch (npx, or a previous version): replace it.
      if (run("claude", ["mcp", "remove", "cogladius", "--scope", "user"]) !== 0) {
        return { client, status: "skipped", detail: "an older cogladius entry exists outside the user scope; remove it with `claude mcp remove cogladius` and rerun join" };
      }
      status = "updated";
    }
    const envArgs = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    const code = run("claude", ["mcp", "add", "--scope", "user", ...envArgs, "cogladius", "--", launch.command, ...launch.args]);
    return code === 0 ? { client, status, detail: note ? `Claude Code user config; ${note}` : undefined } : { client, status: "skipped", detail: `claude mcp add exited ${code}` };
  }
  if (client === "cursor") {
    const path = joinPath(home, ".cursor", "mcp.json");
    const cfg = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
    cfg.mcpServers ??= {};
    const prev = cfg.mcpServers.cogladius;
    const prevText = prev ? JSON.stringify(prev) : "";
    if (prev && (prevText.includes(launch.args[launch.args.length - 1]) || !OURS.test(prevText))) {
      return { client, status: "already-present", detail: path };
    }
    cfg.mcpServers.cogladius = { command: launch.command, args: launch.args, ...(Object.keys(env).length ? { env } : {}) };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
    return { client, status: prev ? "updated" : "added", detail: path };
  }
  const path = joinPath(deps.codexHome ?? process.env.CODEX_HOME ?? joinPath(home, ".codex"), "config.toml");
  const toml = existsSync(path) ? readFileSync(path, "utf8") : "";
  const hasBlock = /^\[mcp_servers\.cogladius\]/m.test(toml);
  if (hasBlock) {
    const at = toml.search(/^\[mcp_servers\.cogladius\]/m);
    const rest = toml.slice(at + 1);
    const next = rest.search(/^\s*\[(?!mcp_servers\.cogladius\.)/m);
    const current = next < 0 ? toml.slice(at) : toml.slice(at, at + 1 + next);
    if (current.includes(launch.args[launch.args.length - 1]) || !OURS.test(current)) {
      return { client, status: "already-present", detail: path };
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  // Codex waits 10 s for an MCP server by default; a local start needs well under
  // one, and the npx fallback needs far more than ten.
  const timeout = launch.local ? 60 : 180;
  const envBlock = Object.keys(env).length
    ? `\n[mcp_servers.cogladius.env]\n${Object.entries(env).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join("\n")}\n`
    : "";
  const block = `[mcp_servers.cogladius]\ncommand = ${JSON.stringify(launch.command)}\nargs = ${JSON.stringify(launch.args)}\nstartup_timeout_sec = ${timeout}\n${envBlock}`;
  const updated = hasBlock
    ? replaceCodexBlock(toml, block)
    : toml + (toml && !toml.endsWith("\n") ? "\n" : "") + (toml ? "\n" : "") + block;
  writeFileSync(path, updated);
  return { client, status: hasBlock ? "updated" : "added", detail: note ? `${path}; ${note}` : path };
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
    const what =
      m.status === "added" ? "MCP server added"
      : m.status === "updated" ? "MCP server updated to the fast local launch"
      : m.status === "already-present" ? "MCP server already configured"
      : `MCP not configured (${m.detail})`;
    lines.push(``, `  ${m.status === "skipped" ? "!" : "✓"} ${m.client}: ${what}${m.status !== "skipped" && m.detail ? ` in ${m.detail}` : ""}`);
  }
  lines.push(
    ``,
    `  Next, either:`,
    `    • let your AI agent work: it polls GET /api/agents/tasks and POSTs /api/agents/submit`,
    `      with the API key in ${r.identityFile} (see https://www.cogladius.xyz/skill.md)`,
    `    • or run the worker with your own model:`,
    `      AI_API_KEY=... AI_MODEL=... ${JOIN_COMMAND.replace(/ join$/, " work")}`,
    ``
  );
  return lines.join("\n");
}
