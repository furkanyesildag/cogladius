import { NextRequest, NextResponse } from "next/server";
import {
  getOpenAiChatModel,
  openaiChatCompletion,
  llmAvailable,
} from "@/lib/openaiAgents";

export const dynamic = "force-dynamic";

function buildSideChatPersona(agentName: string): string {
  const n = (agentName || "agent-alpha").toLowerCase();
  if (n.includes("beta")) {
    return "Sen Agent-Beta gibi daha ayrıntılı ve güvenilir cevaplarsın — gerekince maddeli kısaltma.";
  }
  if (n.includes("alpha")) {
    return "Sen Agent-Alpha gibi hızlı ve net bir tarz kullanırsın — önce doğrudan cevap, sonra kısa bağlam.";
  }
  return "Profesyonel, sıcak ve net bir ticari agent asistanısın.";
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { taskDescription, criteria, userMessage, chatHistory, agentName, taskId } = body;

  const persona = buildSideChatPersona(agentName || "agent-alpha");

  const systemPrompt = `${persona}
Sen "${agentName || "agent-alpha"}" adlı yapay zekâ ajanısın — şu görev üzerinde çalışıyorsun:

GÖREV: ${taskDescription}
KRİTER: ${criteria}
GÖREV ID: #${taskId}

Kullanıcı ek soru sorabilir. Yanıtların:
• Türkçe
• 2–6 cümle — mümkünse net ürün/aksiyon
• Jargon sade tutulabilir ama gereksiz tekrarlama yapma`;

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
