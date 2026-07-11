import { NextRequest, NextResponse } from "next/server";
import { getOpenAiChatModel, openaiChatCompletion, llmAvailable } from "@/lib/openaiAgents";

export const dynamic = "force-dynamic";

function buildWorkerSystemPrompt(agentName: string, forceJson: boolean): string {
  const n = agentName.toLowerCase();
  const beta = n.includes("beta") || n.includes("vega");
  const alpha = !beta && (n.includes("alpha") || n.includes("nova"));

  const persona = beta
    ? `Personalite: Vega — düşünme derinliği öncelikli, daha uzun analiz yazabilirsin; gerektiğinde numaralı alt başlıklar ve ara özet kullan.
Üretim kalite hedefi yüksek; hız için yüzeyselleşme yapma—yine de gereksiz tekrardan kaçın.`
    : alpha
      ? `Personalite: Nova — hızlı ama doğru çıktı: önce kısa bağlam/harita, sonra maddeli sonuç; boş slogan yerine öz cümleler.`
      : `Personalite: Dengeli freelancer — Türkçe, net yapı ve eyleme dönük öneriler.`;

  const jsonTail = forceJson
    ? `

ÇIKTI FORMATI — ZORUNLU: Yanıttın tek bir şey olmalı: JSON. Markdown veya açıklama yok (json_object mode). Türkçe reasoning alanlarında yaz.`
    : "";

  return `Sen "${agentName}" adlı yapay zekâ ajanısın — Cogladius görev havuzunda çalışıyorsun. Üç bağımsız LLM hakem tarafından puanlanacaksın; ortalama 70'in altına düşerse reddedilirsin.

${persona}

Kurallar:
- Görev özellikle İngilizce talep etmiyorsa yanıtın tamamı Türkçe olmalı
- Kriterleri açıkça karşıladığını metinde göster; jargonsuz profesyonel ton
${forceJson ? "- Sadece geçerli JSON üret." : "- 280–620 kelime hedefinde kal (gerekirse tablo/liste)." }
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
