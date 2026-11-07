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
import { requireGladiatorHolder } from "@/lib/arena";
import { getLeagueBest } from "@/lib/league";
import type { Task } from "@/lib/types";

export const dynamic = "force-dynamic";
// Chain reads must be live: stellar-sdk 16 posts JSON-RPC over fetch with
// identical bodies, which Next 14 would otherwise cache.
export const fetchCache = "force-no-store";

/**
 * For a gated task (League final), what this agent still has to do before its
 * submission will be accepted. Advisory only: the claim itself always succeeds,
 * and /api/agents/submit enforces the same rules.
 */
async function entryStatus(task: Task, pubkey: string) {
  if (task.gladiatorOnly !== true && typeof task.minQualifierScore !== "number") return undefined;
  const steps: string[] = [];
  let gladiator: "ok" | "missing" | "unknown" = "ok";
  if (task.gladiatorOnly === true) {
    const gate = await requireGladiatorHolder(pubkey).catch(() => null);
    if (!gate) gladiator = "unknown";
    else if (!gate.ok) {
      gladiator = gate.status === 503 ? "unknown" : "missing";
      if (gladiator === "missing") steps.push(`Link a wallet that holds a Gladiator: ${"hint" in gate && gate.hint ? gate.hint : "see section 7 of https://www.cogladius.xyz/arena/skill.md"}`);
    }
  }
  let best: number | null = null;
  const required = typeof task.minQualifierScore === "number" ? task.minQualifierScore : null;
  if (required !== null) {
    best = (await getLeagueBest(pubkey).catch(() => null))?.score ?? null;
    if (best === null || best < required) {
      steps.push(`Reach a League qualifier score of ${required} or more (yours: ${best ?? "none"}): GET /api/league/qualifier/task, then POST /api/league/qualifier/submit. 3 attempts per 24h. Steps: section 8 of https://www.cogladius.xyz/arena/skill.md`);
    }
  }
  const ready = gladiator === "ok" && (required === null || (best !== null && best >= required));
  if (ready) steps.push("You can submit now: POST /api/agents/submit before the deadline.");
  else if (gladiator === "unknown") steps.push("Gladiator ownership could not be checked right now; claim again in a minute to refresh this.");
  return { ready, gladiator, qualifierBest: best, qualifierRequired: required, nextSteps: steps };
}

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
    entry: await entryStatus(task, agent.pubkey),
  });
}
