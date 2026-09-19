/**
 * The tool surface: deliberately narrow and economic. It is not a general
 * Stellar MCP server (docs and ecosystem knowledge belong to Raven, contract
 * bindings to the Stellar AI Agent Kit); it only lets an agent find paid work,
 * pay for its inputs, deliver, get paid, and read track records.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fromStroops, explorerTx, computeReputation } from "@cogladius/agent-sdk";
import type { AgentContext } from "./agent.js";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (v: unknown): Result => ({ content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, jsonSafe, 2) }] });
const fail = (e: unknown): Result => ({ content: [{ type: "text", text: `Error: ${(e as any)?.message ?? String(e)}` }], isError: true });
function jsonSafe(_k: string, v: unknown) {
  return typeof v === "bigint" ? v.toString() : v;
}

function wrap<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A): Promise<Result> => {
    try {
      return ok(await fn(args));
    } catch (e) {
      return fail(e);
    }
  };
}

export function registerTools(server: McpServer, agent: AgentContext) {
  const tx = (h?: string) => (h ? explorerTx(agent.net, h) : undefined);

  server.registerTool(
    "cogladius_status",
    {
      title: "Agent status",
      description: "The agent's Stellar address, network, XLM balance, spend policy and what it has spent, the open payment session if any, and a log of every on-chain action taken in this process with explorer links.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    wrap(async () => ({
      address: agent.signer.publicKey,
      network: agent.net.name,
      balanceXlm: await agent.balance(),
      registered: !!agent.client.apiKey,
      policy: {
        maxSpendXlm: agent.cfg.maxSpend,
        maxPerPaymentXlm: agent.cfg.maxPerPayment,
        maxSessionDepositXlm: agent.cfg.maxSessionDeposit,
        spentXlm: fromStroops(agent.signer.spent),
      },
      session: agent.session ? { channel: agent.session.channel, depositXlm: fromStroops(agent.session.record.deposit), committedXlm: fromStroops(agent.session.record.signed), closed: !!agent.session.record.closeTxHash } : null,
      actions: agent.log,
    }))
  );

  server.registerTool(
    "list_open_tasks",
    {
      title: "List open tasks",
      description: "Open Cogladius tasks the agent can compete for. Each has a reward in XLM; `escrowed: true` means the reward is locked in the Soroban escrow and is paid on-chain to the winner.",
      inputSchema: { minRewardXlm: z.number().optional(), escrowedOnly: z.boolean().optional().describe("Only tasks whose reward is locked on-chain (default true)") },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ minRewardXlm, escrowedOnly }: { minRewardXlm?: number; escrowedOnly?: boolean }) => {
      const tasks = await agent.client.listOpenTasks({ minReward: minRewardXlm, escrowedOnly: escrowedOnly ?? true });
      return tasks.map((t) => ({ id: t.id, rewardXlm: t.reward, description: t.description, criteria: t.criteria, deadline: new Date(t.deadline * 1000).toISOString(), secondsLeft: t.timeRemainingSeconds, submissions: t.submissionsCount, claimedByMe: t.claimedByMe, alreadySubmitted: t.alreadySubmitted, escrowed: t.escrowed, contractTaskId: t.contractTaskId }));
    })
  );

  server.registerTool(
    "claim_task",
    {
      title: "Claim a task",
      description: "Verify the task's reward is really locked in the escrow for the listed amount, then announce the agent is working on it. Claims are not exclusive; the judge panel picks the best submission.",
      inputSchema: { taskId: z.number().int() },
    },
    wrap(async ({ taskId }: { taskId: number }) => {
      const task = (await agent.client.listOpenTasks({ escrowedOnly: false })).find((t) => t.id === taskId);
      if (!task) throw new Error(`task #${taskId} is not open`);
      const escrow = task.escrowed ? await agent.client.verifyEscrow(task) : null;
      const claim = await agent.client.claim(taskId);
      agent.record("claim", `task #${taskId}`);
      return { taskId, claimed: true, competitors: claim.claimsCount - 1, escrow: escrow ? { contractTaskId: escrow.taskId, rewardXlm: fromStroops(escrow.reward), status: escrow.status, poster: escrow.poster } : "reward not escrowed on-chain" };
    })
  );

  server.registerTool(
    "list_paid_data",
    {
      title: "List paid data sources",
      description: "Live data the agent can buy with Stellar MPP while working, with the per-request price in charge mode (one on-chain payment per call) and session mode (off-chain commitments over a payment channel).",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    wrap(async () => {
      const info = await agent.mppInfo();
      return { recipient: info.recipient, asset: info.asset, resources: info.resources, session: info.session };
    })
  );

  server.registerTool(
    "open_payment_session",
    {
      title: "Open an MPP payment session",
      description: "Fund a one-way payment channel (one on-chain transaction) so many data purchases can be paid off-chain and settled in a single close. The deposit is capped by the agent's policy and the provider's limit; whatever is not spent comes back at close.",
      inputSchema: { depositXlm: z.string().regex(/^\d+(\.\d{1,7})?$/).describe("Deposit in XLM, e.g. \"0.5\"") },
    },
    wrap(async ({ depositXlm }: { depositXlm: string }) => {
      const s = await agent.openSession(depositXlm);
      return { channel: s.channel, depositXlm, openTx: tx(s.record.openTxHash) };
    })
  );

  server.registerTool(
    "buy_data",
    {
      title: "Buy data",
      description: "Fetch a paid data resource. mode=charge settles one on-chain payment for this call; mode=session signs an off-chain commitment on the open payment session (open one first).",
      inputSchema: { resource: z.string(), mode: z.enum(["charge", "session"]) },
    },
    wrap(async ({ resource, mode }: { resource: string; mode: "charge" | "session" }) => {
      const url = `${agent.net.apiBaseUrl}/api/mpp/${mode}/${encodeURIComponent(resource)}`;
      if (mode === "charge") {
        const r = await agent.charge().fetch(url);
        const body: any = await r.response.json().catch(() => ({}));
        if (!r.response.ok) throw new Error(body.error || `HTTP ${r.response.status}`);
        return { paidXlm: fromStroops(r.paid), paymentTx: tx(r.receipt?.reference), data: body.data };
      }
      if (!agent.session) throw new Error("no open payment session: call open_payment_session first");
      const r = await agent.session.fetch(url);
      const body: any = await r.response.json().catch(() => ({}));
      if (!r.response.ok) throw new Error(body.error || `HTTP ${r.response.status}`);
      agent.record("mpp-session-commitment", `${fromStroops(r.paid)} XLM for ${resource} (cumulative ${fromStroops(r.cumulative)})`);
      return { paidXlm: fromStroops(r.paid), committedTotalXlm: fromStroops(r.cumulative), onChain: false, data: body.data };
    })
  );

  server.registerTool(
    "close_payment_session",
    {
      title: "Close the payment session",
      description: "Ask the provider to settle the session in one on-chain transaction: it receives what was committed, the rest of the deposit returns to the agent.",
      inputSchema: {},
    },
    wrap(async () => {
      if (!agent.session) throw new Error("no open payment session");
      const r = await agent.session.requestClose();
      agent.record("mpp-session-close", `settled ${r.amount} XLM`, r.hash);
      return { settledXlm: r.amount, closeTx: tx(r.hash), refundedXlm: fromStroops(BigInt(agent.session.record.deposit) - BigInt(agent.session.record.signed)) };
    })
  );

  server.registerTool(
    "submit_work",
    {
      title: "Submit work",
      description: "Submit the result for a task. A three-judge panel scores it immediately; the score is returned. One submission per task.",
      inputSchema: { taskId: z.number().int(), result: z.string().min(10) },
    },
    wrap(async ({ taskId, result }: { taskId: number; result: string }) => {
      const r = await agent.client.submit(taskId, result);
      agent.record("submit", `task #${taskId}${r.judging ? `, score ${r.judging.avgScore}` : ""}`);
      return r;
    })
  );

  server.registerTool(
    "get_payout",
    {
      title: "Check or wait for payout",
      description: "Read the task's state from the escrow contract. With waitSeconds > 0, wait for settlement; after the deadline it asks the platform to release the reward to the top judged submission (anyone may, the escrow verifies the signed verdict).",
      inputSchema: { taskId: z.number().int(), waitSeconds: z.number().int().min(0).max(1800).optional() },
    },
    wrap(async ({ taskId, waitSeconds }: { taskId: number; waitSeconds?: number }) => {
      const p = waitSeconds ? await agent.client.waitForPayout(taskId, { timeoutMs: waitSeconds * 1000, pollMs: 8000 }) : await agent.client.payoutStatus(taskId);
      if (!p) return { taskId, status: "not escrowed" };
      if (p.won && p.settleTxHash) agent.record("payout", `task #${taskId}: ${p.reward} XLM`, p.settleTxHash);
      return { ...p, settleTx: tx(p.settleTxHash) };
    })
  );

  server.registerTool(
    "get_reputation",
    {
      title: "Read reputation",
      description: "An agent's track record derived from the escrow's on-chain events (tasks won, XLM earned, score distribution, disputes), with the settle transactions behind every number. Defaults to this agent.",
      inputSchema: { agent: z.string().optional().describe("Stellar address (G...); defaults to this agent") },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ agent: who }: { agent?: string }) => {
      const res = await fetch(`${agent.net.apiBaseUrl}/api/reputation${who || agent.signer.publicKey ? `?agent=${who ?? agent.signer.publicKey}` : ""}`);
      const data: any = await res.json().catch(() => ({}));
      if (data.success) return data;
      // Provider unavailable: derive it locally from the RPC window.
      const r = await computeReputation(agent.net);
      return { ...r, agents: r.agents.filter((a) => a.agent === (who ?? agent.signer.publicKey)), note: "derived locally from the RPC event window" };
    })
  );
}
