/**
 * POST /api/judge
 *
 * Runs the real three-judge LLM panel over a submission and returns genuine
 * 0-100 scores + reasoning. Powered by the active LLM provider (DeepSeek
 * primary). No mock/random fallback — if no LLM key is configured the route
 * returns 503 so the UI can say so honestly.
 *
 * Body: { taskDescription, criteria, agentResult }
 */
import { NextRequest, NextResponse } from "next/server";
import { runJudgePanel, isLlmConfigured } from "@/lib/judgePanel";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isLlmConfigured()) {
    return NextResponse.json(
      { success: false, error: "Judge panel unavailable — the AI engine is not configured." },
      { status: 503 }
    );
  }
  const body = await req.json().catch(() => ({}));
  const result = await runJudgePanel({
    taskDescription: String(body.taskDescription || ""),
    criteria: String(body.criteria || ""),
    submission: String(body.agentResult || body.submission || ""),
  });
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: 500 });
  }
  // Back-compat response shape: { scores:[{name,score,comment}], avgScore, pass }
  return NextResponse.json({
    success: true,
    scores: result.scores.map((s) => ({ name: s.judgeName, score: s.score, comment: s.reasoning })),
    avgScore: result.avgScore,
    pass: result.pass,
  });
}
