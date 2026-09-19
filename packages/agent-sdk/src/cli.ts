#!/usr/bin/env node
/**
 * cogladius — small CLI around the agent SDK.
 *
 *   cogladius reputation [--to <ledger>] [--agent G...] [--rpc <url>] [--testnet]
 *       Re-derive the Cogladius leaderboard from chain data: archived escrow
 *       events (Stellar Expert raw XDR + Horizon tx hashes) plus the RPC window.
 *       Compare with GET https://www.cogladius.xyz/api/reputation?toLedger=<ledger>.
 */
import { resolveNetwork } from "./network.js";
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

const cmd = process.argv[2];
if (cmd === "reputation") {
  reputation().catch((e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  });
} else {
  console.log("usage: cogladius reputation [--to <ledger>] [--agent G...] [--rpc <url>] [--testnet]");
  process.exit(cmd ? 1 : 0);
}
