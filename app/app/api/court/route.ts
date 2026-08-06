import { NextRequest, NextResponse } from "next/server";
import {
  getOpenAiChatModel,
  openaiChatCompletion,
  llmAvailable,
} from "@/lib/openaiAgents";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { taskDescription, criteria, agentResult, disputeReason } = body;

  // Agent Court is an LLM roleplay (on-chain resolution is a deferred
  // deliverable). With no LLM key we report unavailable rather than fabricate.
  if (!llmAvailable()) {
    return NextResponse.json({
      statements: [],
      verdict: null,
      error: "Agent Court requires the AI engine to be configured.",
    });
  }

  const prompt = `You are the clerk of a smart-contract court. Produce a realistic hearing transcript for the task dispute below.

TASK: ${taskDescription}
CRITERIA: ${criteria}
AGENT OUTPUT: ${agentResult || "No agent output available"}
DISPUTE REASON: ${disputeReason || "The result does not meet expectations"}

Write a transcript with two counsel and a magistrate (keep the JSON field names exactly as given):
- poster_lawyer: counsel for the task poster, arguing the submitted result is insufficient or fails the criteria
- openclaw_lawyer: counsel for the agent, arguing the result reasonably meets the criteria
- judge: the magistrate, delivering an impartial ruling

IMPORTANT: respond with ONLY the following JSON and nothing else:
{
  "statements": [
    {"speaker": "poster_lawyer", "text": "2-3 sentence opening statement..."},
    {"speaker": "openclaw_lawyer", "text": "2-3 sentence rebuttal..."},
    {"speaker": "poster_lawyer", "text": "2-3 sentence detailed argument..."},
    {"speaker": "openclaw_lawyer", "text": "2-3 sentence defence..."},
    {"speaker": "judge", "text": "Having heard both sides, here is my ruling..."}
  ],
  "verdict": {
    "ruling": "poster_wins or openclaw_wins",
    "reasoning": "2-3 sentences of reasoning",
    "action": "Funds are refunded / The reward is released to the agent"
  }
}

Write every statement and the verdict in the same language as the TASK above: if the task is in English, the whole transcript is in English. Use realistic, professional courtroom language.`;

  try {
    const orch = await openaiChatCompletion({
      model: getOpenAiChatModel("court"),
      messages: [
        {
          role: "system",
          content:
            "Yanıtın yalnızca tek JSON nesnesi olmalı; markdown ve kod çiti yok. Alan adları kullanıcı metninde verildiği gibi korunmalı.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 1400,
      temperature: 0.65,
      response_format: { type: "json_object" },
    });

    if (!orch.ok) throw new Error(orch.error);

    const raw = orch.text || "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("JSON parse hatası");

    const trial = JSON.parse(jsonMatch[0]);
    return NextResponse.json(trial);
  } catch (err: any) {
    return NextResponse.json({
      statements: [],
      verdict: null,
      error: `Court trial failed: ${err?.message || "unknown"}`,
    });
  }
}
