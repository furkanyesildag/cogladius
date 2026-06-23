/**
 * Cogladius — three-judge LLM panel.
 *
 * Runs three independent LLM personas (technical, usability, completeness) over
 * a submission, each returning a 0-100 score + reasoning. The averaged result is
 * what the platform's verdict authority signs before calling the escrow
 * contract's `release_to_winner`. Real LLM calls only — no mock scores.
 *
 * Configure ANTHROPIC_API_KEY (preferred) or OPENAI_API_KEY.
 */
"use strict";

const JUDGES = [
  {
    id: 1,
    name: "TechnicalJudge",
    system:
      "You are a strict technical reviewer. Evaluate factual correctness, technical depth, logical consistency, and data accuracy of the submission against the task and criteria. 70+ means professional standard. Respond ONLY with JSON: {\"score\": <0-100>, \"reasoning\": \"<one paragraph>\"}.",
  },
  {
    id: 2,
    name: "UsabilityJudge",
    system:
      "You are a clarity and usability reviewer. Evaluate readability, structure, practical applicability, and conciseness of the submission for its intended audience. 70+ means clear and actionable. Respond ONLY with JSON: {\"score\": <0-100>, \"reasoning\": \"<one paragraph>\"}.",
  },
  {
    id: 3,
    name: "CompletenessJudge",
    system:
      "You are a scope and completeness reviewer. Evaluate whether the submission covers every aspect the task and criteria demand, with nothing important missing. 70+ means comprehensive. Respond ONLY with JSON: {\"score\": <0-100>, \"reasoning\": \"<one paragraph>\"}.",
  },
];

function buildPrompt(task, submission) {
  return [
    `TASK:\n${task.description}`,
    `EVALUATION CRITERIA:\n${task.criteria}`,
    `AGENT SUBMISSION:\n${submission.result || submission}`,
    `Score this submission from 0 to 100 and justify briefly.`,
  ].join("\n\n");
}

async function callAnthropic(system, user) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: 400,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

async function callOpenAI(system, user) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_CHAT_MODEL_JUDGE || "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

function parseScore(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Judge did not return JSON");
  const obj = JSON.parse(match[0]);
  const score = Math.max(0, Math.min(100, Math.round(Number(obj.score))));
  return { score, reasoning: String(obj.reasoning || "").slice(0, 500) };
}

async function runJudge(judge, task, submission) {
  const user = buildPrompt(task, submission);
  let text;
  if (process.env.ANTHROPIC_API_KEY) text = await callAnthropic(judge.system, user);
  else if (process.env.OPENAI_API_KEY) text = await callOpenAI(judge.system, user);
  else throw new Error("No LLM key configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY).");
  const { score, reasoning } = parseScore(text);
  return { judgeId: judge.id, judgeName: judge.name, agent: submission.agent, score, reasoning };
}

/**
 * Run the full 3-judge panel in parallel.
 * @returns {Promise<{verdicts: object[], avgScore: number, pass: boolean}>}
 */
async function runJudgePanel(task, submission, passThreshold = 70) {
  const verdicts = await Promise.all(JUDGES.map((j) => runJudge(j, task, submission)));
  const avgScore = Math.round(verdicts.reduce((a, v) => a + v.score, 0) / verdicts.length);
  return { verdicts, avgScore, pass: avgScore >= passThreshold };
}

module.exports = { runJudgePanel, JUDGES };

// CLI: node judge-agent.js '<task json>' '<submission json>'
if (require.main === module) {
  const [taskArg, subArg] = process.argv.slice(2);
  if (!taskArg || !subArg) {
    console.error("usage: node judge-agent.js '<task json>' '<submission json>'");
    process.exit(1);
  }
  runJudgePanel(JSON.parse(taskArg), JSON.parse(subArg))
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
