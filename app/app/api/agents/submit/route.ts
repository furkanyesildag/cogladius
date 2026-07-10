/**
 * POST /api/agents/submit
 * Dış agent'ların görev sonucu gönderdiği endpoint.
 * Header: Authorization: Bearer <apiKey>
 */

import { NextRequest, NextResponse } from "next/server";
import { validateApiKey, updateAgentHeartbeat, updateAgentStats } from "@/lib/agentRegistry";
import { getTask, addSubmission, addVerdict, updateTaskStatus, seedIfEmpty } from "@/lib/taskStore";
import { runJudgePanel } from "@/lib/judgePanel";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!apiKey) {
    return NextResponse.json({ success: false, error: "Authorization: Bearer <apiKey> gerekli" }, { status: 401 });
  }

  const agent = await validateApiKey(apiKey);
  if (!agent) {
    return NextResponse.json({ success: false, error: "Geçersiz veya yasaklı API key" }, { status: 403 });
  }

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ success: false, error: "Geçersiz JSON body" }, { status: 400 }); }

  const { taskId, result, resultHash, timeTakenSeconds, x402Spent } = body;

  if (!taskId || typeof taskId !== "number") {
    return NextResponse.json({ success: false, error: "taskId (number) zorunludur" }, { status: 400 });
  }
  if (!result || typeof result !== "string" || result.length < 10) {
    return NextResponse.json({ success: false, error: "result (min 10 karakter) zorunludur" }, { status: 400 });
  }
  if (result.length > 100_000) {
    return NextResponse.json({ success: false, error: "result max 100,000 karakter" }, { status: 400 });
  }

  const computedHash = resultHash || crypto.createHash("sha256").update(result).digest("hex");

  await seedIfEmpty();
  const timeTaken = typeof timeTakenSeconds === "number" ? timeTakenSeconds : 30;
  const task = await getTask(taskId);

  if (!task) {
    return NextResponse.json({ success: false, error: `Görev #${taskId} bulunamadı` }, { status: 404 });
  }
  if (task.status === "Settled" || task.status === "Resolved") {
    return NextResponse.json({ success: false, error: `Görev #${taskId} zaten tamamlandı` }, { status: 409 });
  }

  await addSubmission(taskId, {
    agent: agent.pubkey,
    resultHash: computedHash,
    resultUrl: `data:text/plain;base64,${Buffer.from(result).toString("base64")}`,
    submittedAt: Math.floor(Date.now() / 1000),
    timeTakenSeconds: timeTaken,
  });

  await updateAgentStats(agent.pubkey, {
    tasksAttempted: agent.stats.tasksAttempted + 1,
    x402Spent: agent.stats.x402Spent + (x402Spent ?? 0),
  });
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
      ? `✅ Görev #${taskId} değerlendirildi — ortalama ${panel.avgScore}/100 (${panel.pass ? "GEÇTİ" : "eşik altı"}). Kazanan seçilince ödül on-chain serbest bırakılır.`
      : `✅ Görev #${taskId} gönderimi alındı. Jüri şu an değerlendiremedi: ${panel.error}`,
  });
}
