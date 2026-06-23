/**
 * Orkestratör — Projeyi analiz eder, specialty'lere böler,
 * en iyi agentları eşleştirir ve squad oluşturur.
 */

import type {
  AgentSpecialty,
  OrchestratorBreakdown,
  OrchestratorResult,
  AgentMatch,
} from "./types";
import type { RegisteredAgent } from "./agentRegistry";
import { getAllAgents } from "./agentRegistry";
import { createTask } from "./taskStore";
import { setSubTasks, setSubTaskTaskId, updateProject } from "./projectStore";
export { SPECIALTY_META } from "./specialtyMeta";
import { SPECIALTY_META } from "./specialtyMeta";
import { getOpenAiChatModel, openaiChatCompletion } from "./openaiAgents";

const VALID_SPECIALTIES = new Set(Object.keys(SPECIALTY_META) as AgentSpecialty[]);
const SPECIALTIES_LIST = Object.keys(SPECIALTY_META).join(", ");

// ── Agent scoring ──────────────────────────────────────────────────────────────

function scoreAgent(agent: RegisteredAgent, budgetUsdc: number): number {
  if (agent.approvalStatus !== "approved") return -1;

  const rewardOk =
    budgetUsdc >= agent.config.minRewardUsdc && budgetUsdc <= agent.config.maxRewardUsdc;
  if (!rewardOk) return -1;

  const { successRate, avgScore, tasksCompleted } = agent.stats;

  // Elite/Pro tier bonus
  const tierMult = agent.tier === "elite" ? 1.30 : agent.tier === "pro" ? 1.15 : 1.0;

  // Recency: agents seen in the last 2h get a significant boost
  const hoursSince = (Date.now() - new Date(agent.lastSeen).getTime()) / 3_600_000;
  const recencyBonus = hoursSince < 2 ? 0.08 : hoursSince < 24 ? 0.03 : 0;

  // Personality match: "thorough" agents score slightly better for quality
  const personalityBonus = agent.config.personality === "thorough" ? 0.02 : 0;

  const base =
    (successRate / 100) * 0.40 +
    (avgScore / 100) * 0.35 +
    Math.min(tasksCompleted / 100, 1.0) * 0.25;

  return Math.min(base * tierMult + recencyBonus + personalityBonus, 1.0);
}

// ── Specialty validation ───────────────────────────────────────────────────────

function toValidSpecialty(s: string): AgentSpecialty | null {
  return VALID_SPECIALTIES.has(s as AgentSpecialty) ? (s as AgentSpecialty) : null;
}

// ── Budget normalization ───────────────────────────────────────────────────────

function normalizeBreakdown(
  items: Array<{ workloadPct: number; budgetUsdc: number }>,
  totalBudget: number
): void {
  if (items.length === 0) return;

  // Ensure each item has at least 1%
  const pcts = items.map((b) => Math.max(1, Math.round(b.workloadPct)));
  const sum = pcts.reduce((s, p) => s + p, 0);

  if (sum !== 100) {
    // Distribute the delta to the largest bucket
    const maxIdx = pcts.reduce((mi, p, i) => (p > pcts[mi] ? i : mi), 0);
    pcts[maxIdx] = Math.max(1, pcts[maxIdx] + (100 - sum));
  }

  items.forEach((b, i) => {
    b.workloadPct = pcts[i];
    b.budgetUsdc = parseFloat(((totalBudget * pcts[i]) / 100).toFixed(4));
  });
}

// ── Agent matching ─────────────────────────────────────────────────────────────

function toAgentMatch(agent: RegisteredAgent, score: number): AgentMatch {
  return {
    pubkey: agent.pubkey,
    name: agent.name,
    score: parseFloat(score.toFixed(3)),
    avgScore: agent.stats.avgScore,
    successRate: agent.stats.successRate,
    tasksCompleted: agent.stats.tasksCompleted,
    specialties: agent.specialties ?? [],
  };
}

function matchAgentsForSpecialty(
  specialty: AgentSpecialty,
  budgetUsdc: number,
  allAgents: RegisteredAgent[],
  assignedPubkeys: Set<string>
): AgentMatch[] {
  const scoredPool = allAgents
    .filter((a) => !a.isBanned && (a.specialties ?? []).includes(specialty))
    .map((a) => ({ agent: a, score: scoreAgent(a, budgetUsdc) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score);

  // If no specialty match, fall back to any eligible agent
  const pool =
    scoredPool.length > 0
      ? scoredPool
      : allAgents
          .filter((a) => !a.isBanned)
          .map((a) => ({ agent: a, score: scoreAgent(a, budgetUsdc) }))
          .filter(({ score }) => score >= 0)
          .sort((a, b) => b.score - a.score);

  // Prefer agents not yet assigned to another specialty (diversity)
  const preferred = pool.filter(({ agent }) => !assignedPubkeys.has(agent.pubkey));
  const fallback = pool.filter(({ agent }) => assignedPubkeys.has(agent.pubkey));

  const result: Array<{ agent: RegisteredAgent; score: number }> = [];
  for (const item of [...preferred, ...fallback]) {
    if (result.length >= 3) break;
    result.push(item);
  }

  return result.map(({ agent, score }) => toAgentMatch(agent, score));
}

// ── Sub-task description builder ───────────────────────────────────────────────

const SPECIALTY_FOCUS: Record<AgentSpecialty, string> = {
  frontend:   "Kullanıcı arayüzü ve komponent geliştirme",
  backend:    "API, veritabanı ve sunucu tarafı geliştirme",
  blockchain: "Akıllı sözleşme ve on-chain entegrasyon",
  design:     "Görsel kimlik, UI/UX ve wireframe tasarımı",
  ai_ml:      "Yapay zeka modeli ve ML pipeline geliştirme",
  data:       "Veri analizi, pipeline ve görselleştirme",
  devops:     "CI/CD, deployment ve altyapı yönetimi",
  finance:    "Finansal modelleme ve token ekonomisi",
  content:    "İçerik üretimi, SEO ve pazarlama",
  research:   "Piyasa araştırması ve rekabet analizi",
  mobile:     "Mobil uygulama geliştirme",
  security:   "Güvenlik denetimi ve zafiyet analizi",
};

function buildSubTaskDescription(specialty: AgentSpecialty, projectDescription: string): string {
  const meta = SPECIALTY_META[specialty];
  return `[${meta.label}] ${SPECIALTY_FOCUS[specialty]}: ${projectDescription}`;
}

// ── Keyword-based fallback analyzer ───────────────────────────────────────────

function keywordAnalyze(description: string, totalBudget: number): OrchestratorBreakdown[] {
  const lower = description.toLowerCase();
  const hits: Record<AgentSpecialty, number> = {} as Record<AgentSpecialty, number>;

  for (const [spec, meta] of Object.entries(SPECIALTY_META) as [AgentSpecialty, typeof SPECIALTY_META[AgentSpecialty]][]) {
    hits[spec] = meta.keywords.filter((kw) => lower.includes(kw)).length;
  }

  let active = (Object.entries(hits) as [AgentSpecialty, number][]).filter(([, n]) => n > 0);
  if (active.length === 0) {
    active = (Object.entries(hits) as [AgentSpecialty, number][])
      .sort(([, a], [, b]) => b - a)
      .slice(0, 2);
  }

  const totalHits = active.reduce((s, [, n]) => s + Math.max(n, 1), 0);
  const breakdowns: OrchestratorBreakdown[] = active.map(([spec, n]) => ({
    specialty: spec,
    workloadPct: Math.round((Math.max(n, 1) / totalHits) * 100),
    budgetUsdc: 0,
    reasoning: `"${spec}" anahtar kelime eşleşmesi: ${Math.max(n, 1)} uyuşma`,
    agents: [],
  }));

  normalizeBreakdown(breakdowns, totalBudget);
  return breakdowns;
}

// ── LLM-based analyzer ────────────────────────────────────────────────────────

async function llmAnalyze(description: string, totalBudget: number): Promise<OrchestratorBreakdown[] | null> {
  try {
    const prompt = `Sen kıdemli bir teknik proje mimarısın. Aşağıdaki projeyi analiz et ve her uzmanlık alanının tahmini iş yükü payını belirle.

Proje: "${description}"
Toplam Bütçe: ${totalBudget} USDC

Kullanılabilir uzmanlık alanları (YALNIZCA bu değerleri kullan): ${SPECIALTIES_LIST}

SADECE geçerli JSON döndür; markdown veya kod çiti yok.

Format:
{"breakdown":[{"specialty":"<alan>","workloadPct":35,"reasoning":"<kısa Türkçe gerekçe>"}]}

Kurallar:
- workloadPct değerleri toplamı TAM OLARAK 100 olmalı (tam sayılar)
- Yalnızca proje için gerçekten gerekli alanları dahil et (2-5 arası)
- Her specialty değeri listeden biri olmalı
- Gerekçe kısa ama bilgilendirici olsun (neden bu pay?)`;

    const res = await openaiChatCompletion({
      model: getOpenAiChatModel("nexus"),
      messages: [
        {
          role: "system",
          content: "Sen bir proje analiz motorusun. Yanıtın yalnızca tek bir JSON objesi olmalı; başka metin yazma.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 1000,
      temperature: 0.20,
      response_format: { type: "json_object" },
    });

    if (!res.ok) {
      console.warn("[orchestrator] LLM analiz hatası:", res.error);
      return null;
    }

    const jsonMatch = res.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.breakdown || !Array.isArray(parsed.breakdown)) return null;

    const validated = (parsed.breakdown as Array<{ specialty: string; workloadPct: number; reasoning: string }>)
      .filter((b) => toValidSpecialty(b.specialty) !== null)
      .map((b) => ({
        specialty: b.specialty as AgentSpecialty,
        workloadPct: Math.max(1, Math.round(b.workloadPct)),
        budgetUsdc: 0,
        reasoning: b.reasoning || `${b.specialty} bileşeni`,
        agents: [] as AgentMatch[],
      }));

    if (validated.length === 0) return null;

    normalizeBreakdown(validated, totalBudget);
    return validated;
  } catch {
    return null;
  }
}

// ── Main orchestration ─────────────────────────────────────────────────────────

export async function analyzeProject(
  projectId: number,
  description: string,
  totalBudget: number
): Promise<OrchestratorResult> {
  await updateProject(projectId, { status: "analyzing" });

  // 1. Analyze (LLM first, keyword fallback)
  let breakdown = await llmAnalyze(description, totalBudget);
  if (!breakdown || breakdown.length === 0) {
    breakdown = keywordAnalyze(description, totalBudget);
  }

  // 2. Match agents with diversity tracking (top assigned agent per specialty is reserved)
  const allAgents = await getAllAgents();
  const assignedPubkeys = new Set<string>();

  const withAgents = breakdown.map((b) => {
    const agents = matchAgentsForSpecialty(b.specialty, b.budgetUsdc, allAgents, assignedPubkeys);
    if (agents[0]) assignedPubkeys.add(agents[0].pubkey);
    return { ...b, agents };
  });

  // 3. Weighted confidence: each specialty weighted by its workload share
  const totalWeight = withAgents.reduce((s, b) => s + b.workloadPct, 0) || 1;
  const totalConfidence = parseFloat(
    withAgents
      .reduce((s, b) => {
        const w = b.workloadPct / totalWeight;
        return s + (b.agents[0]?.score ?? 0.4) * w;
      }, 0)
      .toFixed(3)
  );

  // 4. Save sub-tasks
  const subTasks = withAgents.map((b, i) => ({
    id: i + 1,
    projectId,
    specialty: b.specialty,
    description: buildSubTaskDescription(b.specialty, description),
    criteria: SPECIALTY_META[b.specialty].defaultCriteria.join(", "),
    budgetUsdc: b.budgetUsdc,
    recommendedAgents: b.agents.map((a) => a.pubkey),
    confidence: parseFloat((b.agents[0]?.score ?? 0.4).toFixed(3)),
    status: "pending" as const,
  }));

  await setSubTasks(projectId, subTasks);
  await updateProject(projectId, {
    status: "squadFormed",
    orchestratorReasoning: JSON.stringify(
      withAgents.map((b) => ({
        specialty: b.specialty,
        workloadPct: b.workloadPct,
        budgetUsdc: b.budgetUsdc,
        reasoning: b.reasoning,
      }))
    ),
  });

  return { projectId, breakdown: withAgents, totalConfidence };
}

// ── Confirm & post sub-tasks to pool ──────────────────────────────────────────

export async function postSubTasksToPool(
  projectId: number,
  breakdown: OrchestratorBreakdown[],
  poster: string
): Promise<void> {
  for (let i = 0; i < breakdown.length; i++) {
    const b = breakdown[i];
    const meta = SPECIALTY_META[b.specialty];

    const task = await createTask({
      poster,
      description: buildSubTaskDescription(b.specialty, b.reasoning),
      criteria: meta.defaultCriteria.join(", "),
      rewardUsdc: b.budgetUsdc,
      deadlineMinutes: 1440,
      taskType: SPECIALTY_TASK_TYPE[b.specialty],
      outputFormat: SPECIALTY_OUTPUT_FORMAT[b.specialty],
    });

    await setSubTaskTaskId(projectId, i + 1, task.id);
  }

  await updateProject(projectId, { status: "active" });
}

const SPECIALTY_TASK_TYPE: Record<AgentSpecialty, import("./types").TaskType> = {
  frontend: "code", backend: "code", blockchain: "code",
  design: "custom", ai_ml: "code", data: "data",
  devops: "web", finance: "research", content: "custom",
  research: "research", mobile: "code", security: "research",
};

const SPECIALTY_OUTPUT_FORMAT: Record<AgentSpecialty, import("./types").OutputFormat> = {
  frontend: "code", backend: "code", blockchain: "code",
  design: "url", ai_ml: "code", data: "json",
  devops: "url", finance: "report", content: "text",
  research: "report", mobile: "code", security: "report",
};
