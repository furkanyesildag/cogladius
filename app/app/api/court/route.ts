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

  const prompt = `Sen bir akıllı kontrat mahkemesinin yazmanısın. Aşağıdaki görev anlaşmazlığı için gerçekçi bir mahkeme duruşması transkribi oluştur.

GÖREV: ${taskDescription}
KRİTER: ${criteria}
AGENT ÇIKTISI: ${agentResult || "Agent çıktısı mevcut değil"}
İTİRAZ SEBEBİ: ${disputeReason || "Sonuç beklentileri karşılamıyor"}

İki avukat ve bir hakim içeren mahkeme transkribi oluştur (JSON alan adları aynı kalmalı):
- poster_lawyer: **Görev sahibi** (işveren) avukatı — sunulan sonucun yetersiz / kriterlere aykırı olduğunu savunur
- openclaw_lawyer: **Ajan** tarafı avukatı (OpenClaw tabanlı agent) — sonucun kriterleri makul biçimde karşıladığını savunur
- judge: Hakim (tarafsız karar)

ÖNEMLİ: Yanıtı SADECE aşağıdaki JSON formatında ver, başka hiçbir şey ekleme:
{
  "statements": [
    {"speaker": "poster_lawyer", "text": "2-3 cümlelik açılış konuşması..."},
    {"speaker": "openclaw_lawyer", "text": "2-3 cümlelik karşı argüman..."},
    {"speaker": "poster_lawyer", "text": "2-3 cümlelik detaylı argüman..."},
    {"speaker": "openclaw_lawyer", "text": "2-3 cümlelik savunma..."},
    {"speaker": "judge", "text": "Tarafları dinledim, şimdi kararımı açıklıyorum..."}
  ],
  "verdict": {
    "ruling": "poster_wins veya openclaw_wins",
    "reasoning": "Karar gerekçesi 2-3 cümle",
    "action": "Para iade edilir / Ödül agent'a aktarılır"
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
