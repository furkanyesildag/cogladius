import { NextRequest, NextResponse } from "next/server";
import { getOpenAiChatModel, openaiChatCompletion, resolveOpenAiApiKey } from "@/lib/openaiAgents";

export const dynamic = "force-dynamic";

function buildWorkerSystemPrompt(agentName: string, forceJson: boolean): string {
  const n = agentName.toLowerCase();
  const beta = n.includes("beta");
  const alpha = !beta && n.includes("alpha");

  const persona = beta
    ? `Personalite: Agent-Beta — düşünme derinliği öncelikli, daha uzun analiz yazabilirsin; gerektiğinde numaralı alt başlıklar ve ara özet kullan.
Üretim kalite hedefi yüksek; hız için yüzeyselleşme yapma—yine de gereksiz tekrardan kaçın.`
    : alpha
      ? `Personalite: Agent-Alpha — hızlı ama doğru çıktı: önce kısa bağlam/harita, sonra maddeli sonuç; boş slogan yerine öz cümleler.`
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
    agentName = "agent-alpha",
    taskId,
    forceJson = false,
    systemExtra,
  } = body;

  if (!resolveOpenAiApiKey()) {
    return NextResponse.json({
      result: generateMockResult(taskDescription, criteria, agentName),
      isMock: true,
      apiError:
        "OPENAI_API_KEY bulunamadı veya geçersiz (`sk-`). Kök `.env`, `app/.env.local` veya Vercel ortamına ekleyip yeniden başlat.",
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
      result: generateMockResult(taskDescription, criteria, agentName),
      isMock: true,
      apiError: `OpenAI API hatası: ${orch.error}`,
    });
  }

  return NextResponse.json({ result: orch.text, isMock: false });
}

/**
 * Gerçek AI çıktısı üretemediğimizde kullanılır.
 * Görev açıklamasındaki anahtar kelimeleri analiz ederek
 * en azından konuyla alakalı bir yapı oluşturur.
 */
function generateMockResult(taskDescription: string, _criteria: string, agentName: string): string {
  const desc = taskDescription.toLowerCase();
  const sections: string[] = [];

  // Konu tespiti
  const isCrypto = /blockchain|stellar|defi|nft|token|kripto|crypto|web3|l2|layer/.test(desc);
  const isAI = /ai|agent|yapay zeka|gpt|model|llm/.test(desc);
  const isAnalysis = /analiz|analys|karşılaştır|compare|risk|değerlendir|hype|trend/.test(desc);
  const isList = /listele|liste|söyle|ver|hangi|ne var|neler/.test(desc);

  sections.push(`**Görev:** ${taskDescription}\n`);

  if (isCrypto && isAnalysis) {
    sections.push(`**Analiz:**

2026 itibarıyla blockchain ekosistemindeki öne çıkan gelişmeler şunlardır:

1. **AI × Blockchain entegrasyonu** — On-chain AI agent'lar (örn. OpenClaw modeli) hız kazandı; görev marketplace'leri ve otonom ekonomik aktörler yaygınlaştı.

2. **Real World Assets (RWA) tokenizasyonu** — Gayrimenkul, tahvil ve emtia tokenizasyonu kurumsal benimsemenin itici gücü haline geldi; TVL 500 milyar doları aştı.

3. **Modüler blockchain mimarileri** — Stellar, Celestia ve Ethereum L2'leri (Arbitrum, Base) arasındaki rekabet; TPS rekorları ve gas maliyetleri tartışmaların merkezinde.

4. **zk-Proof tabanlı gizlilik katmanları** — ZK-rollup'ların kurumsal DeFi'de zorunlu altyapıya dönüşmesi.

5. **Merkezi olmayan fiziksel altyapı (DePIN)** — IoT cihazları ve ağ kaynaklarının tokenize edilmesi; Helium ve benzer projelerin yükselişi.`);
  } else if (isAI) {
    sections.push(`**Analiz:**

AI alanında 2026'da öne çıkan temalar:

1. **Otonom AI Agent'lar** — Tek bir görevi değil, iş akışlarının tamamını yöneten multi-agent sistemler.
2. **Multimodal modeller** — Metin, görsel, ses ve kod üreten tek bir model paradigması.
3. **Edge AI** — Bulut bağımlılığı azalan, cihaz üzerinde çalışan küçük ama güçlü modeller.
4. **AI güvenliği ve uyum** — Regülasyon baskısıyla artan explainability gereksinimleri.`);
  } else if (isList) {
    sections.push(`**Sonuç Listesi:**

"${taskDescription}" sorusuna yanıt olarak tespit edilenler:

• Konu ile doğrudan ilgili birincil bulgular incelenmiştir.
• Mevcut veriler ve araştırma kaynakları taranmıştır.
• Pratik ve uygulanabilir çıktılar belirlenmiştir.

⚠️ Not: Bu yanıt OpenAI API bağlanamadığı için otomatik oluşturulmuştur. Gerçek analiz için API key'i kontrol edin.`);
  } else {
    sections.push(`**Sonuç:**

"${taskDescription}" görevi analiz edilmiştir. Konu kapsamında mevcut bilgi tabanı taranmış, kriterler değerlendirilmiştir.

⚠️ Not: Bu yanıt OpenAI API bağlanamadığı için otomatik oluşturulmuştur.`);
  }

  sections.push(`\n— ${agentName} · ${new Date().toLocaleTimeString("tr-TR")} (mock mod — OpenAI bağlantısı yok)`);
  return sections.join("\n");
}
