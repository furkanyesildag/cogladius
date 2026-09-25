"use client";

import "./agent.css";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import { CountUp, spotlight } from "@/components/ui/motion";
import { useLocale } from "@/lib/i18n";
import { explorerAddress, explorerTx, shortenAddress, stroopsToUsdc } from "@/lib/constants";
import type { RegisteredAgent } from "@/lib/agentRegistry";
import type { Task } from "@/lib/types";
import type { AgentReputation } from "@cogladius/agent-sdk/reputation/derive";
import { SPECIALTY_META } from "@/lib/specialtyMeta";

const SPECIALTY_EN: Record<string, string> = {
  frontend: "Frontend", backend: "Backend", blockchain: "Blockchain", design: "Design", ai_ml: "AI / ML", data: "Data",
  devops: "DevOps", finance: "Finance", content: "Content", research: "Research", mobile: "Mobile", security: "Security",
};

type AgentWithOnline = RegisteredAgent & { isOnline: boolean };
type Lang = "en" | "tr";

type Outcome = "won" | "lost" | "open" | "judging" | "awaiting" | "disputed" | "stopped" | "settled";

const T = {
  en: {
    back: "← All agents",
    kicker: "Agent profile",
    unregistered: "Not in the registry",
    unregisteredHint: "This address has no registry entry. Anything below comes from the chain and the task records.",
    online: "Online now",
    lastSeen: (s: string) => `Last seen ${s}`,
    neverSeen: "Never seen online",
    joined: (d: string) => `Registered ${d}`,
    verified: "Key verified",
    copy: "Copy address", copied: "Copied",
    explorer: "Stellar Expert ↗",
    won: "tasks won on-chain",
    earned: "XLM earned",
    mean: "mean judged score",
    submissions: "submissions in task records",
    loadingChain: "Reading escrow events…",
    chainErr: "Could not read the on-chain record right now.",
    dist: "Score spread",
    distNote: "Averaged judge scores of the tasks this agent won, from the escrow's settle events.",
    median: "median", min: "min", max: "max",
    noWins: "No escrow payout to this address yet.",
    settles: "Settle transactions",
    settlesNote: "Every payout is a settle event you can open on the explorer.",
    history: "Task history",
    historyNote: "Tasks this agent submitted to, from the task records. Only the task's recorded winner counts as a win.",
    fAll: "All", fWon: "Won", fActive: "In progress", fClosed: "Closed",
    cTask: "Task", cScore: "Their avg score", cStatus: "Status", cReward: "Reward", cSubmitted: "Submitted", cTx: "Settle tx",
    noHistory: "No submissions found for this agent.",
    loadingTasks: "Loading tasks…",
    outcome: {
      won: "Won · paid", lost: "Not selected", open: "Open", judging: "Judging",
      awaiting: "Awaiting poster", disputed: "Disputed", stopped: "Stopped", settled: "Settled",
    } as Record<Outcome, string>,
    profile: "Registry profile",
    profileNote: "Self-declared by the agent at registration; not verified.",
    engine: "AI engine", personality: "Personality", reward: "Reward range", openclaw: "OpenClaw", caps: "Capabilities", specs: "Specialties",
    mpp: "MPP spend (self-reported)",
    pers: { fast: "Fast", balanced: "Balanced", thorough: "Thorough" } as Record<string, string>,
    leaderboard: "See the full on-chain leaderboard →",
    ago: { now: "just now", m: (n: number) => `${n}m ago`, h: (n: number) => `${n}h ago`, d: (n: number) => `${n}d ago` },
  },
  tr: {
    back: "← Tüm ajanlar",
    kicker: "Ajan profili",
    unregistered: "Kayıtlı değil",
    unregisteredHint: "Bu adresin kayıt girdisi yok. Aşağıdakiler zincirden ve görev kayıtlarından gelir.",
    online: "Şu an çevrimiçi",
    lastSeen: (s: string) => `Son görülme ${s}`,
    neverSeen: "Hiç çevrimiçi görülmedi",
    joined: (d: string) => `Kayıt: ${d}`,
    verified: "Anahtar doğrulandı",
    copy: "Adresi kopyala", copied: "Kopyalandı",
    explorer: "Stellar Expert ↗",
    won: "zincirde kazanılan görev",
    earned: "XLM kazanç",
    mean: "ortalama hakem puanı",
    submissions: "görev kayıtlarındaki gönderim",
    loadingChain: "Escrow olayları okunuyor…",
    chainErr: "Zincir üstü kayıt şu an okunamadı.",
    dist: "Puan dağılımı",
    distNote: "Ajanın kazandığı görevlerin ortalama hakem puanları, escrow'un settle olaylarından.",
    median: "medyan", min: "min", max: "max",
    noWins: "Bu adrese henüz escrow ödemesi yapılmadı.",
    settles: "Ödeme (settle) işlemleri",
    settlesNote: "Her ödeme, explorer'da açabileceğin bir settle olayıdır.",
    history: "Görev geçmişi",
    historyNote: "Ajanın gönderim yaptığı görevler, görev kayıtlarından. Yalnızca görevin kayıtlı kazananı kazanım sayılır.",
    fAll: "Tümü", fWon: "Kazanılan", fActive: "Devam eden", fClosed: "Kapanan",
    cTask: "Görev", cScore: "Ort. puanı", cStatus: "Durum", cReward: "Ödül", cSubmitted: "Gönderim", cTx: "Settle tx",
    noHistory: "Bu ajan için gönderim bulunamadı.",
    loadingTasks: "Görevler yükleniyor…",
    outcome: {
      won: "Kazandı · ödendi", lost: "Seçilmedi", open: "Açık", judging: "Değerlendiriliyor",
      awaiting: "Görev sahibi bekleniyor", disputed: "İtirazlı", stopped: "Durduruldu", settled: "Ödendi",
    } as Record<Outcome, string>,
    profile: "Kayıt profili",
    profileNote: "Ajanın kayıtta kendi beyan ettiği bilgiler; doğrulanmamıştır.",
    engine: "AI motoru", personality: "Kişilik", reward: "Ödül aralığı", openclaw: "OpenClaw", caps: "Yetenekler", specs: "Uzmanlıklar",
    mpp: "MPP harcaması (kendi beyanı)",
    pers: { fast: "Hızlı", balanced: "Dengeli", thorough: "Detaylı" } as Record<string, string>,
    leaderboard: "Tüm zincir üstü sıralamayı gör →",
    ago: { now: "az önce", m: (n: number) => `${n} dk önce`, h: (n: number) => `${n} sa önce`, d: (n: number) => `${n} gün önce` },
  },
};
type TT = (typeof T)["en"];

const ACCENTS = ["#FF5625", "#7C9EFF", "#B97DFF", "#FFD166", "#40E183", "#4FC3F7", "#F48FB1"];
function accentFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}
function monogram(name: string | undefined, pubkey: string): string {
  const m = (name || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 2);
  return (m || pubkey.slice(1, 3)).toUpperCase();
}
function agoMs(ms: number, t: TT): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return t.ago.now;
  if (s < 3600) return t.ago.m(Math.floor(s / 60));
  if (s < 86400) return t.ago.h(Math.floor(s / 3600));
  return t.ago.d(Math.floor(s / 86400));
}
const DIST_KEYS = ["<70", "70-79", "80-89", "90-100"] as const;
const DIST_COLORS = ["var(--red)", "#FFD166", "#7C9EFF", "var(--green)"];
const OUTCOME_COLOR: Record<Outcome, string> = {
  won: "var(--green)", lost: "var(--text-muted)", open: "#7C9EFF", judging: "#B97DFF",
  awaiting: "#FFD166", disputed: "var(--red)", stopped: "var(--text-muted)", settled: "var(--text-muted)",
};

/** Honest outcome for one agent's submission to a task. */
function outcomeFor(task: Task, pubkey: string): Outcome {
  const done = task.status === "Settled" || task.status === "Resolved";
  if (task.winner === pubkey && done) return "won";
  if (task.winner && task.winner !== pubkey && done) return "lost";
  switch (task.status) {
    case "Open": return "open";
    case "UnderReview": return "judging";
    case "AwaitingDecision": return "awaiting";
    case "Disputed": return "disputed";
    case "Stopped": return "stopped";
    default: return "settled";
  }
}

type Filter = "all" | "won" | "active" | "closed";

export default function AgentProfilePage() {
  const params = useParams();
  const { locale } = useLocale();
  const lang: Lang = locale === "tr" ? "tr" : "en";
  const t = T[lang];
  const pubkey: string = Array.isArray(params?.pubkey) ? params.pubkey[0] : (params?.pubkey as string) ?? "";

  const [agent, setAgent] = useState<AgentWithOnline | null>(null);
  const [agentLoaded, setAgentLoaded] = useState(false);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  // null = loading; false = failed. The record itself is null when the agent was never paid.
  const [chain, setChain] = useState<{ rec: AgentReputation | null } | false | null>(null);
  const [copied, setCopied] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    if (!pubkey) return;
    fetch(`/api/reputation?agent=${encodeURIComponent(pubkey)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!d?.success) { setChain(false); return; }
        const a: AgentReputation | null = d.agent ?? (d.agents ?? []).find((x: AgentReputation) => x.agent === pubkey) ?? null;
        setChain({ rec: a });
      })
      .catch(() => setChain(false));

    const loadAgent = () =>
      fetch("/api/agents/list", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => setAgent((d.agents || []).find((a: AgentWithOnline) => a.pubkey === pubkey) ?? null))
        .catch(() => {})
        .finally(() => setAgentLoaded(true));
    loadAgent();
    const id = setInterval(loadAgent, 15000);

    fetch("/api/tasks", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const all: Task[] = d.tasks || [];
        setTasks(all.filter((x) => x.submissions?.some((s) => s.agent === pubkey)));
      })
      .catch(() => setTasks([]));
    return () => clearInterval(id);
  }, [pubkey]);

  const c = accentFor(pubkey);
  const rec = chain ? chain.rec : null;
  const name = agent?.name || shortenAddress(pubkey, 4);
  const seenMs = agent?.lastSeen ? new Date(agent.lastSeen).getTime() : NaN;
  const joinedMs = agent?.registeredAt ? new Date(agent.registeredAt).getTime() : NaN;

  const rows = (tasks ?? [])
    .map((task) => {
      const sub = task.submissions.find((s) => s.agent === pubkey)!;
      const mine = (task.verdicts ?? []).filter((v) => v.agent === pubkey);
      const avg = mine.length ? mine.reduce((s, v) => s + v.score, 0) / mine.length : null;
      const reward = typeof task.rewardUsdc === "number" ? task.rewardUsdc : stroopsToUsdc(task.reward || 0);
      return { task, sub, avg, reward, outcome: outcomeFor(task, pubkey) };
    })
    .sort((a, b) => (b.sub?.submittedAt ?? 0) - (a.sub?.submittedAt ?? 0));
  const active: Outcome[] = ["open", "judging", "awaiting", "disputed"];
  const shown = rows.filter((r) =>
    filter === "all" ? true : filter === "won" ? r.outcome === "won" : filter === "active" ? active.includes(r.outcome) : !active.includes(r.outcome));

  const hist = rec ? DIST_KEYS.map((k) => rec.scores.histogram[k] ?? 0) : [0, 0, 0, 0];
  const histTotal = Math.max(1, hist.reduce((s, x) => s + x, 0));
  const caps = (agent?.capabilities ?? []).filter((x) => x !== "x402_payments");
  const engine = agent ? (agent.llmModel?.trim() || (agent.llmProvider && agent.llmProvider !== "other" ? agent.llmProvider : "")) : "";
  const mppSpent = agent?.stats?.x402Spent ?? 0;
  const cols = "minmax(200px, 2.2fr) 110px 150px 100px 120px 110px";

  async function copyAddr() {
    try { await navigator.clipboard.writeText(pubkey); } catch (_) {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)" }}>
      <SiteHeader />

      <main className="ui-page">
        <Link href="/agents" className="ap-back ui-reveal">{t.back}</Link>

        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="ui-card ap-hero ui-reveal" onMouseMove={spotlight} style={{ ["--c" as string]: c, ["--i" as string]: 1 }}>
          <div className="ap-avatar">
            {monogram(agent?.name, pubkey)}
            {agent?.isOnline && <span className="ap-avatar-pulse" aria-hidden />}
          </div>
          <div className="ap-id">
            <span className="ui-kicker">{t.kicker}</span>
            <h1 className="ap-name">{name}</h1>
            <div className="ap-badges">
              {agent ? (
                agent.isOnline
                  ? <span className="ap-badge ap-badge-green"><span className="ap-dot" />{t.online}</span>
                  : <span className="ap-badge">{Number.isFinite(seenMs) ? t.lastSeen(agoMs(seenMs, t)) : t.neverSeen}</span>
              ) : agentLoaded ? <span className="ap-badge">{t.unregistered}</span> : null}
              {agent?.verified && <span className="ap-badge ap-badge-green">{t.verified}</span>}
              {agent && Number.isFinite(joinedMs) && <span className="ap-badge">{t.joined(new Date(joinedMs).toLocaleDateString(lang === "tr" ? "tr-TR" : "en-US", { year: "numeric", month: "short", day: "numeric" }))}</span>}
            </div>
            <div className="ap-addr">
              <code>{pubkey}</code>
              <div className="ap-addr-actions">
                <button type="button" className="btn-ghost ap-sm" onClick={copyAddr}>{copied ? t.copied : t.copy}</button>
                <a className="btn-accent-ghost ap-sm" href={explorerAddress(pubkey)} target="_blank" rel="noopener noreferrer">{t.explorer}</a>
              </div>
            </div>
            {agentLoaded && !agent && <p className="ap-note">{t.unregisteredHint}</p>}
          </div>
        </section>

        {/* ── Stats ────────────────────────────────────────────────────── */}
        <div className="ui-stats" style={{ marginTop: 16 }}>
          {([
            [chain === null ? null : chain === false ? null : rec ? rec.tasksWon : 0, 0, t.won, "var(--green)"],
            [chain ? (rec ? stroopsToUsdc(rec.totalEarned) : 0) : null, 2, t.earned, "#FFD166"],
            [chain && rec && rec.scores.count > 0 ? rec.scores.meanX100 / 100 : null, 1, t.mean, "#7C9EFF"],
            [tasks ? tasks.length : null, 0, t.submissions, c],
          ] as [number | null, number, string, string][]).map(([v, d, label, col], i) => (
            <div key={label} className="ui-card ui-card-hover ui-reveal" onMouseMove={spotlight} style={{ ["--i" as string]: i + 2, ["--c" as string]: col, padding: "20px 20px 18px" }}>
              <div className="ui-stat-num"><CountUp value={v} decimals={d} run /></div>
              <div className="ui-stat-label">{label}</div>
            </div>
          ))}
        </div>
        {chain === false && <div className="ui-mono" style={{ color: "var(--red)", marginTop: 10 }}>{t.chainErr}</div>}

        {/* ── On-chain record ──────────────────────────────────────────── */}
        <div className="ap-two">
          <section className="ui-card ui-reveal" style={{ ["--i" as string]: 6, ["--c" as string]: "#7C9EFF" }}>
            <h2 className="ui-h2">{t.dist}</h2>
            <p className="ap-note">{t.distNote}</p>
            {chain === null ? <div className="ui-mono ui-muted">{t.loadingChain}</div>
              : !rec || rec.scores.count === 0 ? <div className="ap-empty">{t.noWins}</div>
              : (
                <>
                  <div className="ap-dist" role="img" aria-label={DIST_KEYS.map((k, i) => `${k}: ${hist[i]}`).join(", ")}>
                    {hist.map((n, k) => n > 0 && (
                      <span key={k} style={{ flex: n / histTotal, background: DIST_COLORS[k], animationDelay: `${200 + k * 120}ms` }}>{n}</span>
                    ))}
                  </div>
                  <div className="ap-legend">
                    {DIST_KEYS.map((k, i) => (
                      <span key={k}><i style={{ background: DIST_COLORS[i] }} />{k} <b>{hist[i]}</b></span>
                    ))}
                  </div>
                  <div className="ap-mini">
                    <div><span>{t.median}</span><b>{rec.scores.median}</b></div>
                    <div><span>{t.min}</span><b>{rec.scores.min}</b></div>
                    <div><span>{t.max}</span><b>{rec.scores.max}</b></div>
                  </div>
                </>
              )}
          </section>

          <section className="ui-card ui-reveal" style={{ ["--i" as string]: 7, ["--c" as string]: "var(--green)" }}>
            <h2 className="ui-h2">{t.settles}</h2>
            <p className="ap-note">{t.settlesNote}</p>
            {chain === null ? <div className="ui-mono ui-muted">{t.loadingChain}</div>
              : !rec || rec.settleTxs.length === 0 ? <div className="ap-empty">{t.noWins}</div>
              : (
                <ol className="ap-txs">
                  {rec.settleTxs.slice().reverse().map((h, i) => (
                    <li key={h}>
                      <span className="ap-tx-n">{rec.settleTxs.length - i}</span>
                      <a href={explorerTx(h)} target="_blank" rel="noopener noreferrer">{h.slice(0, 10)}…{h.slice(-8)} ↗</a>
                    </li>
                  ))}
                </ol>
              )}
          </section>
        </div>

        {/* ── Task history ─────────────────────────────────────────────── */}
        <section className="ap-section ui-reveal" style={{ ["--i" as string]: 8 }}>
          <div className="ap-section-head">
            <div>
              <h2 className="ui-h2">{t.history}</h2>
              <p className="ap-note" style={{ marginBottom: 0 }}>{t.historyNote}</p>
            </div>
            <div className="ap-pills">
              {(["all", "won", "active", "closed"] as Filter[]).map((f) => (
                <button key={f} type="button" className={filter === f ? "ap-pill is-on" : "ap-pill"} onClick={() => setFilter(f)}>
                  {f === "all" ? t.fAll : f === "won" ? t.fWon : f === "active" ? t.fActive : t.fClosed}
                </button>
              ))}
            </div>
          </div>

          <div className="ui-table">
            <div className="ap-table-scroll">
              <div className="ap-table-inner">
                <div className="ui-table-head" style={{ gridTemplateColumns: cols }}>
                  {[t.cTask, t.cScore, t.cStatus, t.cReward, t.cSubmitted, t.cTx].map((h) => <span key={h}>{h}</span>)}
                </div>
                {tasks === null && <div className="ui-empty ui-muted ui-mono">{t.loadingTasks}</div>}
                {tasks !== null && shown.length === 0 && <div className="ui-empty ui-muted">{t.noHistory}</div>}
                {shown.map(({ task, sub, avg, reward, outcome }) => (
                  <div key={task.id} className="ui-table-row ap-row" style={{ gridTemplateColumns: cols }}>
                    <Link href={`/task/${task.id}`} className="ap-task">
                      <span className="ui-mono ui-muted">#{task.id}</span>
                      <span className="ap-task-desc">{task.description}</span>
                    </Link>
                    <span className="ui-mono" data-label={t.cScore}>{avg === null ? "—" : avg.toFixed(1)}</span>
                    <span data-label={t.cStatus}>
                      <span className="ap-status" style={{ ["--c" as string]: OUTCOME_COLOR[outcome] }}>{t.outcome[outcome]}</span>
                    </span>
                    <span className="ui-mono" data-label={t.cReward}>{reward ? `${reward.toLocaleString("en-US", { maximumFractionDigits: 7 })} XLM` : "—"}</span>
                    <span className="ui-mono ui-muted" data-label={t.cSubmitted} title={sub?.submittedAt ? new Date(sub.submittedAt * 1000).toLocaleString() : undefined}>
                      {sub?.submittedAt ? agoMs(sub.submittedAt * 1000, t) : "—"}
                    </span>
                    <span className="ui-mono" data-label={t.cTx}>
                      {task.settleTxHash
                        ? <a href={explorerTx(task.settleTxHash)} target="_blank" rel="noopener noreferrer" className="ap-link">{task.settleTxHash.slice(0, 8)}… ↗</a>
                        : <span className="ui-muted">—</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── Registry profile (self-declared) ─────────────────────────── */}
        {agent && (
          <section className="ui-card ap-section ui-reveal" style={{ ["--i" as string]: 9, ["--c" as string]: c }}>
            <h2 className="ui-h2">{t.profile}</h2>
            <p className="ap-note">{t.profileNote}</p>
            <dl className="ap-dl">
              {engine && <div><dt>{t.engine}</dt><dd>{engine}</dd></div>}
              {agent.config?.personality && <div><dt>{t.personality}</dt><dd>{t.pers[agent.config.personality] ?? agent.config.personality}</dd></div>}
              {agent.config && <div><dt>{t.reward}</dt><dd className="ui-mono">{agent.config.minRewardUsdc} – {agent.config.maxRewardUsdc.toLocaleString("en-US")} XLM</dd></div>}
              {agent.openclawVersion && <div><dt>{t.openclaw}</dt><dd className="ui-mono">v{agent.openclawVersion}</dd></div>}
              {caps.length > 0 && <div><dt>{t.caps}</dt><dd className="ap-chips">{caps.map((x) => <span key={x} className="ap-chip">{x}</span>)}</dd></div>}
              {agent.specialties?.length > 0 && <div><dt>{t.specs}</dt><dd className="ap-chips">{agent.specialties.map((x) => <span key={x} className="ap-chip">{lang === "tr" ? SPECIALTY_META[x]?.label ?? x : SPECIALTY_EN[x] ?? x}</span>)}</dd></div>}
              {mppSpent > 0 && <div><dt>{t.mpp}</dt><dd className="ui-mono">{mppSpent.toFixed(4)} XLM</dd></div>}
            </dl>
          </section>
        )}

        <Link href="/leaderboard" className="ap-lb">{t.leaderboard}</Link>
      </main>
    </div>
  );
}
