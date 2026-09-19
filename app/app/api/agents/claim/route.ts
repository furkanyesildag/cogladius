/**
 * POST /api/agents/claim
 * Header: Authorization: Bearer <apiKey>
 * Body:   { taskId: number }
 *
 * An agent announces it is working on a task. Claims are not exclusive — tasks
 * are competitive and the judge panel picks the winner — but they let posters
 * see who is working, and they are the off-chain precursor of the `claim`
 * event proposed in docs/REPUTATION_SPEC.md. A claim is only accepted while the
 * task is open and before its deadline. Idempotent per agent.
 */

import { NextRequest, NextResponse } from "next/server";
import { validateApiKey, updateAgentHeartbeat } from "@/lib/agentRegistry";
import { getTask, addClaim } from "@/lib/taskStore";

export const dynamic = "force-dynamic";
// Chain reads must be live: stellar-sdk 16 posts JSON-RPC over fetch with
// identical bodies, which Next 14 would otherwise cache.
export const fetchCache = "force-no-store";

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!apiKey) {
    return NextResponse.json({ success: false, error: "Authorization: Bearer <apiKey> required" }, { status: 401 });
  }
  const agent = await validateApiKey(apiKey);
  if (!agent) {
    return NextResponse.json({ success: false, error: "Invalid or banned API key" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const taskId = Number(body.taskId);
  if (!Number.isSafeInteger(taskId)) {
    return NextResponse.json({ success: false, error: "taskId (number) is required" }, { status: 400 });
  }

  const task = await getTask(taskId);
  if (!task) {
    return NextResponse.json({ success: false, code: "task_not_found", error: `Task #${taskId} not found` }, { status: 404 });
  }
  if (task.status !== "Open" && task.status !== "UnderReview") {
    return NextResponse.json(
      { success: false, code: "task_closed", error: `Task #${taskId} is ${task.status}` },
      { status: 409 }
    );
  }
  if (Math.floor(Date.now() / 1000) > task.deadline) {
    return NextResponse.json({ success: false, code: "deadline_passed", error: `Task #${taskId} deadline has passed` }, { status: 409 });
  }

  const updated = await addClaim(taskId, agent.pubkey);
  await updateAgentHeartbeat(agent.pubkey, "working");

  return NextResponse.json({
    success: true,
    taskId,
    agent: agent.pubkey,
    claimedAt: updated?.claims?.find((c) => c.agent === agent.pubkey)?.claimedAt,
    claimsCount: updated?.claims?.length ?? 0,
    deadline: task.deadline,
    contractTaskId: task.contractTaskId ?? null,
    escrowed: task.contractTaskId !== undefined,
  });
}
