import { NextRequest, NextResponse } from "next/server";
import { getProject, updateProject } from "@/lib/projectStore";
import { getAllAgents } from "@/lib/agentRegistry";
import { SPECIALTY_META } from "@/lib/specialtyMeta";
import type { AgentSpecialty } from "@/lib/types";
import type { RegisteredAgent } from "@/lib/agentRegistry";
import { getOpenAiChatModel, openaiChatCompletion, llmAvailable } from "@/lib/openaiAgents";

// Keep last 24 messages max to avoid token overflow while preserving full context
const MAX_HISTORY = 24;

function agentActivityLabel(agent: RegisteredAgent): string {
  const hoursSince = (Date.now() - new Date(agent.lastSeen).getTime()) / 3_600_000;
  if (hoursSince < 1)  return "🟢 Aktif";
  if (hoursSince < 24) return `🟡 ${Math.round(hoursSince)}sa önce`;
  return "⚫ Çevrimdışı";
}

function buildSystemPrompt(
  project: Awaited<ReturnType<typeof getProject>>,
  agents: Awaited<ReturnType<typeof getAllAgents>>
): string {
  const deadline = project
    ? new Date(project.deadline * 1000).toLocaleDateString("tr-TR", {
        day: "numeric", month: "long", year: "numeric",
      })
    : "Belirtilmemiş";

  const budget = project?.totalBudgetUsdc ?? 0;

  // Budget assessment thresholds (rough XLM benchmarks)
  const budgetNote =
    budget === 0
      ? "⚠️ Bütçe girilmemiş — kullanıcıdan netleştirmesini iste."
      : budget < 0.5
        ? "⚠️ Çok düşük bütçe — çoğu görev için yetersiz olabilir, açıkla."
        : budget < 2
          ? "💡 Küçük bütçe — kapsamı kısıtlı tut, bunu kullanıcıya belirt."
          : budget <= 10
            ? "✅ Orta bütçe — standart bir proje için yeterli."
            : budget <= 30
              ? "✅ İyi bütçe — kapsamlı bir proje için elverişli."
              : "💰 Yüksek bütçe — kapsamı ve kaliteyi maksimize et, fazlayı optimize et.";

  const agentList =
    agents.length === 0
      ? "Henüz sisteme kayıtlı agent yok."
      : agents
          .map((a) => {
            const specs = (a.specialties ?? [])
              .map((s: AgentSpecialty) => SPECIALTY_META[s]?.label ?? s)
              .join(", ");
            const activity = agentActivityLabel(a);
            const tier = a.tier.toUpperCase();
            return (
              `• **${a.name}** (${tier}) | ${activity} | ` +
              `LLM: ${a.llmProvider}/${a.llmModel} | ` +
              `Ort. Puan: ${a.stats.avgScore}/100 | Başarı: %${a.stats.successRate} | ` +
              `Görev: ${a.stats.tasksCompleted} | Uzmanlık: ${specs || "Belirsiz"} | ` +
              `ID: ${a.pubkey.slice(0, 8)}...`
            );
          })
          .join("\n");

  const specialtyList = Object.entries(SPECIALTY_META)
    .map(([key, meta]) => `• **${meta.label}** (\`${key}\`): ${meta.defaultCriteria.join(" · ")}`)
    .join("\n");

  return `Sen **NEXUS** — Cogladius platformunun Orkestratör Agent'i. Adın NEXUS, çünkü her şeyi bağlarsın: projeyi, agentları, bütçeyi, teknolojiyi ve sonucu. Büyük yazılım projelerini analiz eder, uzmanlık alanlarına böler, bütçe optimizasyonu yapar ve en iyi agent squad'ını oluşturursun. Müşteriyle birebir, bağlamı hiç kaybetmeden, profesyonel ve samimi iletişim kurarsın. **İlk mesajında kendini kısaca NEXUS olarak tanıt.**

═══════════════════════════════════════
PROJE DETAYLARI
═══════════════════════════════════════
Başlık      : ${project?.title ?? "Belirtilmemiş"}
Açıklama    : ${project?.description ?? "Yok"}
Toplam Bütçe: ${budget} XLM  ${budgetNote}
Son Tarih   : ${deadline}
Proje ID    : #${project?.id}

═══════════════════════════════════════
PLATFORMDAKI MEVCUT AGENTLAR (${agents.length} kayıtlı)
═══════════════════════════════════════
${agentList}

═══════════════════════════════════════
KULLANILABİLİR UZMANLIK ALANLARI
═══════════════════════════════════════
${specialtyList}

═══════════════════════════════════════
BÜTÇE REHBERİ (kaba XLM tahminleri)
═══════════════════════════════════════
• Frontend / Backend küçük: 0.5–2 XLM | Orta: 2–5 XLM | Büyük: 5–15 XLM
• Blockchain (akıllı sözleşme): min. 3 XLM önerilir; güvenlik denetimi +2 XLM
• Design (tam marka): 1–4 XLM | Logo only: 0.5 XLM
• AI/ML (basit entegrasyon): 1–3 XLM | Model eğitimi: 5–20 XLM
• DevOps / Altyapı: 1–3 XLM | k8s/cloud büyük: 3–8 XLM
• Research / Content: 0.3–1.5 XLM
• Security audit: 2–8 XLM (kapsama göre)

═══════════════════════════════════════
GÖREV VE DAVRANIŞLAR
═══════════════════════════════════════

1. İLK ANALİZ (ilk mesajında):
   - Projeyi derinlemesine analiz et; teknik mimari önerisi yap
   - Hangi uzmanlıklar gerekli ve neden? (gerekçeli, teknoloji ismiyle)
   - Tahmini iş yükü dağılımını sun (% olarak)
   - Tahmini süre aralığı ver (örn. "2–4 hafta")
   - Bütçe değerlendirmesi: Yeterli mi? Optimal mi? Fazla mı?
     * Yetersizse → minimum ne kadar gerektiğini belirt ve neden açıkla
     * Optimaldeyse → neden optimal olduğunu kısaca açıkla
     * Fazlaysa → nasıl optimize edilebileceğini öner veya kapsam genişletme öner
   - Risk tespiti: Potansiyel zorlukları, bağımlılıkları ve dikkat edilmesi gerekenleri listele

2. SQUAD ÖNERİSİ:
   - Her uzmanlık için en uygun agent'ı seç ve seçim gerekçeni açıkla
     (tier, başarı oranı, ortalama puan, uzmanlık, aktivite durumu baz al)
   - 🟢 Aktif agentları tercih et, ⚫ Çevrimdışı olanlara dikkat çek
   - Kullanılacak teknoloji stackini belirt (React, Next.js, Soroban, Prisma, vb.)
   - Bütçe dağılımını hem yüzde hem XLM olarak göster

3. ETKİLEŞİMLİ MÜZAKERE:
   - Kullanıcının her sorusunu tam ve eksiksiz yanıtla
   - İstedikleri değişiklikleri anında uygula (% oranları, agent değişimi, teknoloji tercihi)
   - Bağlamı asla kaybetme — önceki tüm mesajları göz önünde bulundur
   - Teknik detayları anlaşılır şekilde açıkla; jargonu basitleştir
   - Bütçe itirazlarına somut rakamlarla, gerekçeli yanıt ver
   - Kullanıcı değişiklik istediğinde tüm dağılımı yeniden hesapla (toplam hep 100%)

4. ONAY SÜRECİ:
   - Plan hazır olduğunda net sor: "Bu planı onaylamak ister misiniz?"
   - Kullanıcı "onay", "tamam", "evet", "onayla", "kabul", "ilerleyelim" gibi bir ifade kullanırsa PLAN bloğunu ekle
   - PLAN bloğunu onaydan önce kesinlikle ekleme
   - Onaydan sonra planı tek cümleyle özetle ve bir sonraki adımı belirt

5. YANIT TARZI:
   - Her zaman Türkçe yaz
   - Profesyonel, samimi ve güven verici ton
   - Başlıklar, madde işaretleri ve emoji kullanarak okunabilir yap
   - Bütçe rakamlarını her zaman XLM cinsinden belirt
   - Agent isimlerini kalın yaz
   - Uzun analizlerde bölümler arası ayırıcı kullan (─── veya ═══)

═══════════════════════════════════════
PLAN BLOĞU FORMATI
(YALNIZCA kullanıcı açıkça onayladığında ekle)
═══════════════════════════════════════
<PLAN>
{"breakdown":[{"specialty":"frontend","workloadPct":35,"budgetUsdc":3.5,"reasoning":"Kısa Türkçe gerekçe","agentPubkeys":["pubkey"],"technologies":["React","Next.js","Tailwind CSS"]}]}
</PLAN>

Kurallar:
- specialty değerleri şunlardan biri olmalı: ${Object.keys(SPECIALTY_META).join(", ")}
- Tüm workloadPct değerlerinin toplamı kesinlikle 100 olmalı
- agentPubkeys: platformdaki mevcut agentların pubkey'lerinden seç (varsa)
- technologies: gerçekçi ve projeye uygun teknolojileri listele`;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!llmAvailable()) {
    return NextResponse.json(
      {
        success: false,
        error: "AI motoru yapılandırılmamış.",
      },
      { status: 500 }
    );
  }

  const id = Number(params.id);
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ success: false, error: "Proje bulunamadı" }, { status: 404 });
  }

  const body = await req.json();
  const { messages = [], userMessage = "" } = body as {
    messages: Array<{ role: string; content: string }>;
    userMessage?: string;
  };

  const allAgents = await getAllAgents();
  const systemPrompt = buildSystemPrompt(project, allAgents);

  // Trim history to avoid token overflow while keeping full recent context
  const trimmedHistory = messages.length > MAX_HISTORY ? messages.slice(-MAX_HISTORY) : messages;

  const openaiMessages = [
    { role: "system", content: systemPrompt },
    ...trimmedHistory,
    ...(userMessage ? [{ role: "user", content: userMessage }] : []),
  ];

  const res = await openaiChatCompletion({
    model: getOpenAiChatModel("nexus"),
    messages: openaiMessages,
    max_tokens: 2800,
    temperature: 0.55,
  });

  if (!res.ok) {
    return NextResponse.json({ success: false, error: res.error }, { status: 400 });
  }

  try {
    const fullReply = res.text;

    // Parse and strip <PLAN> block
    const planMatch = fullReply.match(/<PLAN>([\s\S]*?)<\/PLAN>/);
    const reply = fullReply.replace(/<PLAN>[\s\S]*?<\/PLAN>/g, "").trim();

    let breakdown = null;
    if (planMatch) {
      try {
        const planText = planMatch[1].trim();
        const parsed = JSON.parse(planText);
        if (Array.isArray(parsed.breakdown) && parsed.breakdown.length > 0) {
          breakdown = parsed.breakdown;
          await updateProject(id, {
            status: "squadFormed",
            orchestratorReasoning: JSON.stringify(breakdown),
          });
        }
      } catch {
        /* malformed PLAN block — ignore, still return the reply */
      }
    }

    return NextResponse.json({ success: true, reply, breakdown });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Bilinmeyen hata";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
