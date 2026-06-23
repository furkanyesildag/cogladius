/**
 * POST /api/judge
 *
 * Runs the real three-judge LLM panel over a submission and returns genuine
 * 0-100 scores + reasoning. No mock/random fallback — if no LLM key is
 * configured the route returns 503 so the UI can say so honestly.
 *
 * Body: { taskDescription, criteria, agentResult }
 */
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const JUDGES = [
  { name: "TechnicalJudge", system: "You are a strict technical reviewer. Evaluate factual correctness, technical depth, logical consistency, and data accuracy against the task and criteria. 70+ means professional standard. Respond ONLY with JSON: {\"score\": <0-100>, \"reasoning\": \"<one sentence>\"}." },
  { name: "UsabilityJudge", system: "You are a clarity/usability reviewer. Evaluate readability, structure, practical applicability, and conciseness. 70+ means clear and actionable. Respond ONLY with JSON: {\"score\": <0-100>, \"reasoning\": \"<one sentence>\"}." },
  { name: "CompletenessJudge", system: "You are a scope/completeness reviewer. Evaluate whether the submission covers everything the task and criteria demand. 70+ means comprehensive. Respond ONLY with JSON: {\"score\": <0-100>, \"reasoning\": \"<one sentence>\"}." },
];

function buildPrompt(d: { taskDescription: string; criteria: string; agentResult: string }) {
  return `TASK:\n${d.taskDescription}\n\nCRITERIA:\n${d.criteria}\n\nSUBMISSION:\n${d.agentResult}\n\nScore this submission 0-100 and justify briefly.`;
}

async function callAnthropic(system: string, user: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6", max_tokens: 300, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

async function callOpenAI(system: string, user: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: process.env.OPENAI_CHAT_MODEL_JUDGE || "gpt-4o-mini", messages: [{ role: "system", content: system }, { role: "user", content: user }], response_format: { type: "json_object" } }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

function parse(text: string) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no JSON");
  const o = JSON.parse(m[0]);
  return { score: Math.max(0, Math.min(100, Math.round(Number(o.score)))), reasoning: String(o.reasoning || "").slice(0, 300) };
}

export async function POST(req: NextRequest) {
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  if (!hasAnthropic && !hasOpenAI) {
    return NextResponse.json(
      { success: false, error: "Judge panel unavailable — configure ANTHROPIC_API_KEY or OPENAI_API_KEY." },
      { status: 503 }
    );
  }
  try {
    const body = await req.json();
    const d = {
      taskDescription: String(body.taskDescription || ""),
      criteria: String(body.criteria || ""),
      agentResult: String(body.agentResult || ""),
    };
    const user = buildPrompt(d);
    const scores = await Promise.all(
      JUDGES.map(async (j) => {
        const text = hasAnthropic ? await callAnthropic(j.system, user) : await callOpenAI(j.system, user);
        const { score, reasoning } = parse(text);
        return { name: j.name, score, comment: reasoning };
      })
    );
    const avgScore = Math.round(scores.reduce((a, s) => a + s.score, 0) / scores.length);
    return NextResponse.json({ success: true, scores, avgScore, pass: avgScore >= 70 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || "Judging failed" }, { status: 500 });
  }
}
