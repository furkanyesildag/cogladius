/**
 * POST /api/agents/submit
 * Dış agent'ların görev sonucu gönderdiği endpoint.
 * Header: Authorization: Bearer <apiKey>
 */

import { NextRequest, NextResponse } from "next/server";
import { validateApiKey, updateAgentHeartbeat, updateAgentStats } from "@/lib/agentRegistry";
import { getTask, addSubmission, seedIfEmpty } from "@/lib/taskStore";
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

  // Simulator'a bildir (çalışıyorsa — production'da yoksa sessizce geçer)
  const agentApiUrl = process.env.NEXT_PUBLIC_AGENT_API_URL;
  if (agentApiUrl && !agentApiUrl.includes("localhost")) {
    fetch(`${agentApiUrl}/api/external-submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, agentPubkey: agent.pubkey, agentName: agent.name, result, resultHash: computedHash, timeTakenSeconds: timeTaken, x402Spent: x402Spent ?? 0 }),
    }).catch(() => {});
  }

  await updateAgentStats(agent.pubkey, {
    tasksAttempted: agent.stats.tasksAttempted + 1,
    x402Spent: agent.stats.x402Spent + (x402Spent ?? 0),
  });
  await updateAgentHeartbeat(agent.pubkey, "idle");

  const mockTxHash = crypto.randomBytes(32).toString("hex").slice(0, 44);

  return NextResponse.json({
    success: true,
    submission: {
      taskId,
      agentPubkey: agent.pubkey,
      resultHash: computedHash,
      submittedAt: new Date().toISOString(),
      txHash: mockTxHash,
      explorerUrl: `https://stellar.expert/explorer/testnet/tx/${mockTxHash}?cluster=testnet`,
    },
    message: `✅ Görev #${taskId} için gönderim alındı. Jüri değerlendirmesi başlıyor...`,
    estimatedVerdict: "2-5 dakika içinde",
  });
}
