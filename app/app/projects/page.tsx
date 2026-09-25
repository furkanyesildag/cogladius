"use client";

import "./projects.css";
import { useState, useEffect, useCallback, useRef, useMemo, createContext, useContext } from "react";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import { spotlight } from "@/components/ui/motion";
import { useWallet } from "@/lib/useWallet";
import { useMessages, useLocale } from "@/lib/i18n";
import { shortenAddress } from "@/lib/constants";
import type {
  Project, OrchestratorBreakdown, AgentSpecialty,
} from "@/lib/types";
import { SPECIALTY_META } from "@/lib/specialtyMeta";

// ── Types ────────────────────────────────────────────────────────────────────

/** The chat route returns the LLM's PLAN block as-is: it names agents by
 *  (often truncated) pubkey and may list technologies. /orchestrate fills `agents`. */
type PlanItem = OrchestratorBreakdown & { agentPubkeys?: string[]; technologies?: string[] };

interface ChatMsg {
  role: "assistant" | "user";
  content: string;
  breakdown?: PlanItem[];
  ts: string;
}

/** Local persistence for NEXUS (modal drafts, sidebar selection, per-project chat cache). */
const NEXUS_LS_PREFIX = "cogladius:nexus:v1";

interface NexusModalDraftStored {
  title: string;
  description: string;
  budget: number;
  deadlineIdx: number;
}

interface NexusChatStored {
  v: 1;
  messages: ChatMsg[];
  pendingBreakdown: PlanItem[] | null;
  editableBreakdown: PlanItem[] | null;
  showPayment: boolean;
}

/** Deadline options for new-project modal (days). Used for draft persistence indexing. */
const DEADLINE_VALUES = [3, 7, 14, 30];

function normalizeNexusPoster(posterPubkey: string) {
  if (!posterPubkey || posterPubkey === "anonymous" || posterPubkey.startsWith("Demo_")) return "anonymous";
  return posterPubkey;
}

function nexusModalDraftKey(poster: string) {
  return `${NEXUS_LS_PREFIX}:modal-draft:${normalizeNexusPoster(poster)}`;
}

function nexusLastProjectKey(poster: string) {
  return `${NEXUS_LS_PREFIX}:last-project:${normalizeNexusPoster(poster)}`;
}

function nexusChatKey(projectId: number) {
  return `${NEXUS_LS_PREFIX}:chat:${projectId}`;
}

function parseModalDraftStored(raw: string | null): NexusModalDraftStored | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<NexusModalDraftStored>;
    if (typeof d.title !== "string" || typeof d.description !== "string") return null;
    if (typeof d.budget !== "number" || !Number.isFinite(d.budget)) return null;
    if (typeof d.deadlineIdx !== "number" || !Number.isFinite(d.deadlineIdx)) return null;
    return {
      title: d.title,
      description: d.description,
      budget: d.budget,
      deadlineIdx: Math.max(0, Math.min(DEADLINE_VALUES.length - 1, Math.floor(d.deadlineIdx))),
    };
  } catch {
    return null;
  }
}

function readNexusChat(projectId: number): NexusChatStored | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(nexusChatKey(projectId));
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<NexusChatStored & { messages?: ChatMsg[] }>;
    const ver = o.v as unknown;
    if (ver !== undefined && ver !== 1) return null;
    if (!Array.isArray(o.messages) || o.messages.length === 0) return null;
    return {
      v: 1,
      messages: o.messages as ChatMsg[],
      pendingBreakdown: Array.isArray(o.pendingBreakdown) ? (o.pendingBreakdown as PlanItem[]) : null,
      editableBreakdown: Array.isArray(o.editableBreakdown) ? (o.editableBreakdown as PlanItem[]) : null,
      showPayment: Boolean(o.showPayment),
    };
  } catch {
    return null;
  }
}

function writeNexusChat(projectId: number, payload: NexusChatStored) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(nexusChatKey(projectId), JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

async function postOrchestratorChatApi(
  projectId: number,
  history: { role: string; content: string }[],
  userMessage: string,
): Promise<{ success: false; error: string } | { success: true; reply: string; breakdown?: PlanItem[] }> {
  const r = await fetch(`/api/projects/${projectId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: history, userMessage }),
  });
  const data = await r.json();
  if (!data.success) return { success: false, error: data.error ?? `HTTP ${r.status}` };
  return { success: true, reply: data.reply as string, breakdown: data.breakdown as PlanItem[] | undefined };
}

// ── Local strings ────────────────────────────────────────────────────────────
// Posting a plan creates ordinary off-chain task entries; it does not sign
// anything or lock XLM. The copy below says exactly that.

const T = {
  en: {
    kicker: "NEXUS · project planner",
    heroTitle: "Split a big project into sub-tasks,",
    heroEm: "then post them to the pool.",
    heroLead: "Describe the project and a total XLM budget. NEXUS, an LLM planner, proposes how to split it across specialties; you adjust the split in chat and approve. Approved sub-tasks are posted to the open task list. Posting does not lock any XLM: fund work through the escrow from the dashboard.",
    steps: [
      { t: "Describe", d: "Title, brief, total budget and a target window." },
      { t: "Plan with NEXUS", d: "It proposes specialties and a % split. Ask for changes in chat." },
      { t: "Adjust", d: "Fine-tune the split with − / + before you approve." },
      { t: "Post to the pool", d: "Sub-tasks appear in the open task list, not escrowed, for any agent." },
    ],
    start: "Start a new project",
    newProject: "New project",
    turkishNote: "NEXUS currently replies in Turkish.",
    myProjects: "My projects",
    allProjects: "All projects",
    allProjectsHint: "Connect a wallet to see only yours.",
    noProjects: "No projects yet.",
    status: { draft: "Draft", analyzing: "Analyzing", squadFormed: "Plan ready", active: "Posted", completed: "Completed" } as Record<string, string>,
    budget: "Total budget",
    deadline: "Target",
    you: "You",
    thinking: "NEXUS is thinking…",
    plan: "Proposed split",
    ofBudget: (x: number) => `of ${x} XLM`,
    suggested: "Suggested agents",
    suggestedHint: "Suggestions only. Nobody is assigned: any agent can take a sub-task from the pool.",
    won: (n: number) => `${n} won on-chain`,
    noWins: "no on-chain wins yet",
    decrease: "Decrease share",
    increase: "Increase share",
    approve: "Post sub-tasks to the pool",
    placeholder: "Write to NEXUS… change the split, the budget, or ask for the plan",
    send: "Send",
    confirmTitle: "Post sub-tasks to the open pool",
    confirmBody: (n: number, x: number) => `This adds ${n} sub-task${n === 1 ? "" : "s"} (${x} XLM in listed rewards) to the open task list with a 24-hour deadline.`,
    confirmNotLocked: "Not escrowed. Nothing is signed and no XLM leaves your wallet or is locked, so agents see these as unfunded tasks.",
    confirmFund: "To fund work, use “Post task” on the dashboard: it locks the reward in the Soroban escrow as a new task.",
    cancel: "Back",
    posting: "Posting…",
    confirm: "Post to the pool",
    postedTitle: "Sub-tasks posted to the open pool",
    postedBody: "They are listed without escrow; no XLM is locked. To fund a sub-task, post it as an escrowed task from the dashboard.",
    postedTask: (id: number) => `Task #${id}`,
    notEscrowed: "not escrowed",
    toDashboard: "Open dashboard",
    toTasks: "View open tasks",
    modalSteps: "Brief · Plan · Post",
    modalInfo: "Next, NEXUS reads the brief and proposes a split across specialties. Nothing is posted until you approve, and posting does not lock XLM.",
    modalCta: "Next: work out the split with NEXUS. Nothing is paid or locked.",
    close: "Close",
    genericError: "Something went wrong.",
  },
  tr: {
    kicker: "NEXUS · proje planlayıcı",
    heroTitle: "Büyük bir projeyi alt görevlere böl,",
    heroEm: "sonra havuza gönder.",
    heroLead: "Projeyi ve toplam XLM bütçesini anlat. Bir LLM planlayıcı olan NEXUS, işi uzmanlık alanlarına nasıl böleceğini önerir; dağılımı sohbette ayarlar ve onaylarsın. Onaylanan alt görevler açık görev listesine eklenir. Bu adım XLM kilitlemez: işi escrow ile fonlamak için panelden görev yayınla.",
    steps: [
      { t: "Anlat", d: "Başlık, açıklama, toplam bütçe ve hedef süre." },
      { t: "NEXUS ile planla", d: "Uzmanlık alanlarını ve yüzde dağılımını önerir. Değişiklikleri sohbette iste." },
      { t: "Ayarla", d: "Onaylamadan önce dağılımı − / + ile ince ayarla." },
      { t: "Havuza gönder", d: "Alt görevler açık görev listesinde escrow'suz olarak her ajana görünür." },
    ],
    start: "Yeni proje başlat",
    newProject: "Yeni proje",
    turkishNote: "NEXUS şu an Türkçe yanıt veriyor.",
    myProjects: "Projelerim",
    allProjects: "Tüm projeler",
    allProjectsHint: "Yalnızca kendi projelerini görmek için cüzdan bağla.",
    noProjects: "Henüz proje yok.",
    status: { draft: "Taslak", analyzing: "Analiz", squadFormed: "Plan hazır", active: "Gönderildi", completed: "Tamamlandı" } as Record<string, string>,
    budget: "Toplam bütçe",
    deadline: "Hedef",
    you: "Sen",
    thinking: "NEXUS düşünüyor…",
    plan: "Önerilen dağılım",
    ofBudget: (x: number) => `/ ${x} XLM`,
    suggested: "Önerilen ajanlar",
    suggestedHint: "Yalnızca öneri. Kimse atanmaz: havuzdaki alt görevi herhangi bir ajan alabilir.",
    won: (n: number) => `zincirde ${n} kazanım`,
    noWins: "henüz zincirde kazanım yok",
    decrease: "Payı azalt",
    increase: "Payı artır",
    approve: "Alt görevleri havuza gönder",
    placeholder: "NEXUS'a yaz… dağılımı ya da bütçeyi değiştir, planı iste",
    send: "Gönder",
    confirmTitle: "Alt görevleri açık havuza gönder",
    confirmBody: (n: number, x: number) => `Açık görev listesine ${n} alt görev (${x} XLM ilan edilen ödül) 24 saatlik süreyle eklenir.`,
    confirmNotLocked: "Escrow yok. Hiçbir şey imzalanmaz, cüzdanından XLM çıkmaz ve kilitlenmez; ajanlar bunları fonlanmamış görev olarak görür.",
    confirmFund: "İşi fonlamak için paneldeki “Görev yayınla”yı kullan: ödülü yeni bir görev olarak Soroban escrow'una kilitler.",
    cancel: "Geri",
    posting: "Gönderiliyor…",
    confirm: "Havuza gönder",
    postedTitle: "Alt görevler açık havuza gönderildi",
    postedBody: "Escrow olmadan listelendiler; XLM kilitlenmedi. Bir alt görevi fonlamak için panelden escrow'lu görev olarak yayınla.",
    postedTask: (id: number) => `Görev #${id}`,
    notEscrowed: "escrow yok",
    toDashboard: "Paneli aç",
    toTasks: "Açık görevler",
    modalSteps: "Açıklama · Plan · Gönder",
    modalInfo: "Sonra NEXUS açıklamayı okur ve uzmanlık alanlarına bir dağılım önerir. Sen onaylamadan hiçbir şey gönderilmez; göndermek de XLM kilitlemez.",
    modalCta: "Sıradaki adım: dağılımı NEXUS ile netleştir. Hiçbir ödeme ya da kilit yok.",
    close: "Kapat",
    genericError: "Bir şeyler ters gitti.",
  },
};
type Strings = (typeof T)["en"];

const SPECIALTY_LABEL: Record<"en" | "tr", Record<AgentSpecialty, string>> = {
  en: { frontend: "Frontend", backend: "Backend", blockchain: "Blockchain", design: "Design", ai_ml: "AI / ML", data: "Data", devops: "DevOps", finance: "Finance", content: "Content", research: "Research", mobile: "Mobile", security: "Security" },
  tr: { frontend: "Frontend", backend: "Backend", blockchain: "Blockchain", design: "Tasarım", ai_ml: "AI / ML", data: "Veri", devops: "DevOps", finance: "Finans", content: "İçerik", research: "Araştırma", mobile: "Mobil", security: "Güvenlik" },
};

// ── Agent directory (names + on-chain wins) for suggestions ─────────────────

type DirAgent = { pubkey: string; name: string; stellarAddress?: string; isOnline?: boolean };
type Directory = { agents: DirAgent[]; wins: Map<string, number> };
const DirectoryCtx = createContext<Directory>({ agents: [], wins: new Map() });
const StringsCtx = createContext<{ t: Strings; lang: "en" | "tr" }>({ t: T.en, lang: "en" });

function useDirectory(): Directory {
  const [dir, setDir] = useState<Directory>({ agents: [], wins: new Map() });
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/agents/list").then((r) => r.json()).catch(() => null),
      fetch("/api/reputation").then((r) => r.json()).catch(() => null),
    ]).then(([list, rep]) => {
      if (!alive) return;
      const agents: DirAgent[] = Array.isArray(list?.agents) ? list.agents : [];
      const wins = new Map<string, number>();
      if (rep?.success && Array.isArray(rep.agents)) for (const a of rep.agents) wins.set(a.agent, a.tasksWon);
      setDir({ agents, wins });
    });
    return () => { alive = false; };
  }, []);
  return dir;
}

/** Resolve the plan's agent references to registered agents. The LLM only sees
 *  8-character pubkey prefixes, so accept an unambiguous prefix of 6+ chars. */
function resolveSuggested(item: PlanItem, dir: Directory): DirAgent[] {
  const refs = [
    ...((item.agents ?? []).map((a) => a.pubkey)),
    ...(item.agentPubkeys ?? []),
  ];
  const out: DirAgent[] = [];
  for (const raw of refs) {
    const ref = String(raw).trim().replace(/[.…]+$/, "");
    if (ref.length < 6) continue;
    const hits = dir.agents.filter((a) => a.pubkey === ref || a.pubkey.startsWith(ref));
    const hit = hits.length === 1 ? hits[0] : hits.find((a) => a.pubkey === ref);
    if (hit && !out.some((o) => o.pubkey === hit.pubkey)) out.push(hit);
    if (out.length >= 3) break;
  }
  return out;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function pad(n: number) { return String(n).padStart(2, "0"); }
function nowStr() { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
const round4 = (x: number) => parseFloat(x.toFixed(4));

const STATUS_COLOR: Record<string, string> = {
  draft: "var(--text-muted)",
  analyzing: "#FFD166",
  squadFormed: "#7C9EFF",
  active: "var(--green)",
  completed: "#B97DFF",
};

function StatusBadge({ status }: { status: Project["status"] }) {
  const { t } = useContext(StringsCtx);
  return (
    <span className="nx-status" style={{ ["--c" as string]: STATUS_COLOR[status] ?? "var(--text-muted)" }}>
      {t.status[status] ?? status}
    </span>
  );
}

/** Move one specialty's share by `delta` points and rebalance the rest so the total stays 100. */
function rebalance(list: PlanItem[], idx: number, delta: number, totalBudget: number): PlanItem[] {
  if (list.length < 2) return list;
  const next = list.map((b) => ({ ...b }));
  const others = next.map((_, i) => i).filter((i) => i !== idx);
  const target = Math.max(5, Math.min(100 - others.length * 5, next[idx].workloadPct + delta));
  if (target === next[idx].workloadPct) return list;
  const remaining = 100 - target;
  const otherSum = others.reduce((s, i) => s + next[i].workloadPct, 0) || 1;
  for (const i of others) next[i].workloadPct = Math.max(5, Math.round((next[i].workloadPct / otherSum) * remaining));
  let diff = remaining - others.reduce((s, i) => s + next[i].workloadPct, 0);
  for (const i of [...others].sort((a, b) => next[b].workloadPct - next[a].workloadPct)) {
    if (!diff) break;
    const v = Math.max(5, next[i].workloadPct + diff);
    diff -= v - next[i].workloadPct;
    next[i].workloadPct = v;
  }
  next[idx].workloadPct = target;
  for (const b of next) b.budgetUsdc = round4((totalBudget * b.workloadPct) / 100);
  return next;
}

// ── Markdown-lite renderer ──────────────────────────────────────────────────
function RenderLine({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**")
          ? <strong key={i}>{p.replace(/\*\*/g, "")}</strong>
          : <span key={i}>{p}</span>
      )}
    </>
  );
}

function AgentMessageBody({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="nx-md">
      {text.split("\n").map((line, i) => {
        if (!line.trim()) return <div key={i} className="nx-md-gap" />;
        if (/^#{1,3}\s/.test(line)) {
          const lvl = (line.match(/^#+/) ?? [""])[0].length;
          return <div key={i} className={lvl === 1 ? "nx-md-h1" : "nx-md-h2"}><RenderLine text={line.replace(/^#+\s/, "")} /></div>;
        }
        if (/^[═─━-]{3,}$/.test(line.trim())) return <div key={i} className="nx-md-rule" />;
        const listM = line.match(/^\s*([•\-\*]|\d+\.)\s+(.*)/);
        if (listM) {
          const isNum = /^\d/.test(listM[1]);
          return (
            <div key={i} className="nx-md-li">
              <span className="nx-md-bullet">{isNum ? listM[1] : "•"}</span>
              <span><RenderLine text={listM[2]} /></span>
            </div>
          );
        }
        return <p key={i}><RenderLine text={line} /></p>;
      })}
    </div>
  );
}

// ── NEXUS avatar (gradient ring spins while thinking) ───────────────────────
function NexusAvatar({ thinking, size = 34 }: { thinking?: boolean; size?: number }) {
  return (
    <span className={thinking ? "nx-avatar is-thinking" : "nx-avatar"} style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }} aria-hidden>
      <span className="nx-avatar-core">
        <span className="material-symbols-outlined">hub</span>
      </span>
    </span>
  );
}

// ── Breakdown card ──────────────────────────────────────────────────────────
function BreakdownCard({
  breakdown, totalBudget, editable, onChange,
}: {
  breakdown: PlanItem[];
  totalBudget: number;
  editable?: boolean;
  onChange?: (b: PlanItem[]) => void;
}) {
  const { t, lang } = useContext(StringsCtx);
  const dir = useContext(DirectoryCtx);
  const items = breakdown.filter((b) => SPECIALTY_META[b.specialty as AgentSpecialty]);
  const canEdit = !!editable && !!onChange && items.length > 1;

  return (
    <div className="nx-plan">
      <div className="nx-plan-head">
        <span className="material-symbols-outlined" aria-hidden>donut_small</span>
        <span className="nx-plan-title">{t.plan}</span>
        <span className="nx-plan-total">{t.ofBudget(totalBudget)}</span>
      </div>

      {/* Stacked allocation bar */}
      <div className="nx-stack" role="img" aria-label={items.map((b) => `${SPECIALTY_LABEL[lang][b.specialty]} ${b.workloadPct}%`).join(", ")}>
        {items.map((b, i) => (
          <span key={b.specialty} style={{ width: `${b.workloadPct}%`, background: SPECIALTY_META[b.specialty].color, animationDelay: `${i * 90}ms` }} />
        ))}
      </div>

      <div className="nx-plan-rows">
        {items.map((b, i) => {
          const meta = SPECIALTY_META[b.specialty];
          const suggested = resolveSuggested(b, dir);
          return (
            <div key={b.specialty} className="nx-row" style={{ ["--c" as string]: meta.color, ["--i" as string]: i }}>
              <div className="nx-row-top">
                <span className="nx-row-icon material-symbols-outlined" aria-hidden>{meta.icon}</span>
                <span className="nx-row-name">{SPECIALTY_LABEL[lang][b.specialty] ?? meta.label}</span>
                <span className="nx-row-xlm">{Number(b.budgetUsdc).toFixed(3)} <small>XLM</small></span>
              </div>
              <div className="nx-row-bar">
                <div className="nx-bar"><span className="nx-bar-fill" style={{ width: `${b.workloadPct}%`, animationDelay: `${160 + i * 90}ms` }} /></div>
                {canEdit ? (
                  <div className="nx-stepper">
                    <button type="button" onClick={() => onChange!(rebalance(breakdown, breakdown.indexOf(b), -5, totalBudget))} aria-label={t.decrease}>−</button>
                    <span>{b.workloadPct}%</span>
                    <button type="button" onClick={() => onChange!(rebalance(breakdown, breakdown.indexOf(b), 5, totalBudget))} aria-label={t.increase}>+</button>
                  </div>
                ) : (
                  <span className="nx-pct">{b.workloadPct}%</span>
                )}
              </div>
              {b.reasoning && <p className="nx-row-why">{b.reasoning}</p>}
              {Array.isArray(b.technologies) && b.technologies.length > 0 && (
                <div className="nx-tags">
                  {b.technologies.map((tech) => <span key={tech}>{tech}</span>)}
                </div>
              )}
              {suggested.length > 0 && (
                <div className="nx-sugg" title={t.suggestedHint}>
                  <span className="nx-sugg-label">{t.suggested}</span>
                  {suggested.map((a) => {
                    const wins = dir.wins.get(a.stellarAddress ?? a.pubkey) ?? dir.wins.get(a.pubkey) ?? 0;
                    return (
                      <Link key={a.pubkey} href={`/agent/${a.pubkey}`} className="nx-sugg-chip">
                        <span className="nx-sugg-dot" />
                        {a.name || shortenAddress(a.pubkey, 4)}
                        <small>{wins > 0 ? t.won(wins) : t.noWins}</small>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {items.some((b) => resolveSuggested(b, dir).length > 0) && <p className="nx-plan-foot">{t.suggestedHint}</p>}
    </div>
  );
}

// ── Confirm (post to pool) modal ─────────────────────────────────────────────
function ConfirmPostModal({
  breakdown, totalBudget, onConfirm, onCancel, loading, error,
}: {
  breakdown: PlanItem[];
  totalBudget: number;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
  error: string | null;
}) {
  const { t } = useContext(StringsCtx);
  const listed = round4(breakdown.reduce((s, b) => s + Number(b.budgetUsdc || 0), 0));
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="nx-confirm" role="dialog" aria-modal="true" aria-labelledby="nx-confirm-title" onClick={(e) => e.stopPropagation()}>
        <div className="nx-confirm-head">
          <span className="nx-confirm-icon material-symbols-outlined" aria-hidden>outbox</span>
          <h2 id="nx-confirm-title">{t.confirmTitle}</h2>
        </div>
        <p className="nx-confirm-p">{t.confirmBody(breakdown.length, listed || totalBudget)}</p>
        <div className="nx-note is-warn">
          <span className="material-symbols-outlined" aria-hidden>lock_open</span>
          <span>{t.confirmNotLocked}</span>
        </div>
        <p className="nx-confirm-p nx-muted">{t.confirmFund}</p>
        <BreakdownCard breakdown={breakdown} totalBudget={totalBudget} />
        {error && <div className="nx-error"><span className="material-symbols-outlined" aria-hidden>warning</span>{error}</div>}
        <div className="nx-confirm-actions">
          <button type="button" onClick={onCancel} className="btn-ghost">{t.cancel}</button>
          <button type="button" onClick={onConfirm} disabled={loading} className="btn-primary">
            <span className={loading ? "material-symbols-outlined nx-spin" : "material-symbols-outlined"} aria-hidden>{loading ? "sync" : "send"}</span>
            {loading ? t.posting : t.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PostProjectModal ──────────────────────────────────────────────────────────

function PostProjectModal({
  onClose, onCreated, posterPubkey,
}: {
  onClose: () => void;
  onCreated: (project: Project) => void;
  posterPubkey: string;
}) {
  const m = useMessages();
  const n = m.nexusSection;
  const { t } = useContext(StringsCtx);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [budget, setBudget] = useState(1.0);
  const [deadlineIdx, setDeadlineIdx] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; desc?: string }>({});
  const [draftHydrated, setDraftHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDraftHydrated(false);
    try {
      const d = parseModalDraftStored(localStorage.getItem(nexusModalDraftKey(posterPubkey)));
      if (d) {
        setTitle(d.title);
        setDescription(d.description);
        setBudget(Number.isFinite(d.budget) && d.budget >= 0.01 ? d.budget : 1);
        setDeadlineIdx(Math.max(0, Math.min(DEADLINE_VALUES.length - 1, d.deadlineIdx)));
      }
    } catch {
      /* ignore */
    }
    const id = window.setTimeout(() => {
      if (!cancelled) setDraftHydrated(true);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [posterPubkey]);

  useEffect(() => {
    if (!draftHydrated) return;
    const timer = window.setTimeout(() => {
      try {
        if (!title.trim() && !description.trim()) {
          localStorage.removeItem(nexusModalDraftKey(posterPubkey));
          return;
        }
        const payload: NexusModalDraftStored = { title, description, budget, deadlineIdx };
        localStorage.setItem(nexusModalDraftKey(posterPubkey), JSON.stringify(payload));
      } catch {
        /* ignore */
      }
    }, 380);
    return () => window.clearTimeout(timer);
  }, [draftHydrated, posterPubkey, title, description, budget, deadlineIdx]);

  const deadlineDays = DEADLINE_VALUES[deadlineIdx];

  function clearTitleErr() {
    setFieldErrors((f) => {
      if (!f.title) return f;
      const { title: _omit, ...r } = f;
      return r;
    });
  }
  function clearDescErr() {
    setFieldErrors((f) => {
      if (!f.desc) return f;
      const { desc: _omit, ...r } = f;
      return r;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const nextErr: { title?: string; desc?: string } = {};
    if (title.trim().length < 3) nextErr.title = n.modalValidationTitle;
    if (description.trim().length < 20) nextErr.desc = n.modalValidationDesc;
    if (Object.keys(nextErr).length > 0) {
      setFieldErrors(nextErr);
      return;
    }
    setFieldErrors({});

    setLoading(true);
    try {
      const r = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poster: posterPubkey, title, description, totalBudgetUsdc: budget, deadlineDays }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      try { localStorage.removeItem(nexusModalDraftKey(posterPubkey)); } catch { /* ignore */ }
      onCreated(d.project);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const descWarn = description.length > 1600;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="nexus-modal-shell nx-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="nexus-modal-title" aria-modal="true">

        <header className="nexus-modal-header">
          <div className="nx-modal-headrow">
            <div className="nx-modal-brand">
              <NexusAvatar size={44} />
              <div>
                <h2 id="nexus-modal-title">{n.modalTitle}</h2>
                <div className="nx-modal-sub">
                  <span>NEXUS</span>
                  <i />
                  <span>{t.modalSteps}</span>
                </div>
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label={t.close} className="nx-icon-btn">
              <span className="material-symbols-outlined" aria-hidden>close</span>
            </button>
          </div>
        </header>

        <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column" }}>
          <div className="nx-modal-body">

            <div className="nexus-modal-section-label">
              <span className="nexus-modal-step">1</span>
              {n.modalSectionBrief}
            </div>

            <div style={{ marginBottom: 18 }}>
              <label className="nexus-modal-field-label" htmlFor="nexus-proj-title">{n.modalTitleLabel}</label>
              <div className={`nexus-modal-input-wrap ${fieldErrors.title ? "nexus-modal-input-error" : ""}`}>
                <input
                  id="nexus-proj-title"
                  type="text"
                  value={title}
                  onChange={(e) => { setTitle(e.target.value); clearTitleErr(); }}
                  placeholder={n.modalTitlePlaceholder}
                  maxLength={100}
                  autoFocus
                  style={{ fontSize: 14, fontWeight: 600, padding: "12px 14px" }}
                />
              </div>
              {fieldErrors.title && (
                <p className="nx-field-err"><span className="material-symbols-outlined" aria-hidden>error</span>{fieldErrors.title}</p>
              )}
            </div>

            <div style={{ marginBottom: 22 }}>
              <label className="nexus-modal-field-label" htmlFor="nexus-proj-desc">{n.modalDescLabel}</label>
              <div className={`nexus-modal-input-wrap ${fieldErrors.desc ? "nexus-modal-input-error" : ""}`} style={{ position: "relative" }}>
                <span className={`nexus-modal-char-pill ${descWarn ? "nexus-modal-char-pill_warn" : ""}`}>
                  {description.length}/2000
                </span>
                <textarea
                  id="nexus-proj-desc"
                  value={description}
                  onChange={(e) => { setDescription(e.target.value); clearDescErr(); }}
                  placeholder={n.modalDescPlaceholder}
                  maxLength={2000}
                  style={{ minHeight: 168, padding: "14px 14px 40px", fontFamily: "var(--font-body)", fontSize: 14, lineHeight: 1.7 }}
                />
              </div>
              <p className="nx-help">{n.modalDescHelper}</p>
              {fieldErrors.desc && (
                <p className="nx-field-err"><span className="material-symbols-outlined" aria-hidden>error</span>{fieldErrors.desc}</p>
              )}
            </div>

            <div className="nexus-modal-section-label" style={{ marginTop: 4 }}>
              <span className="nexus-modal-step">2</span>
              {n.modalSectionParams}
            </div>

            <div className="nexus-params-card">
              <div>
                <label className="nexus-modal-field-label" htmlFor="nexus-budget" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14, color: "var(--accent)" }} aria-hidden>account_balance_wallet</span>
                  {n.modalBudgetLabel}
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    id="nexus-budget"
                    type="number"
                    value={Number.isFinite(budget) ? budget : 0}
                    onChange={(e) => setBudget(parseFloat(e.target.value) || 0)}
                    min={0.01}
                    max={1000}
                    step={0.1}
                    style={{ fontFamily: "var(--font-head)", fontSize: 24, fontWeight: 700, color: "var(--accent)", padding: "12px 46px 12px 14px", borderRadius: 12 }}
                  />
                  <span className="nx-unit">XLM</span>
                </div>
                <p className="nx-help">{n.modalBudgetSub}</p>
              </div>

              <div>
                <label className="nexus-modal-field-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14, color: "var(--accent)" }} aria-hidden>schedule</span>
                  {n.modalDurationLabel}
                </label>
                <div className="nexus-duration-row" role="group" aria-label={n.modalDurationLabel}>
                  {DEADLINE_VALUES.map((v, idx) => (
                    <button
                      key={v}
                      type="button"
                      data-active={deadlineIdx === idx}
                      className="nexus-duration-pill"
                      onClick={() => setDeadlineIdx(idx)}
                    >
                      {n.modalDeadlines[idx]}
                    </button>
                  ))}
                </div>
                <p className="nx-help">{n.modalDurationSub}</p>
              </div>
            </div>

            <div className="nx-note" style={{ marginTop: 18 }}>
              <span className="material-symbols-outlined" aria-hidden>info</span>
              <span>{t.modalInfo}</span>
            </div>

            {error && <div className="nx-error"><span className="material-symbols-outlined" aria-hidden>warning</span>{error}</div>}
          </div>

          <div className="nexus-modal-footer">
            <p className="nx-help" style={{ textAlign: "center", margin: "0 0 12px" }}>{t.modalCta}</p>
            <button type="submit" disabled={loading} className="nexus-modal-submit">
              <span className={loading ? "material-symbols-outlined nx-spin" : "material-symbols-outlined"} style={{ fontSize: 17 }} aria-hidden>{loading ? "sync" : "arrow_forward"}</span>
              {loading ? n.modalLoading : n.modalSubmit}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Orchestrator Chat Panel ───────────────────────────────────────────────────
function OrchestratorChat({
  project, onPlanConfirmed,
}: {
  project: Project;
  onPlanConfirmed: (updated: Project) => void;
}) {
  const { t } = useContext(StringsCtx);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingBreakdown, setPendingBreakdown] = useState<PlanItem[] | null>(null);
  const [editableBreakdown, setEditableBreakdown] = useState<PlanItem[] | null>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [paying, setPaying] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chatBootDone, setChatBootDone] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  // Restore cached transcript or bootstrap first orchestrator reply.
  useEffect(() => {
    let cancelled = false;
    setChatBootDone(false);

    async function run() {
      try {
        const stored = readNexusChat(project.id);
        if (!cancelled && stored?.messages.length) {
          setMessages(stored.messages);
          setPendingBreakdown(stored.pendingBreakdown);
          setEditableBreakdown(stored.editableBreakdown);
          setShowPayment(stored.showPayment);
          return;
        }

        if (cancelled) return;

        setSending(true);
        setError(null);

        const data = await postOrchestratorChatApi(project.id, [], "");
        if (cancelled) return;

        if (!data.success) {
          setError(data.error || t.genericError);
          return;
        }

        const assistantMsg: ChatMsg = {
          role: "assistant",
          content: data.reply,
          breakdown: data.breakdown ?? undefined,
          ts: nowStr(),
        };
        setMessages([assistantMsg]);
        if (data.breakdown) {
          setPendingBreakdown(data.breakdown);
          setEditableBreakdown(data.breakdown.map((b) => ({ ...b })));
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) {
          setSending(false);
          setInput("");
          setChatBootDone(true);
        }
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  useEffect(() => {
    if (!chatBootDone) return;
    writeNexusChat(project.id, {
      v: 1,
      messages,
      pendingBreakdown,
      editableBreakdown,
      showPayment,
    });
  }, [chatBootDone, project.id, messages, pendingBreakdown, editableBreakdown, showPayment]);

  async function sendMessage(userMsg: string) {
    setSending(true);
    setError(null);

    const newMessages = [...messages, { role: "user" as const, content: userMsg, ts: nowStr() }];
    setMessages(newMessages);
    setInput("");

    const history = newMessages.map((m) => ({ role: m.role, content: m.content }));

    try {
      const data = await postOrchestratorChatApi(project.id, history, userMsg);

      if (!data.success) {
        setError(data.error || t.genericError);
        return;
      }

      const assistantMsg: ChatMsg = {
        role: "assistant",
        content: data.reply,
        breakdown: data.breakdown ?? undefined,
        ts: nowStr(),
      };

      setMessages((prev) => [...prev, assistantMsg]);

      if (data.breakdown) {
        setPendingBreakdown(data.breakdown);
        setEditableBreakdown(data.breakdown.map((b) => ({ ...b })));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  async function handlePaymentConfirm() {
    if (!editableBreakdown) return;
    setPaying(true);
    setConfirmError(null);
    try {
      const r = await fetch(`/api/projects/${project.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ breakdown: editableBreakdown }),
      });
      const d = await r.json();
      if (!d.success) { setConfirmError(d.error || t.genericError); return; }
      onPlanConfirmed(d.project);
      setShowPayment(false);
    } catch (e: unknown) {
      setConfirmError(e instanceof Error ? e.message : String(e));
    } finally { setPaying(false); }
  }

  const isActive = project.status === "active" || project.status === "completed";
  const lastPlanIdx = messages.reduce((acc, m, i) => (m.role === "assistant" && m.breakdown ? i : acc), -1);
  const posted = project.subTasks.filter((st) => typeof st.taskId === "number");
  const canSend = !!input.trim() && chatBootDone && !sending;

  return (
    <div className="nx-chat">
      <div className="nx-chat-scroll" ref={scrollRef}>
        {messages.map((msg, i) => {
          const isAgent = msg.role === "assistant";
          const isLatestPlan = i === lastPlanIdx;
          return (
            <div key={i} className={isAgent ? "nx-msg is-agent" : "nx-msg is-user"}>
              {isAgent && <NexusAvatar />}
              <div className="nx-msg-col">
                <div className="nx-msg-meta">{isAgent ? "NEXUS" : t.you} · {msg.ts}</div>
                <div className="nx-bubble">
                  {isAgent ? <AgentMessageBody text={msg.content} /> : <span className="nx-user-text">{msg.content}</span>}
                </div>
                {isAgent && msg.breakdown && (
                  <BreakdownCard
                    breakdown={isLatestPlan && editableBreakdown ? editableBreakdown : msg.breakdown}
                    totalBudget={project.totalBudgetUsdc}
                    editable={isLatestPlan && !isActive}
                    onChange={isLatestPlan && !isActive ? setEditableBreakdown : undefined}
                  />
                )}
                {isAgent && isLatestPlan && !isActive && i === messages.length - 1 && (
                  <button type="button" onClick={() => { setConfirmError(null); setShowPayment(true); }} className="btn-primary nx-approve">
                    <span className="material-symbols-outlined" aria-hidden>outbox</span>
                    {t.approve}
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {sending && (
          <div className="nx-msg is-agent" aria-live="polite">
            <NexusAvatar thinking />
            <div className="nx-msg-col">
              <div className="nx-msg-meta">NEXUS</div>
              <div className="nx-bubble nx-typing" aria-label={t.thinking}>
                <span /><span /><span />
                <em>{t.thinking}</em>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="nx-error"><span className="material-symbols-outlined" aria-hidden>warning</span>{error}</div>
        )}

        {isActive && (
          <div className="nx-posted">
            <div className="nx-posted-head">
              <span className="material-symbols-outlined" aria-hidden>task_alt</span>
              <strong>{t.postedTitle}</strong>
            </div>
            <p>{t.postedBody}</p>
            {posted.length > 0 && (
              <div className="nx-posted-list">
                {posted.map((st) => (
                  <Link key={st.id} href={`/task/${st.taskId}`} className="nx-posted-item" style={{ ["--c" as string]: SPECIALTY_META[st.specialty]?.color ?? "var(--accent)" }}>
                    <span className="nx-sugg-dot" />
                    {t.postedTask(st.taskId as number)}
                    <small>{Number(st.budgetUsdc).toFixed(3)} XLM · {t.notEscrowed}</small>
                  </Link>
                ))}
              </div>
            )}
            <div className="nx-posted-actions">
              <Link href="/dashboard" className="btn-primary">{t.toDashboard} →</Link>
              <Link href="/tasks" className="btn-ghost">{t.toTasks}</Link>
            </div>
          </div>
        )}
      </div>

      {!isActive && (
        <form className="nx-composer" onSubmit={(e) => { e.preventDefault(); if (canSend) void sendMessage(input.trim()); }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (canSend) void sendMessage(input.trim()); } }}
            placeholder={t.placeholder}
            rows={2}
            disabled={sending || !chatBootDone}
            aria-label={t.placeholder}
          />
          <button type="submit" disabled={!canSend} className="nx-send" aria-label={t.send}>
            <span className="material-symbols-outlined" aria-hidden>arrow_upward</span>
          </button>
        </form>
      )}

      {showPayment && editableBreakdown && (
        <ConfirmPostModal
          breakdown={editableBreakdown}
          totalBudget={project.totalBudgetUsdc}
          onConfirm={handlePaymentConfirm}
          onCancel={() => setShowPayment(false)}
          loading={paying}
          error={confirmError}
        />
      )}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
const STEP_STYLE = [
  { c: "#B97DFF", icon: "edit_note" },
  { c: "var(--accent)", icon: "hub" },
  { c: "#7C9EFF", icon: "tune" },
  { c: "var(--green)", icon: "outbox" },
];

function EmptyState({ onNew }: { onNew: () => void }) {
  const { t, lang } = useContext(StringsCtx);
  return (
    <div className="nx-empty">
      <div className="nx-empty-glow" aria-hidden />
      <div className="nx-empty-inner">
        <div className="ui-reveal"><NexusAvatar size={64} thinking /></div>
        <span className="ui-kicker ui-reveal" style={{ ["--i" as string]: 1 }}>{t.kicker}</span>
        <h1 className="ui-h1 ui-reveal" style={{ ["--i" as string]: 2 }}>{t.heroTitle}<br /><em>{t.heroEm}</em></h1>
        <p className="ui-lead ui-reveal" style={{ ["--i" as string]: 3 }}>{t.heroLead}</p>

        <ol className="nx-flow">
          {t.steps.map((s, i) => (
            <li key={s.t} className="ui-card ui-card-hover nx-flow-card ui-reveal" onMouseMove={(e) => spotlight(e as unknown as React.MouseEvent<HTMLDivElement>)} style={{ ["--c" as string]: STEP_STYLE[i].c, ["--i" as string]: 4 + i }}>
              <div className="nx-flow-top">
                <span className="nx-flow-icon material-symbols-outlined" aria-hidden>{STEP_STYLE[i].icon}</span>
                <span className="nx-flow-n">0{i + 1}</span>
              </div>
              <div className="nx-flow-title">{s.t}</div>
              <div className="nx-flow-desc">{s.d}</div>
            </li>
          ))}
        </ol>

        <div className="nx-empty-cta ui-reveal" style={{ ["--i" as string]: 8 }}>
          <button type="button" onClick={onNew} className="btn-primary nx-cta">
            <span className="material-symbols-outlined" aria-hidden>add</span>
            {t.start}
          </button>
          {lang === "en" && <span className="ui-mono ui-muted">{t.turkishNote}</span>}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ProjectsPage() {
  const { publicKey } = useWallet();
  const { locale } = useLocale();
  const lang: "en" | "tr" = locale === "tr" ? "tr" : "en";
  const t = T[lang];
  const strings = useMemo(() => ({ t, lang }), [t, lang]);
  const directory = useDirectory();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [mounted, setMounted] = useState(false);
  const lastHandledPosterRef = useRef<string | undefined>(undefined);

  useEffect(() => { setMounted(true); }, []);

  const loadProjects = useCallback(async () => {
    const url = publicKey ? `/api/projects?poster=${publicKey.toString()}` : "/api/projects";
    try {
      const r = await fetch(url);
      const d = await r.json();
      if (d.success) setProjects(d.projects);
    } catch { /* keep the current list */ }
  }, [publicKey]);

  useEffect(() => { if (mounted) loadProjects(); }, [mounted, loadProjects]);

  useEffect(() => {
    lastHandledPosterRef.current = undefined;
  }, [publicKey]);

  useEffect(() => {
    if (!mounted || !publicKey || projects.length === 0) return;
    const pk = publicKey.toString();
    if (lastHandledPosterRef.current === pk) return;
    lastHandledPosterRef.current = pk;

    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(nexusLastProjectKey(pk)) : null;
      const id = raw ? parseInt(raw, 10) : NaN;
      if (Number.isFinite(id) && projects.some((p) => p.id === id)) setSelectedId(id);
    } catch {
      /* ignore */
    }
  }, [mounted, publicKey, projects]);

  const selectedProject = projects.find((p) => p.id === selectedId) ?? null;

  function selectProject(id: number | null) {
    setSelectedId(id);
    if (id !== null && typeof window !== "undefined" && publicKey) {
      try {
        localStorage.setItem(nexusLastProjectKey(publicKey.toString()), String(id));
      } catch {
        /* ignore */
      }
    }
  }

  function handleCreated(project: Project) {
    setProjects((prev) => [project, ...prev.filter((p) => p.id !== project.id)]);
    setShowModal(false);
    selectProject(project.id);
  }

  function handlePlanConfirmed(updated: Project) {
    setProjects((prev) => prev.map((p) => p.id === updated.id ? updated : p));
  }

  const dateFmt = (unix: number) => new Date(unix * 1000).toLocaleDateString(lang === "tr" ? "tr-TR" : "en-US", { day: "numeric", month: "short", year: "numeric" });

  return (
    <StringsCtx.Provider value={strings}>
      <DirectoryCtx.Provider value={directory}>
        <div className="nx-root">
          <SiteHeader />

          <div className={selectedProject ? "nx-shell has-sel" : "nx-shell"}>
            {/* ── PROJECT LIST ───────────────────────────────────── */}
            <aside className="nx-side">
              <button type="button" onClick={() => setShowModal(true)} className="btn-primary nx-side-new">
                <span className="material-symbols-outlined" aria-hidden>add</span>
                {t.newProject}
              </button>
              <div className="nx-side-label">
                <span className="ui-label">{publicKey ? t.myProjects : t.allProjects}</span>
                <span className="ui-label">{projects.length}</span>
              </div>
              {!publicKey && projects.length > 0 && <p className="nx-side-hint">{t.allProjectsHint}</p>}
              <div className="nx-side-list">
                {projects.length === 0 ? (
                  <div className="nx-side-empty">{t.noProjects}</div>
                ) : (
                  projects.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => selectProject(p.id)}
                      className={selectedId === p.id ? "nx-proj is-active" : "nx-proj"}
                      aria-current={selectedId === p.id ? "true" : undefined}
                    >
                      <div className="nx-proj-top">
                        <StatusBadge status={p.status} />
                        <span className="nx-proj-id">#{p.id}</span>
                      </div>
                      <div className="nx-proj-title">{p.title}</div>
                      <div className="nx-proj-foot">
                        <span className="nx-proj-xlm">{p.totalBudgetUsdc.toFixed(2)} XLM</span>
                        {p.subTasks.length > 0 && (
                          <span className="nx-proj-dots">
                            {p.subTasks.slice(0, 6).map((st) => <i key={st.id} style={{ background: SPECIALTY_META[st.specialty]?.color ?? "var(--bg-border)" }} title={SPECIALTY_LABEL[lang][st.specialty]} />)}
                          </span>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </aside>

            {/* ── MAIN ───────────────────────────────────────────── */}
            <main className="nx-main">
              {selectedProject ? (
                <>
                  <div className="nx-proj-head">
                    <button type="button" className="nx-icon-btn nx-back" onClick={() => selectProject(null)} aria-label={t.cancel}>
                      <span className="material-symbols-outlined" aria-hidden>arrow_back</span>
                    </button>
                    <div className="nx-proj-head-main">
                      <div className="nx-proj-head-title">
                        <h2>{selectedProject.title}</h2>
                        <StatusBadge status={selectedProject.status} />
                      </div>
                      <p>{selectedProject.description}</p>
                    </div>
                    <div className="nx-proj-head-stats">
                      <div>
                        <div className="nx-stat-num">{selectedProject.totalBudgetUsdc.toFixed(2)} <small>XLM</small></div>
                        <div className="ui-label">{t.budget}</div>
                      </div>
                      {selectedProject.deadline > 0 && (
                        <div>
                          <div className="nx-stat-date">{dateFmt(selectedProject.deadline)}</div>
                          <div className="ui-label">{t.deadline}</div>
                        </div>
                      )}
                    </div>
                  </div>

                  <OrchestratorChat
                    key={selectedProject.id}
                    project={selectedProject}
                    onPlanConfirmed={handlePlanConfirmed}
                  />
                </>
              ) : (
                <EmptyState onNew={() => setShowModal(true)} />
              )}
            </main>
          </div>

          {showModal && mounted && (
            <PostProjectModal
              onClose={() => setShowModal(false)}
              onCreated={handleCreated}
              posterPubkey={publicKey?.toString() ?? "anonymous"}
            />
          )}
        </div>
      </DirectoryCtx.Provider>
    </StringsCtx.Provider>
  );
}
