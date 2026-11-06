/**
 * Rebuilds the escrow's history from public Stellar data and prints it
 * as Markdown: every event with its transaction, the totals, and the
 * escrow's live XLM balance checked against what should still be locked.
 *
 * Uses no keys, no paid API and no Cogladius API. Sources:
 *  - docs/evidence/escrow-txs.txt, every escrow transaction we know of;
 *  - Stellar RPC getEvents, which adds any escrow transaction from the
 *    RPC retention window (about 7 days) missing from that list;
 *  - Horizon, which returns each transaction's envelope: the script
 *    decodes the contract call and its arguments from it;
 *  - Stellar RPC again for the escrow's live balance, checked against the
 *    rewards still locked.
 * Older history can be compared with the escrow's page on Stellar Expert.
 *
 * Run:  node scripts/mainnet-report.js > docs/evidence/MAINNET_REPORT.md
 */
"use strict";

const path = require("path");

const REPO = path.resolve(__dirname, "..");
const SDK = path.join(REPO, "app/node_modules/@stellar/stellar-sdk");
const fs = require("fs");
const {
  Account, Address, Contract, TransactionBuilder, Networks, rpc, xdr, scValToNative,
} = require(SDK);

const ESCROW = "CAC5EDF76M5LY43BNHT47Y5NZRHO4ZRH7SRFPNHATGNKN2DI3SNK75PL";
const XLM_SAC = "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA";
const TX_LIST = path.join(REPO, "docs/evidence/escrow-txs.txt");
const HORIZON = process.env.HORIZON_URL || "https://horizon.stellar.org";
const RPC_URL = process.env.RPC_URL || "https://mainnet.sorobanrpc.com";

// Every account Cogladius operates. Anything else that shows up as a
// poster or winner is reported as an outside address.
const OURS = {
  GCW5KN2IOPLUC4P6KHBBO3JAF7SSUBEICFT5Y54CJW7FP5FG5GJEX7DW: "admin",
  GAI44BS6US2GQR627S2OYG47C3BE573AZEDK3UIKK526FJPXWTK3ZBDM: "server submitter",
  GAWGVLOHHDUHTK5JVPQBBVXDPT6DOCP2PYKMLS5CWG7VPMMNHISZ3UWO: "fee relayer",
  GAUVQWVC3PO6RHP26T5XY6ZHXYTDZ5ZW7ME5E2RO7V3VOMAK3JERLS7E: "MPP provider",
  GCY7D5UPS5MW6RMCWYBIXZELK7GZ7Y7M4J45ZCKTFV2N66XWHBJW7YEJ: "demo poster",
  GCUVAE7S66KJDPDAOU5WLM6CT7VSHLYA7LXVDT2DDL2ZV72XW3WEZQFW: "demo agent",
  GCTK3U2ST3ZE32YZTA3ADTXRH2MIZZSUWXQQITQ3DCBV6JJDHSOYYFOW: "test agent",
  GDQ4SXOKBJGGYMTNFKWROBTTNYNLSW5S5MWI6LPLGZKQT3MTKN7PXJ6E: "test agent",
  GC47EEGZTZWBN7ULYGBJ4RRSR5VZLMUNAKB2MOWD36WDGT74UJNDG53F: "August test wallet, funded from a personal wallet; counted as ours",
};

const STROOPS = 10_000_000n;
const xlm = (s) => {
  const v = BigInt(s);
  const whole = v / STROOPS;
  const frac = (v % STROOPS).toString().padStart(7, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
};
const short = (a) => `${a.slice(0, 8)}…${a.slice(-4)}`;
const who = (a) => (OURS[a] ? `${short(a)} (ours: ${OURS[a]})` : `**${short(a)} (outside)**`);
const txLink = (h) => `[\`${h.slice(0, 8)}…\`](https://stellar.expert/explorer/public/tx/${h})`;

async function getJson(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new Error(`GET ${url} failed`);
}

function knownTxs() {
  return fs.readFileSync(TX_LIST, "utf8").split("\n").map((l) => l.trim()).filter((l) => /^[0-9a-f]{64}$/.test(l));
}

async function rpcCall(method, params) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

// Escrow transactions inside the RPC retention window.
async function recentTxs() {
  const health = await rpcCall("getHealth", {});
  const hashes = [];
  let params = { startLedger: health.oldestLedger + 10, filters: [{ type: "contract", contractIds: [ESCROW] }], pagination: { limit: 1000 } };
  for (;;) {
    const page = await rpcCall("getEvents", params);
    for (const e of page.events) if (!hashes.includes(e.txHash)) hashes.push(e.txHash);
    if (page.events.length < 1000) return { hashes, since: health.oldestLedgerCloseTime };
    params = { filters: params.filters, pagination: { cursor: page.cursor, limit: 1000 } };
  }
}

// Decodes the escrow call in a transaction from its envelope on Horizon.
async function readTx(hash) {
  const tx = await getJson(`${HORIZON}/transactions/${hash}`);
  let env = xdr.TransactionEnvelope.fromXDR(tx.envelope_xdr, "base64");
  if (env.switch().name === "envelopeTypeTxFeeBump") env = env.feeBump().tx().innerTx();
  const inner = env.value().tx();
  for (const op of inner.operations()) {
    if (op.body().switch().name !== "invokeHostFunction") continue;
    const fn = op.body().invokeHostFunctionOp().hostFunction();
    if (fn.switch().name !== "hostFunctionTypeInvokeContract") continue;
    const call = fn.invokeContract();
    if (Address.fromScAddress(call.contractAddress()).toString() !== ESCROW) continue;
    return {
      hash, at: tx.created_at, ledger: tx.ledger, ok: tx.successful,
      fn: call.functionName().toString(),
      args: call.args().map((a) => scValToNative(a)),
    };
  }
  return null;
}

async function escrowBalance() {
  const server = new rpc.Server(RPC_URL);
  const source = new Account("GCW5KN2IOPLUC4P6KHBBO3JAF7SSUBEICFT5Y54CJW7FP5FG5GJEX7DW", "0");
  const tx = new TransactionBuilder(source, { fee: "100", networkPassphrase: Networks.PUBLIC })
    .addOperation(new Contract(XLM_SAC).call("balance", new Address(ESCROW).toScVal()))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (!sim.result) throw new Error("balance simulation failed");
  return BigInt(scValToNative(sim.result.retval));
}

async function main() {
  const known = knownTxs();
  const recent = await recentTxs();
  const added = recent.hashes.filter((h) => !known.includes(h));
  const calls = [];
  for (const h of [...known, ...added]) {
    const c = await readTx(h);
    if (!c) throw new Error(`${h} does not call the escrow`);
    if (c.ok) calls.push(c);
  }
  calls.sort((a, b) => a.ledger - b.ledger);

  // Turn each successful call into the event the contract emitted for it.
  const tasks = new Map();
  const rows = [];
  for (const c of calls) {
    const [a0, a1, a2] = c.args;
    if (c.fn === "post_task") {
      const [poster, task_id, reward, deadline] = c.args;
      tasks.set(String(task_id), { poster, reward });
      rows.push({ ...c, topic: "post", body: { task_id, poster, reward, deadline } });
    } else if (c.fn === "release_to_winner") {
      const t = tasks.get(String(a0));
      rows.push({ ...c, topic: "settle", body: { task_id: a0, winner: a1, reward: t.reward, score: a2 } });
    } else if (c.fn === "refund") {
      const t = tasks.get(String(a0));
      rows.push({ ...c, topic: "refund", body: { task_id: a0, poster: t.poster, reward: t.reward } });
    } else {
      rows.push({ ...c, topic: c.fn, body: { task_id: a0 } });
    }
  }

  const posted = new Map();
  const closed = new Set();
  const counts = {};
  let paid = 0n;
  const outside = new Set();
  for (const r of rows) {
    counts[r.topic] = (counts[r.topic] || 0) + 1;
    const id = r.body.task_id !== undefined ? String(r.body.task_id) : null;
    if (r.topic === "post") posted.set(id, BigInt(r.body.reward));
    if (r.topic === "settle") { paid += BigInt(r.body.reward); closed.add(id); }
    if (r.topic === "refund") closed.add(id);
    for (const k of ["poster", "winner"]) {
      if (r.body[k] && !OURS[r.body[k]]) outside.add(r.body[k]);
    }
  }
  let locked = 0n;
  for (const [id, reward] of posted) if (!closed.has(id)) locked += reward;
  const balance = await escrowBalance();
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  const p = (s = "") => process.stdout.write(s + "\n");
  p("# Mainnet report: the Cogladius escrow, rebuilt from public data");
  p();
  p(`Generated ${now} by \`node scripts/mainnet-report.js\`. The script uses no keys and no Cogladius API: each escrow call is decoded from its transaction on Horizon, transactions come from [escrow-txs.txt](escrow-txs.txt) plus Stellar RPC \`getEvents\` (checked back to ${new Date(recent.since * 1000).toISOString().slice(0, 10)}), and the balance comes from Stellar RPC. Run it again and compare.`);
  p();
  p(`Escrow: [\`${ESCROW}\`](https://stellar.expert/explorer/public/contract/${ESCROW})`);
  p();
  p("## Totals");
  p();
  p("| | |");
  p("|---|---|");
  p(`| events | ${rows.length} |`);
  p(`| new transactions found through RPC | ${added.length} |`);
  p(`| tasks posted | ${counts.post || 0} |`);
  p(`| tasks settled (paid to a winner) | ${counts.settle || 0} |`);
  p(`| tasks refunded | ${counts.refund || 0} |`);
  p(`| tasks still locked | ${posted.size - closed.size} |`);
  p(`| XLM paid to winners | ${xlm(paid)} |`);
  p(`| XLM still locked, from events | ${xlm(locked)} |`);
  p(`| escrow XLM balance, live | ${xlm(balance)} |`);
  p(`| outside posters or winners | ${outside.size} |`);
  const other = Object.keys(counts).filter((t) => !["post", "settle", "refund"].includes(t));
  if (other.length) p(`| other events | ${other.map((t) => `${t}: ${counts[t]}`).join(", ")} |`);
  p();
  p(balance === locked
    ? "The live balance equals the rewards still locked, so every stroop the escrow holds belongs to an open task."
    : `**The live balance differs from the locked rewards by ${xlm(balance - locked)} XLM.** Look for a transfer to the escrow outside \`post_task\`.`);
  p();
  p(outside.size === 0
    ? "Every poster and winner is an address we operate. First payments to outside agents are the SCF #46 Tranche 1 target."
    : `${outside.size} poster or winner address(es) are outside our list of operated accounts.`);
  p();
  p("## Every event");
  p();
  p("| time (UTC) | event | task | reward (XLM) | party | score | tx |");
  p("|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const party = r.body.winner || r.body.poster;
    p(`| ${r.at.replace("T", " ").replace("Z", "")} | ${r.topic} | ${r.body.task_id ?? ""} | ${r.body.reward !== undefined ? xlm(r.body.reward) : ""} | ${party ? who(party) : ""} | ${r.body.score ?? ""} | ${txLink(r.hash)} |`);
  }
  p();
  p("## Accounts we operate");
  p();
  for (const [a, role] of Object.entries(OURS)) p(`- ${role}: [\`${a}\`](https://stellar.expert/explorer/public/account/${a})`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
