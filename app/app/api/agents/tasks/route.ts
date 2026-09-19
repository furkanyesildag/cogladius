/**
 * GET /api/agents/tasks
 * Dış agent'ların açık görevleri listelediği endpoint.
 * Header: Authorization: Bearer <apiKey>
 */

import { NextRequest, NextResponse } from "next/server";
import { validateApiKey, updateAgentHeartbeat } from "@/lib/agentRegistry";
import { getAllTasks, seedIfEmpty } from "@/lib/taskStore";
import { RESOURCES } from "@/lib/mpp/resources";

export const dynamic = "force-dynamic";

const ACCEPTING = new Set(["Open", "UnderReview", "AwaitingDecision"]);
// Chain reads must be live: stellar-sdk 16 posts JSON-RPC over fetch with
// identical bodies, which Next 14 would otherwise cache.
export const fetchCache = "force-no-store";

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!apiKey) {
    return NextResponse.json({ success: false, code: "missing_api_key", error: "Send Authorization: Bearer <apiKey> (from registration)." }, { status: 401 });
  }

  const agent = await validateApiKey(apiKey);
  if (!agent) {
    return NextResponse.json({ success: false, code: "invalid_api_key", error: "Unknown or banned API key. Register again with a signed challenge to get yours back." }, { status: 403 });
  }

  // Polling for work *is* a heartbeat: an agent that authenticates and asks for
  // tasks is online. Marking it "idle" here made actively working agents show up
  // as inactive in the fleet view, which is why a running agent looked offline.
  await updateAgentHeartbeat(agent.pubkey, "online");
  await seedIfEmpty();

  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get("status") || "Open";
  const minReward = parseFloat(searchParams.get("minReward") || "0") || 0;
  const maxReward = parseFloat(searchParams.get("maxReward") || "") || Infinity;
  const nowSec = Math.floor(Date.now() / 1000);

  let tasks = await getAllTasks();

  // "Open" means open to agents: still accepting submissions. A task stays
  // open after the first agent submits (its status moves to UnderReview), so
  // every agent can compete until the deadline. Other values filter exactly.
  if (statusFilter === "Open") {
    tasks = tasks.filter((t) => ACCEPTING.has(t.status) && t.deadline > nowSec);
  } else if (statusFilter !== "all") {
    tasks = tasks.filter((t) => t.status === statusFilter);
  }

  // Only the agent's own query narrows by reward: a newly posted task must
  // reach every agent, whatever reward range it registered with.
  tasks = tasks.filter((t) => {
    const reward = t.rewardUsdc ?? t.reward / 1_000_000;
    return reward >= minReward && reward <= maxReward;
  });

  const baseUrl = process.env.NEXT_PUBLIC_X402_URL || "https://www.cogladius.xyz";

  const enriched = tasks.map((t) => ({
    id: t.id,
    description: t.description,
    criteria: t.criteria,
    // `reward` is the documented field (see SKILL.md): the reward in XLM.
    // `rewardXlm` is an explicit alias; `rewardSol` is a legacy name kept for
    // older agents and will be removed — do not use it in new integrations.
    reward: t.rewardUsdc ?? t.reward / 1_000_000,
    rewardXlm: t.rewardUsdc ?? t.reward / 1_000_000,
    rewardSol: t.rewardUsdc ?? t.reward / 1_000_000,
    rewardAsset: "XLM",
    deadline: t.deadline,
    deadlineIso: new Date(t.deadline * 1000).toISOString(),
    status: t.status,
    submissionsCount: t.submissions?.length ?? 0,
    posterAddress: t.poster,
    alreadySubmitted: t.submissions?.some((s) => s.agent === agent.pubkey) ?? false,
    claimedByMe: t.claims?.some((c) => c.agent === agent.pubkey) ?? false,
    claimsCount: t.claims?.length ?? 0,
    // Escrow linkage: only tasks with a contractTaskId have a reward locked on-chain.
    contractTaskId: t.contractTaskId ?? null,
    escrowContractId: t.escrowContractId ?? null,
    escrowed: t.contractTaskId !== undefined,
    postTxHash: t.postTxHash ?? null,
    timeRemainingSeconds: Math.max(0, t.deadline - Math.floor(Date.now() / 1000)),
    // Paid live data the agent can buy while working (Stellar MPP). See GET /api/mpp.
    mppResources: Object.values(RESOURCES).map((r) => ({
      id: r.id,
      description: r.description,
      charge: { url: `${baseUrl}/api/mpp/charge/${r.id}`, price: r.chargePrice },
      session: { url: `${baseUrl}/api/mpp/session/${r.id}`, price: r.sessionPrice },
    })),
  }));

  return NextResponse.json({
    success: true,
    count: enriched.length,
    tasks: enriched,
    agentId: agent.pubkey,
    serverTime: new Date().toISOString(),
    meta: { filterApplied: { status: statusFilter, minReward, maxReward: Number.isFinite(maxReward) ? maxReward : null } },
  });
}
