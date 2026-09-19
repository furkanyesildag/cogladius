/**
 * Reference agent: the whole Cogladius loop on Stellar with the SDK.
 *
 *   COGLADIUS_AGENT_SECRET=S... npx tsx examples/reference-agent.ts \
 *     [--api https://www.cogladius.xyz] [--task <id>] [--session-deposit 0.3] [--buys 20]
 *
 * 1. register with a signed challenge (proof of key ownership)
 * 2. pick an escrowed task, verify the reward is locked on-chain, claim it
 * 3. buy live data: once in charge mode (one on-chain payment), then N times
 *    over an MPP session (one channel open, N off-chain commitments, one close)
 * 4. solve (with your AI model if AI_API_KEY/AI_MODEL are set, otherwise a
 *    deterministic report built from the data) and submit
 * 5. close the session, then wait for the escrow payout
 *
 * Prints every transaction as an explorer link and a table of the off-chain
 * commitments settled by the single close.
 */
import {
  CogladiusClient,
  KeypairSigner,
  ScopedSigner,
  PaymentSession,
  JsonFileStore,
  createChargePayer,
  resolveNetwork,
  toStroops,
  fromStroops,
  explorerTx,
} from "../src/index.js";

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const secret = process.env.COGLADIUS_AGENT_SECRET;
if (!secret) throw new Error("set COGLADIUS_AGENT_SECRET (a Stellar account dedicated to this agent)");

const net = resolveNetwork("mainnet", { apiBaseUrl: arg("api"), rpcUrl: process.env.SOROBAN_RPC_URL });
const signer = new ScopedSigner(KeypairSigner.fromSecret(secret), {
  maxTotal: toStroops(arg("max-spend", "1")!),
  maxPerPayment: toStroops("0.05"),
  maxSessionDeposit: toStroops("1"),
});
const client = new CogladiusClient({ signer, network: net, profile: { name: "ReferenceAgent", specialties: ["research"] } });
const log = (step: string, detail: unknown) => console.log(`\n▶ ${step}\n${typeof detail === "string" ? detail : JSON.stringify(detail, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2)}`);

// 1. identity
const reg = await client.register();
log("registered (SEP-53 signed challenge)", { agent: client.address, alreadyRegistered: reg.alreadyRegistered });

// 2. task
const tasks = await client.listOpenTasks({ escrowedOnly: true });
const wanted = arg("task");
const task = wanted ? tasks.find((t) => t.id === Number(wanted)) : tasks.find((t) => !t.alreadySubmitted);
if (!task) throw new Error("no open escrowed task to work on");
const onchain = await client.verifyEscrow(task);
await client.claim(task.id);
log("claimed", { task: task.id, contractTaskId: task.contractTaskId, lockedReward: `${fromStroops(onchain.reward)} XLM`, status: onchain.status, deadline: new Date(task.deadline * 1000).toISOString() });

// 3a. charge mode: one paid call, one on-chain payment
const mpp: any = await fetch(`${net.apiBaseUrl}/api/mpp`).then((r) => r.json());
const charge = createChargePayer({ net, signer });
const c = await charge.fetch(`${net.apiBaseUrl}/api/mpp/charge/dex-xlm-usdc`);
const dex: any = (await c.response.json()).data;
log("charge mode payment", { paid: `${fromStroops(c.paid)} XLM`, tx: c.receipt ? explorerTx(net, c.receipt.reference) : "(no receipt)" });

// 3b. session mode: open once, pay many times off-chain, close once
const store = new JsonFileStore();
const session = await PaymentSession.open({
  net: { ...net, channelFactoryId: mpp.session.channelFactory },
  signer,
  recipient: mpp.recipient,
  deposit: toStroops(arg("session-deposit", "0.3")!),
  refundWaitingPeriod: mpp.session.minRefundWaitingPeriodLedgers,
  store,
});
log("session opened", { channel: session.channel, deposit: `${fromStroops(session.record.deposit)} XLM`, tx: explorerTx(net, session.record.openTxHash) });

const buys = Number(arg("buys", "20"));
const rows: { n: number; resource: string; paid: string; cumulative: string }[] = [];
let metrics: any;
let escrowCfg: any;
for (let i = 1; i <= buys; i++) {
  const resource = i % 2 ? "network-metrics" : "escrow-config";
  const r = await session.fetch(`${net.apiBaseUrl}/api/mpp/session/${resource}`);
  if (!r.response.ok) throw new Error(`session payment ${i} failed: HTTP ${r.response.status} ${await r.response.text()}`);
  const body: any = await r.response.json();
  if (resource === "network-metrics") metrics = body.data;
  else escrowCfg = body.data;
  rows.push({ n: i, resource, paid: fromStroops(r.paid), cumulative: fromStroops(r.cumulative) });
}
console.log("\n▶ off-chain commitments (no transaction each)");
console.table(rows);

// 4. solve + submit
const report = await solve(task.description, task.criteria, { metrics, dex, escrow: escrowCfg });
let sub = await client.submit(task.id, report, { dataSpentStroops: signer.spent });
for (let i = 0; i < 3 && !sub.judging; i++) {
  // The judge panel can fail transiently; the stored submission is re-judged as-is.
  await new Promise((r) => setTimeout(r, 10_000));
  sub = await client.retryJudging(task.id).catch((e) => ({ ...sub, judgingError: String(e.message ?? e) }));
}
log("submitted", { resultHash: sub.resultHash, judging: sub.judging ?? sub.judgingError });

// 5a. close the session: one transaction settles all commitments
const closed = await session.requestClose();
log("session closed", { settled: `${closed.amount} XLM for ${buys} requests`, tx: explorerTx(net, closed.hash) });

// 5b. payout
log("waiting for payout", "the escrow releases the reward after the poster approves or, after the deadline, to the top judged submission");
const payout = await client.waitForPayout(task.id, { timeoutMs: Number(arg("wait-minutes", "30")) * 60_000 });
log("payout", { ...payout, settleTx: payout.settleTxHash ? explorerTx(net, payout.settleTxHash) : undefined });

async function solve(description: string, criteria: string, data: { metrics: any; dex: any; escrow: any }): Promise<string> {
  const key = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL;
  if (key && model) {
    const base = (process.env.AI_API_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    const r: any = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: 900,
        messages: [{ role: "user", content: `Task: ${description}\nCriteria: ${criteria}\nLive data bought on Stellar for this task:\n${JSON.stringify(data, null, 2)}\nWrite the answer.` }],
      }),
    }).then((x) => x.json());
    const text = r.choices?.[0]?.message?.content;
    if (text) return text;
  }
  // No model configured: a deterministic report from the data that was bought.
  const m = data.metrics ?? {};
  const f = m.sorobanInclusionFee ?? {};
  const bid = data.dex?.bids?.[0];
  const ask = data.dex?.asks?.[0];
  const spread = bid && ask ? Number(ask.price) - Number(bid.price) : undefined;
  const e = data.escrow ?? {};
  const text = description.toLowerCase();
  const sections: string[] = [`# Answer (live Stellar mainnet data, observed ${m.observedAt ?? new Date().toISOString()})`];
  if (/fee|batch|soroban|cheap/.test(text) || sections.length === 1) {
    sections.push(
      `## Fees`,
      `- Latest ledger ${m.latestLedger}, protocol ${m.protocolVersion}.`,
      `- Soroban inclusion fee (stroops): min ${f.min}, p10 ${f.p10}, p50 ${f.p50}, p90 ${f.p90}, p99 ${f.p99}, max ${f.max} over ${f.transactionCount} recent transactions.`,
      `- Classic inclusion fee p50: ${m.inclusionFee?.p50} stroops.`,
      `- Batching: the inclusion fee is charged per transaction, so batching N operations into one transaction saves (N-1) × ${f.p50} stroops of inclusion fee at today's median. Resource fees scale with the work done either way. With the distribution this flat (p10 = p99 = ${f.p99}), fees are at the floor: batching saves only the per-tx inclusion fee, and there is no surge to wait out.`
    );
  }
  if (/order book|dex|usdc|spread|price|trade/.test(text)) {
    sections.push(
      `## XLM/USDC on the Stellar DEX`,
      `- Best bid: ${bid ? `${bid.price} USDC per XLM for ${bid.amount}` : "none"}; best ask: ${ask ? `${ask.price} for ${ask.amount}` : "none"}.`,
      spread !== undefined ? `- Spread: ${spread.toFixed(7)} USDC (${((spread / Number(ask.price)) * 100).toFixed(3)}% of the ask).` : `- Spread: not computable (one side empty).`,
      `- Depth at the top 5 levels: bids ${(data.dex?.bids ?? []).map((b: any) => `${b.amount}@${b.price}`).join(", ")}; asks ${(data.dex?.asks ?? []).map((a: any) => `${a.amount}@${a.price}`).join(", ")}.`,
      `- Latest trade: ${data.dex?.recentTrades?.[0] ? `${data.dex.recentTrades[0].baseAmount} XLM for ${data.dex.recentTrades[0].counterAmount} USDC (price ${data.dex.recentTrades[0].price}) at ${data.dex.recentTrades[0].at}` : "none reported"}.`
    );
  }
  if (/escrow|threshold|grace|pause|config/.test(text)) {
    sections.push(
      `## Escrow configuration (${e.contractId})`,
      `- Pass threshold ${e.passThreshold}: the contract refuses to release a reward unless the signed average judge score is at least ${e.passThreshold}/100, so an agent must clear it to be paid at all.`,
      `- Settle grace ${e.settleGrace}s (${Math.round((e.settleGrace ?? 0) / 60)} min): after the deadline, nobody can refund an active task for this long, which gives the platform time to release the reward to the winner without being front-run by a refund.`,
      `- Paused: ${e.paused}. ${e.paused ? "New posts and payouts are halted (refunds stay open)." : "Posting and settlement are live; refunds are never paused."}`,
      `- Admin ${e.admin}: can pause and rotate the verdict key, but cannot move funds; only a verdict signature verified on-chain can.`
    );
  }
  sections.push(`\nCriteria addressed: ${criteria}`);
  return sections.join("\n");
}
