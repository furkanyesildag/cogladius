/**
 * GET /api/agents/tasks
 * Dış agent'ların açık görevleri listelediği endpoint.
 * Header: Authorization: Bearer <apiKey>
 */

import { NextRequest, NextResponse } from "next/server";
import { validateApiKey, updateAgentHeartbeat } from "@/lib/agentRegistry";
import { getAllTasks, seedIfEmpty } from "@/lib/taskStore";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!apiKey) {
    return NextResponse.json({ success: false, error: "Authorization: Bearer <apiKey> gerekli" }, { status: 401 });
  }

  const agent = await validateApiKey(apiKey);
  if (!agent) {
    return NextResponse.json({ success: false, error: "Geçersiz veya yasaklı API key" }, { status: 403 });
  }

  await updateAgentHeartbeat(agent.pubkey, "idle");
  await seedIfEmpty();

  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get("status") || "Open";
  const minReward = parseFloat(searchParams.get("minReward") || "0");
  const maxReward = parseFloat(searchParams.get("maxReward") || "999999");

  let tasks = await getAllTasks();

  if (statusFilter !== "all") {
    tasks = tasks.filter((t) => t.status === statusFilter);
  }

  tasks = tasks.filter((t) => {
    const reward = t.rewardUsdc ?? t.reward / 1_000_000;
    return reward >= minReward && reward <= maxReward &&
           reward >= agent.config.minRewardUsdc && reward <= agent.config.maxRewardUsdc;
  });

  const baseUrl = process.env.NEXT_PUBLIC_X402_URL || "https://cogladius.xyz";

  const enriched = tasks.map((t) => ({
    id: t.id,
    description: t.description,
    criteria: t.criteria,
    rewardSol: t.rewardUsdc ?? t.reward / 1_000_000,
    deadline: t.deadline,
    deadlineIso: new Date(t.deadline * 1000).toISOString(),
    status: t.status,
    submissionsCount: t.submissions?.length ?? 0,
    posterAddress: t.poster,
    alreadySubmitted: t.submissions?.some((s) => s.agent === agent.pubkey) ?? false,
    timeRemainingSeconds: Math.max(0, t.deadline - Math.floor(Date.now() / 1000)),
    x402Endpoints: [
      { url: `${baseUrl}/stellar-metrics`, costUsdc: 0.005, description: "Stellar network metrics" },
      { url: `${baseUrl}/crypto-news`,    costUsdc: 0.005, description: "Live crypto news" },
      { url: `${baseUrl}/defi-analytics`, costUsdc: 0.010, description: "DeFi protocol analytics" },
    ],
  }));

  return NextResponse.json({
    success: true,
    count: enriched.length,
    tasks: enriched,
    agentId: agent.pubkey,
    serverTime: new Date().toISOString(),
    meta: { filterApplied: { status: statusFilter, minReward, maxReward }, agentConfig: agent.config },
  });
}
