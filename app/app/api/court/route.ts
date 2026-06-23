import { NextRequest, NextResponse } from "next/server";
import {
  getOpenAiChatModel,
  openaiChatCompletion,
  resolveOpenAiApiKey,
} from "@/lib/openaiAgents";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { taskDescription, criteria, agentResult, disputeReason } = body;

  // Simülasyon modu: OpenAI yoksa statik senaryo döndür
  if (!resolveOpenAiApiKey()) {
    return NextResponse.json(generateMockTrial(taskDescription, disputeReason));
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

Tüm metinler Türkçe olsun. Gerçekçi ve profesyonel bir dil kullan.`;

  try {
    const orch = await openaiChatCompletion({
      model: getOpenAiChatModel("judge"),
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
  } catch {
    return NextResponse.json(generateMockTrial(taskDescription, disputeReason));
  }
}

function generateMockTrial(taskDescription: string, disputeReason: string) {
  const isDisputerWins = Math.random() > 0.5;
  return {
    statements: [
      {
        speaker: "poster_lawyer",
        text: `Sayın Hakim, müvekkilim "${taskDescription}" başlıklı görev için belirli kriterler belirlemiştir. Sunulan çıktı bu kriterlerin önemli bir bölümünü karşılamamaktadır. ${disputeReason || "Beklenen kalite standardına ulaşılamamıştır."}`,
      },
      {
        speaker: "openclaw_lawyer",
        text: "Sayın Hakim, ajan sistemi verilen görevi belirlenen çerçevede tamamlamış ve kriterleri makul biçimde karşılayan bir çıktı sunmuştur. İtirazdaki noktalar, kriter yorum farkına dayanmaktadır.",
      },
      {
        speaker: "poster_lawyer",
        text: "Ancak Sayın Hakim, sunulan analizin derinliği yetersizdir. Müvekkilim özellikle pratik uygulanabilirlik ve veri doğruluğu konusundaki eksiklikleri belgeleyerek itiraz hakkını kullanmaktadır.",
      },
      {
        speaker: "openclaw_lawyer",
        text: "Ajan tarafı, görevin talep edilen kapsamını ele almış ve değerlendirme sürecinden geçmiştir. İtirazda ileri sürülen eksiklikler, kriter ifadesinin açık olmamasından kaynaklanan yorum farkıdır.",
      },
      {
        speaker: "judge",
        text: `Tarafları dinledim. Her iki argümanı da değerlendirdim. ${isDisputerWins ? "Görevi yayınlayanın argümanlarını daha güçlü buluyorum — kriterlerin karşılanmadığına dair yeterli kanıt mevcuttur." : "Agent sisteminin savunmasını kabul ediyorum — çıktı belirlenen kriterleri makul düzeyde karşılamaktadır."}`,
      },
    ],
    verdict: {
      ruling: isDisputerWins ? "poster_wins" : "openclaw_wins",
      reasoning: isDisputerWins
        ? "Görev kriterleri yeterince karşılanmamıştır. Görev sahibinin itirazı haklı bulunmuştur."
        : "Ajan çıktısı belirlenen kriterleri makul düzeyde karşılamaktadır. İtiraz reddedilmiştir.",
      action: isDisputerWins
        ? "Ödül görev sahibi lehine düzenlenir; stake iade ve kurallar çerçevesinde kapatılır."
        : "Ödül ajan lehine işler; stake kurallara göre dağıtılır.",
    },
  };
}
