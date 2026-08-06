/**
 * Shared three-judge LLM panel. Runs three independent judges (technical,
 * usability, completeness) over a submission and returns genuine 0-100 scores.
 * Powered by the active LLM provider (DeepSeek primary). Used by both the
 * `/api/judge` route and the agent submission path so verdicts are persisted to
 * `task.verdicts` and can drive the on-chain settlement.
 */
import { openaiChatCompletion, llmAvailable } from "@/lib/openaiAgents";

export const PASS_THRESHOLD = 70;

const JUDGES = [
  {
    id: 1,
    name: "TechnicalJudge",
    system:
      'You are a strict technical reviewer. Evaluate factual correctness, technical depth, logical consistency, and data accuracy against the task and criteria. 70+ means professional standard. Respond ONLY with JSON: {"score": <0-100>, "reasoning": "<one sentence>"}.',
  },
  {
    id: 2,
    name: "UsabilityJudge",
    system:
      'You are a clarity/usability reviewer. Evaluate readability, structure, practical applicability, and conciseness. 70+ means clear and actionable. Respond ONLY with JSON: {"score": <0-100>, "reasoning": "<one sentence>"}.',
  },
  {
    id: 3,
    name: "CompletenessJudge",
    system:
      'You are a scope/completeness reviewer. Evaluate whether the submission covers everything the task and criteria demand. 70+ means comprehensive. Respond ONLY with JSON: {"score": <0-100>, "reasoning": "<one sentence>"}.',
  },
];

export type JudgeScore = {
  judgeId: number;
  judgeName: string;
  score: number;
  reasoning: string;
};

export type JudgePanelResult =
  | { ok: true; scores: JudgeScore[]; avgScore: number; pass: boolean }
  | { ok: false; error: string };

function buildUserPrompt(d: { taskDescription: string; criteria: string; submission: string }) {
  // The reasoning is shown to the task poster, so it has to come back in the
  // language they wrote the task in. Without this the model mirrors the
  // submission instead, and an English task can come back judged in Turkish.
  return `TASK:\n${d.taskDescription}\n\nCRITERIA:\n${d.criteria}\n\nSUBMISSION:\n${d.submission}\n\nScore this submission 0-100 and justify briefly. Write the "reasoning" value in the same language as the TASK above, regardless of the language of the submission.`;
}

function parseScore(text: string): { score: number; reasoning: string } {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("judge returned no JSON");
  const o = JSON.parse(m[0]);
  return {
    score: Math.max(0, Math.min(100, Math.round(Number(o.score)))),
    reasoning: String(o.reasoning || "").slice(0, 300),
  };
}

export function isLlmConfigured(): boolean {
  return llmAvailable();
}

/** Run the three-judge panel. Judges run concurrently; any failure fails the panel. */
export async function runJudgePanel(d: {
  taskDescription: string;
  criteria: string;
  submission: string;
  passThreshold?: number;
}): Promise<JudgePanelResult> {
  if (!llmAvailable()) {
    return {
      ok: false,
      error: "Judge panel unavailable — the AI engine is not configured.",
    };
  }
  const threshold = d.passThreshold ?? PASS_THRESHOLD;
  const user = buildUserPrompt(d);

  try {
    const scores = await Promise.all(
      JUDGES.map(async (j): Promise<JudgeScore> => {
        const r = await openaiChatCompletion({
          role: "judge",
          messages: [
            { role: "system", content: j.system },
            { role: "user", content: user },
          ],
          // Judge model may be a reasoning model (deepseek-v4-pro) whose hidden
          // reasoning shares the token budget — give it headroom so the final
          // JSON answer isn't truncated away.
          max_tokens: 1200,
          temperature: 0.2,
          response_format: { type: "json_object" },
        });
        if (!r.ok) throw new Error(`${j.name}: ${r.error}`);
        const { score, reasoning } = parseScore(r.text);
        return { judgeId: j.id, judgeName: j.name, score, reasoning };
      })
    );
    const avgScore = Math.round(scores.reduce((a, s) => a + s.score, 0) / scores.length);
    return { ok: true, scores, avgScore, pass: avgScore >= threshold };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Judging failed" };
  }
}
