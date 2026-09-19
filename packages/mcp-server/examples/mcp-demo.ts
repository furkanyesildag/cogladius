/**
 * Drive the Cogladius MCP server exactly as an LLM client would: spawn it over
 * stdio and call its tools in order, printing every result. Useful as a
 * scripted rehearsal of the screen-recorded demo, and as an end-to-end check.
 *
 *   COGLADIUS_AGENT_SECRET=S... [COGLADIUS_API_URL=...] npx tsx examples/mcp-demo.ts [--task <id>]
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const transport = new StdioClientTransport({
  command: "node",
  args: [new URL("../dist/index.js", import.meta.url).pathname],
  env: { ...process.env } as Record<string, string>,
});
const client = new Client({ name: "cogladius-demo", version: "1" });
await client.connect(transport);

async function call(name: string, args: Record<string, unknown> = {}) {
  // Waiting for a payout can outlast the default 60 s request timeout.
  const r: any = await client.callTool({ name, arguments: args }, undefined, { timeout: 20 * 60_000, resetTimeoutOnProgress: true });
  const text = r.content?.[0]?.text ?? "";
  console.log(`\n── ${name}(${JSON.stringify(args)})${r.isError ? "  ✗" : ""}\n${text.length > 1400 ? text.slice(0, 1400) + " …" : text}`);
  if (r.isError) throw new Error(`${name} failed: ${text}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));

await call("cogladius_status");
const tasks = await call("list_open_tasks", { escrowedOnly: true });
const task = arg("task") ? tasks.find((t: any) => t.id === Number(arg("task"))) : tasks.find((t: any) => !t.alreadySubmitted);
if (!task) throw new Error("no open escrowed task");
await call("claim_task", { taskId: task.id });
await call("list_paid_data");
const dex = await call("buy_data", { resource: "dex-xlm-usdc", mode: "charge" });
await call("open_payment_session", { depositXlm: "0.2" });
let metrics: any;
let escrow: any;
for (let i = 0; i < 10; i++) {
  const r = await call("buy_data", { resource: i % 2 ? "escrow-config" : "network-metrics", mode: "session" });
  if (i % 2) escrow = r.data;
  else metrics = r.data;
}
const f = metrics.sorobanInclusionFee;
const bid = dex.data.bids[0];
const ask = dex.data.asks[0];
const answer = [
  `Live Stellar mainnet data bought over MPP for this task (ledger ${metrics.latestLedger}, protocol ${metrics.protocolVersion}, ${metrics.observedAt}).`,
  `Soroban inclusion fees are flat at the floor: p10 ${f.p10}, p50 ${f.p50}, p99 ${f.p99} stroops across ${f.transactionCount} transactions, so there is no surge and batching saves only the per-transaction inclusion fee.`,
  `XLM/USDC on the DEX: best bid ${bid?.price} (${bid?.amount}), best ask ${ask?.price} (${ask?.amount}), spread ${bid && ask ? (Number(ask.price) - Number(bid.price)).toFixed(7) : "n/a"} USDC; last trade ${dex.data.recentTrades?.[0]?.price} at ${dex.data.recentTrades?.[0]?.at}.`,
  `Escrow ${escrow.contractId}: pass threshold ${escrow.passThreshold}/100, settle grace ${escrow.settleGrace}s, paused ${escrow.paused}. An agent is paid only if the signed average judge score reaches ${escrow.passThreshold}; the grace window protects the winner's payout from a racing refund after the deadline.`,
  `Recommendation: now is a cheap time to submit Soroban transactions; fees are at the minimum.`,
].join("\n");
await call("submit_work", { taskId: task.id, result: answer });
await call("close_payment_session");
await call("get_payout", { taskId: task.id, waitSeconds: 900 });
await call("get_reputation");
await call("cogladius_status");
await client.close();
