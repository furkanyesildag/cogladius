/**
 * Rebuilds the escrow's history from public Stellar data and prints it
 * as Markdown: every event with its transaction, the totals, and the
 * escrow's live XLM balance checked against what should still be locked.
 *
 * Uses no keys and no Cogladius API. Sources: the Stellar Expert events
 * API (contract events since deployment), Horizon (transaction hash and
 * time for each event) and Stellar RPC (the escrow's balance).
 *
 * Run:  node scripts/mainnet-report.js > docs/evidence/MAINNET_REPORT.md
 */
"use strict";

const path = require("path");

const REPO = path.resolve(__dirname, "..");
const SDK = path.join(REPO, "app/node_modules/@stellar/stellar-sdk");
const {
  Account, Address, Contract, TransactionBuilder, Networks, rpc, xdr, scValToNative,
} = require(SDK);

const ESCROW = "CAC5EDF76M5LY43BNHT47Y5NZRHO4ZRH7SRFPNHATGNKN2DI3SNK75PL";
const XLM_SAC = "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA";
const EXPERT = "https://api.stellar.expert/explorer/public";
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
  GC47EEGZTZWBN7ULYGBJ4RRSR5VZLMUNAKB2MOWD36WDGT74UJNDG53F: "founder's wallet, August test tasks",
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

async function allEvents() {
  const out = [];
  let url = `${EXPERT}/contract/${ESCROW}/events?order=asc&limit=100`;
  for (;;) {
    const page = await getJson(url);
    const records = page._embedded.records;
    out.push(...records);
    if (records.length < 100) return out;
    url = `https://api.stellar.expert${page._links.next.href}`;
  }
}

// An event's paging token starts with the id of the operation that emitted it.
async function txOf(event) {
  const opId = event.paging_token.split("-")[0];
  const op = await getJson(`${HORIZON}/operations/${opId}`);
  return { hash: op.transaction_hash, at: op.created_at };
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
  const events = await allEvents();
  const rows = [];
  for (const e of events) {
    const topic = scValToNative(xdr.ScVal.fromXDR(e.topicsXdr[0], "base64"));
    const body = scValToNative(xdr.ScVal.fromXDR(e.bodyXdr, "base64"));
    rows.push({ topic, body, ...(await txOf(e)) });
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
  p(`Generated ${now} by \`node scripts/mainnet-report.js\`. The script uses no keys and no Cogladius API: events come from Stellar Expert, each transaction from Horizon, and the balance from Stellar RPC. Run it again and compare.`);
  p();
  p(`Escrow: [\`${ESCROW}\`](https://stellar.expert/explorer/public/contract/${ESCROW})`);
  p();
  p("## Totals");
  p();
  p("| | |");
  p("|---|---|");
  p(`| events | ${rows.length} |`);
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
