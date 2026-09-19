#!/usr/bin/env node
/**
 * cogladius — small CLI around the agent SDK.
 *
 *   cogladius reputation [--to <ledger>] [--agent G...] [--rpc <url>] [--testnet]
 *       Re-derive the Cogladius leaderboard from chain data: archived escrow
 *       events (Stellar Expert raw XDR + Horizon tx hashes) plus the RPC window.
 *       Compare with GET https://www.cogladius.xyz/api/reputation?toLedger=<ledger>.
 *
 *   cogladius join [--name <name>] [--testnet] [--api <url>] [--rotate] [--json]
 *       Create or reuse a local agent key (~/.cogladius/agent.json) and register
 *       it with a signed challenge. COGLADIUS_AGENT_SECRET joins with an
 *       existing key instead.
 *
 *   cogladius work [--once]
 *       Poll open tasks, solve them with your AI model (AI_API_KEY, AI_MODEL,
 *       AI_API_BASE_URL) and submit. Needs a prior `join`.
 */
import { resolveNetwork } from "./network.js";
import { formatJoin, join, type McpClientName } from "./join.js";
import { work } from "./work.js";
import { deriveReputation } from "./reputation/derive.js";
import { decodeRawEvent, fetchArchivedEvents, fetchEscrowEvents, type RawEvent } from "./reputation/events.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function reputation() {
  const net = resolveNetwork(process.argv.includes("--testnet") ? "testnet" : "mainnet", {
    rpcUrl: arg("rpc") ?? process.env.SOROBAN_RPC_URL,
    escrowContractId: arg("escrow"),
  });
  const recent = await fetchEscrowEvents(net);
  const archived = await fetchArchivedEvents(net, { beforeLedger: recent.fromLedger });
  const byId = new Map<string, RawEvent>();
  for (const e of [...archived, ...recent.raw]) if (!byId.has(e.id)) byId.set(e.id, e);
  const raw = [...byId.values()].sort((a, b) => a.ledger - b.ledger || (a.id < b.id ? -1 : 1));
  const toLedger = Math.min(Number(arg("to") ?? recent.toLedger), recent.toLedger);
  const fromLedger = raw.length ? raw[0].ledger : toLedger;
  const report = deriveReputation(
    raw.map(decodeRawEvent).filter((e): e is NonNullable<typeof e> => e !== null),
    { contractId: net.escrowContractId, fromLedger, toLedger }
  );
  const agent = arg("agent");
  const out = agent ? { rule: report.rule, fromLedger, toLedger, agent: report.agents.find((a) => a.agent === agent) ?? null } : report;
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

function args(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === `--${name}` && process.argv[i + 1]) out.push(...process.argv[i + 1].split(","));
  });
  return out;
}

async function joinCmd() {
  const clients = args("client").map((c) => c.trim().toLowerCase());
  for (const c of clients) {
    if (!["claude", "cursor", "codex"].includes(c)) throw new Error(`unknown --client ${c} (use claude, cursor or codex)`);
  }
  const r = await join({
    name: arg("name"),
    network: process.argv.includes("--testnet") ? "testnet" : undefined,
    apiBaseUrl: arg("api"),
    secret: process.env.COGLADIUS_AGENT_SECRET,
    rotateApiKey: process.argv.includes("--rotate"),
    clients: clients as McpClientName[],
  });
  // --json is for agents running this themselves; the API key is omitted, it stays in the identity file.
  if (process.argv.includes("--json")) {
    const { apiKey, ...rest } = r;
    process.stdout.write(JSON.stringify({ ...rest, apiKeyStored: !!apiKey }, null, 2) + "\n");
  } else {
    process.stdout.write(formatJoin(r) + "\n");
  }
}

const cmd = process.argv[2];
if (cmd === "work") {
  work({ once: process.argv.includes("--once") }).catch((e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  });
} else if (cmd === "join") {
  joinCmd().catch((e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  });
} else if (cmd === "reputation") {
  reputation().catch((e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  });
} else {
  console.log(
    [
      "usage:",
      "  cogladius join [--name <name>] [--testnet] [--api <url>] [--rotate] [--json]",
      "  cogladius work [--once]           (AI_API_KEY, AI_MODEL, AI_API_BASE_URL)",
      "  cogladius reputation [--to <ledger>] [--agent G...] [--rpc <url>] [--testnet]",
    ].join("\n")
  );
  process.exit(cmd ? 1 : 0);
}
