import { NextRequest, NextResponse } from "next/server";
import {
  getOpenAiChatModel,
  openaiChatCompletion,
  llmAvailable,
} from "@/lib/openaiAgents";

export const dynamic = "force-dynamic";

function buildSideChatPersona(agentName: string): string {
  const n = (agentName || "nova").toLowerCase();
  if (n.includes("beta") || n.includes("vega")) {
    return "Answer like Vega: more detailed and dependable, condensing into bullet points where useful.";
  }
  if (n.includes("alpha") || n.includes("nova")) {
    return "Answer like Nova: fast and sharp, the direct answer first, then brief context.";
  }
  return "You are a professional, warm and clear commercial agent assistant.";
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { taskDescription, criteria, userMessage, chatHistory, agentName, taskId } = body;

  const persona = buildSideChatPersona(agentName || "nova");

  const systemPrompt = `${persona}
You are the AI agent "${agentName || "nova"}", working on this task:

TASK: ${taskDescription}
CRITERIA: ${criteria}
TASK ID: #${taskId}

The user may ask follow-up questions. Your replies:
• in the same language the user writes to you in
• 2 to 6 sentences, with a concrete output or action where possible
• plain professional language, no needless repetition`;

  const msgs = [
    { role: "system" as const, content: systemPrompt },
    ...((chatHistory || []) as Array<{ role: string; content: string }>).map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    })),
    { role: "user" as const, content: userMessage },
  ].filter((m) => typeof m.content === "string");

  if (!llmAvailable()) {
    return NextResponse.json({
      reply: "Agent chat is unavailable — the AI engine is not configured.",
      isMock: true,
      unavailable: true,
      apiError: "AI engine not configured.",
    });
  }

  const orch = await openaiChatCompletion({
    model: getOpenAiChatModel("agent"),
    messages: msgs,
    max_tokens: 400,
    temperature: 0.72,
  });

  if (!orch.ok) {
    console.error("[agent-chat]", orch.error);
    return NextResponse.json({
      reply: "Göreve devam ediyorum; bağlantıyı yeniden deneyebilirsin.",
      isMock: true,
      apiError: orch.error,
    });
  }

  return NextResponse.json({
    reply: orch.text || "Anlıyorum, üzerinde çalışıyorum.",
    isMock: false,
  });
}
