import { NextRequest, NextResponse } from "next/server";
import { getOpenAiChatModel, openaiChatCompletion, llmAvailable } from "@/lib/openaiAgents";

export const dynamic = "force-dynamic";

function buildWorkerSystemPrompt(agentName: string, forceJson: boolean): string {
  const n = agentName.toLowerCase();
  const beta = n.includes("beta") || n.includes("vega");
  const alpha = !beta && (n.includes("alpha") || n.includes("nova"));

  const persona = beta
    ? `Persona: Vega. Depth first. You may write a longer analysis, using numbered sub-headings and interim summaries where they help. Aim high on quality; never go shallow for speed, but avoid needless repetition.`
    : alpha
      ? `Persona: Nova. Fast but accurate. Lead with a short map of the problem, then the result as clear points. Concise sentences over empty slogans.`
      : `Persona: a balanced professional. Clear structure and actionable recommendations.`;

  const jsonTail = forceJson
    ? `

OUTPUT FORMAT (REQUIRED): respond with a single JSON object and nothing else. No markdown, no commentary (json_object mode).`
    : "";

  return `You are the AI agent "${agentName}", working the Cogladius task pool. Three independent AI judges will score your submission; if the average falls below 70 you are rejected.

${persona}

Rules:
- Write your entire answer in the same language as the task description. If the task is in English, answer in English; if it is in Turkish, answer in Turkish. Never switch languages on the requester.
- Show explicitly in the text that you meet the criteria. Professional tone, no jargon padding.
${forceJson ? "- Emit valid JSON only." : "- Target 280 to 620 words, using a table or list where it helps." }
${jsonTail}`;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    taskDescription,
    criteria,
    agentName = "nova",
    taskId,
    forceJson = false,
    systemExtra,
  } = body;

  if (!llmAvailable()) {
    return NextResponse.json({
      success: false,
      result: "",
      error:
        "Agent generation unavailable — the AI engine is not configured.",
    });
  }

  let systemPrompt = buildWorkerSystemPrompt(String(agentName), Boolean(forceJson));
  if (systemExtra && typeof systemExtra === "string") {
    systemPrompt += `\n\nEk talimatlar (operatör):\n${systemExtra}`;
  }

  const userPrompt = `GÖREV #${taskId}: ${taskDescription}

DEĞERLENDİRME KRİTERLERİ: ${criteria}

Bu görevi şimdi eksiksiz olarak tamamla. Doğrudan cevabını ver — "önümüzde günler var" vb. yüzerme yok.${forceJson ? " Yalnızca JSON çıkt." : ""}`;

  const orch = await openaiChatCompletion({
    model: getOpenAiChatModel("agent"),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: forceJson ? 2000 : 1100,
    temperature: forceJson ? 0.35 : 0.72,
    ...(forceJson ? { response_format: { type: "json_object" } } : {}),
  });

  if (!orch.ok) {
    console.error("[agent-work]", orch.error);
    return NextResponse.json({
      success: false,
      result: "",
      error: `Agent generation failed: ${orch.error}`,
    });
  }

  return NextResponse.json({ success: true, result: orch.text });
}
