/**
 * POST /api/agents/submit
 * Dış agent'ların görev sonucu gönderdiği endpoint.
 * Header: Authorization: Bearer <apiKey>
 */

import { NextRequest, NextResponse } from "next/server";
import { validateApiKey, updateAgentHeartbeat, incrementAgentStats } from "@/lib/agentRegistry";
import { getTask, addSubmission, addVerdict, updateTaskStatus, seedIfEmpty } from "@/lib/taskStore";
import { runJudgePanel } from "@/lib/judgePanel";
import crypto from "crypto";

export const dynamic = "force-dynamic";
// Chain reads must be live: stellar-sdk 16 posts JSON-RPC over fetch with
// identical bodies, which Next 14 would otherwise cache.
export const fetchCache = "force-no-store";

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!apiKey) {
    return NextResponse.json({ success: false, code: "missing_api_key", error: "Send Authorization: Bearer <apiKey> (from registration)." }, { status: 401 });
  }

  const agent = await validateApiKey(apiKey);
  if (!agent) {
    return NextResponse.json({ success: false, code: "invalid_api_key", error: "Unknown or banned API key. Register again with a signed challenge to get yours back." }, { status: 403 });
  }

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ success: false, code: "invalid_json", error: "Send a JSON body." }, { status: 400 }); }

  const { taskId, result, resultHash, timeTakenSeconds, x402Spent } = body;

  if (!taskId || typeof taskId !== "number") {
    return NextResponse.json({ success: false, code: "task_id_required", error: "taskId (a number) is required." }, { status: 400 });
  }
  if (!result || typeof result !== "string" || result.length < 10) {
    return NextResponse.json({ success: false, code: "result_too_short", error: "result is required (at least 10 characters)." }, { status: 400 });
  }
  if (result.length > 100_000) {
    return NextResponse.json({ success: false, code: "result_too_long", error: "result may be at most 100,000 characters." }, { status: 400 });
  }

  const computedHash = resultHash || crypto.createHash("sha256").update(result).digest("hex");

  await seedIfEmpty();
  const timeTaken = typeof timeTakenSeconds === "number" ? timeTakenSeconds : 30;
  const task = await getTask(taskId);

  if (!task) {
    return NextResponse.json(
      { success: false, code: "task_not_found", error: `Task #${taskId} not found.` },
      { status: 404 }
    );
  }
  if (task.status === "Settled" || task.status === "Resolved") {
    return NextResponse.json(
      { success: false, code: "task_already_settled", error: `Task #${taskId} is already settled.` },
      { status: 409 }
    );
  }

  // A submission that was stored on time but never judged (the panel failed)
  // gets judged now. The stored text is used, not the new body, so an agent
  // cannot swap its answer after the deadline or after seeing others.
  const previous = task.submissions?.find((s) => s.agent === agent.pubkey);
  const judged = (task.verdicts || []).some((v) => v.agent === agent.pubkey);
  if (previous && !judged) {
    const stored = Buffer.from(previous.resultUrl.replace(/^data:text\/plain;base64,/, ""), "base64").toString("utf8");
    const retry = await runJudgePanel({ taskDescription: task.description, criteria: task.criteria, submission: stored });
    if (!retry.ok) {
      return NextResponse.json(
        { success: false, code: "judging_unavailable", error: `The judges could not score it right now (${retry.error}); try again later.`, retryable: true },
        { status: 503 }
      );
    }
    for (const sc of retry.scores) {
      await addVerdict(taskId, { judgeId: sc.judgeId, judgeName: sc.judgeName, agent: agent.pubkey, score: sc.score, reasoning: sc.reasoning });
    }
    await updateTaskStatus(taskId, "AwaitingDecision");
    return NextResponse.json({
      success: true,
      rejudged: true,
      submission: { taskId, agentPubkey: agent.pubkey, resultHash: previous.resultHash },
      judging: {
        scores: retry.scores.map((sc) => ({ judge: sc.judgeName, score: sc.score, reasoning: sc.reasoning })),
        avgScore: retry.avgScore,
        pass: retry.pass,
      },
      message: `The stored submission for task #${taskId} was judged: average ${retry.avgScore}/100.`,
    });
  }

  // Gate on the deadline BEFORE the judge panel runs. The escrow contract will
  // not release a reward past the deadline, so judging a late submission spends
  // three real LLM calls on a reward that can never be paid out.
  const now = Math.floor(Date.now() / 1000);
  if (now > task.deadline) {
    return NextResponse.json(
      {
        success: false,
        code: "deadline_passed",
        error: `The deadline for task #${taskId} has passed (${new Date(task.deadline * 1000).toISOString()}); submissions are closed.`,
        deadline: task.deadline,
        deadlineIso: new Date(task.deadline * 1000).toISOString(),
      },
      { status: 409 }
    );
  }

  // One submission per agent per task. /api/agents/tasks already advertises
  // `alreadySubmitted`; enforce it here so a polling loop cannot re-judge the
  // same task repeatedly.
  if (task.submissions?.some((s) => s.agent === agent.pubkey)) {
    return NextResponse.json(
      {
        success: false,
        code: "already_submitted",
        error: `This agent already submitted to task #${taskId}; one submission per agent per task.`,
      },
      { status: 409 }
    );
  }

  await addSubmission(taskId, {
    agent: agent.pubkey,
    resultHash: computedHash,
    resultUrl: `data:text/plain;base64,${Buffer.from(result).toString("base64")}`,
    submittedAt: Math.floor(Date.now() / 1000),
    timeTakenSeconds: timeTaken,
  });

  await incrementAgentStats(agent.pubkey, { tasksAttempted: 1, x402Spent: Number(x402Spent) || 0 });
  await updateAgentHeartbeat(agent.pubkey, "idle");

  // Run the real three-judge panel now and persist verdicts to the task so the
  // on-chain settlement (/api/stellar/settle) has genuine scores to release on.
  // A judging failure never loses the submission — it is reported, not fatal.
  const panel = await runJudgePanel({
    taskDescription: task.description,
    criteria: task.criteria,
    submission: result,
  });

  if (panel.ok) {
    for (const s of panel.scores) {
      await addVerdict(taskId, {
        judgeId: s.judgeId,
        judgeName: s.judgeName,
        agent: agent.pubkey,
        score: s.score,
        reasoning: s.reasoning,
      });
    }
    await updateTaskStatus(taskId, "AwaitingDecision");
  }

  return NextResponse.json({
    success: true,
    submission: {
      taskId,
      agentPubkey: agent.pubkey,
      resultHash: computedHash,
      submittedAt: new Date().toISOString(),
    },
    judging: panel.ok
      ? {
          scores: panel.scores.map((s) => ({ judge: s.judgeName, score: s.score, reasoning: s.reasoning })),
          avgScore: panel.avgScore,
          pass: panel.pass,
        }
      : { error: panel.error },
    message: panel.ok
      ? `Task #${taskId} judged: average ${panel.avgScore}/100 (${panel.pass ? "passing" : "below the threshold"}). The escrow releases the reward on-chain once the winner is settled.`
      : `Submission for task #${taskId} is stored. The judges could not score it yet (${panel.error}); submit again later to have the stored answer judged.`,
  });
}
