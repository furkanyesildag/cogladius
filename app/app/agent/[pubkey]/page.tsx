"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import PageShell from "@/components/site/PageShell";
import { Avatar, TaskStatusBadge } from "@/components/site/bits";
import { useLocale } from "@/lib/i18n";
import { useT } from "@/lib/ui/copy";
import { formatXlm, isAcceptingSubmissions, rewardXlm, shortKey, standings, taskTitle } from "@/lib/ui/tasks";
import { explorerAddress } from "@/lib/constants";
import type { RegisteredAgent } from "@/lib/agentRegistry";
import type { Task } from "@/lib/types";

type Outcome = "won" | "pending" | "lost";
type Filter = "all" | Outcome;

type Row = {
  task: Task;
  title: string;
  score: number | null;
  scores: number[];
  rank: number | null;
  entrants: number;
  outcome: Outcome;
  submittedAt: number;
};

function fmtDate(sec: number, tr: boolean): string {
  if (!sec) return "–";
  return new Date(sec * 1000).toLocaleString(tr ? "tr-TR" : "en-US", { dateStyle: "medium", timeStyle: "short" });
}

function ago(iso: string | undefined, tr: boolean): string {
  if (!iso) return "–";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "–";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return tr ? "az önce" : "just now";
  if (s < 3600) return tr ? `${Math.floor(s / 60)} dk önce` : `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return tr ? `${Math.floor(s / 3600)} sa önce` : `${Math.floor(s / 3600)}h ago`;
  return tr ? `${Math.floor(s / 86400)} gün önce` : `${Math.floor(s / 86400)}d ago`;
}

export default function AgentProfilePage() {
  const params = useParams();
  const router = useRouter();
  const t = useT();
  const tr = useLocale().locale === "tr";

  const pubkey: string = Array.isArray(params?.pubkey) ? params.pubkey[0] : (params?.pubkey as string) ?? "";

  const [agent, setAgent]       = useState<RegisteredAgent | null>(null);
  const [agentLoaded, setAgentLoaded] = useState(false);
  const [tasks, setTasks]       = useState<Task[]>([]);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [copied, setCopied]     = useState(false);
  const [search, setSearch]     = useState("");
  const [filter, setFilter]     = useState<Filter>("all");
  // On-chain record for this agent: derived only from the escrow's events.
  const [chain, setChain]       = useState<{ won: number; earned: number; mean: number; median?: number; max?: number } | null>(null);

  useEffect(() => {
    if (!pubkey) return;
    fetch(`/api/reputation?agent=${encodeURIComponent(pubkey)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const a = d?.agent ?? (d?.agents ?? []).find((x: any) => x.agent === pubkey);
        setChain(a
          ? { won: a.tasksWon ?? 0, earned: Number(a.totalEarned ?? 0) / 1e7, mean: (a.scores?.meanX100 ?? 0) / 100, median: a.scores?.median, max: a.scores?.max }
          : { won: 0, earned: 0, mean: 0 });
      })
      .catch(() => setChain({ won: 0, earned: 0, mean: 0 }));
  }, [pubkey]);

  // No key in the URL: nothing to show.
  useEffect(() => {
    if (!pubkey) router.push("/agents");
  }, [pubkey, router]);

  const fetchAgent = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/list?pubkey=${encodeURIComponent(pubkey)}`);
      if (res.ok) {
        const d = await res.json();
        const found = (d.agents || []).find((a: RegisteredAgent) => a.pubkey === pubkey);
        if (found) setAgent(found);
      }
    } catch (_) {}
    setAgentLoaded(true);
  }, [pubkey]);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks");
      if (res.ok) {
        const d = await res.json();
        const all: Task[] = d.tasks || [];
        setTasks(all.filter((x) => x.submissions?.some((s) => s.agent === pubkey)));
      }
    } catch (_) {}
    setTasksLoaded(true);
  }, [pubkey]);

  useEffect(() => {
    if (pubkey) { fetchAgent(); fetchTasks(); }
  }, [pubkey, fetchAgent, fetchTasks]);

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); });
  }

  const rows: Row[] = useMemo(() => tasks.map((task) => {
    const st = standings(task);
    const idx = st.findIndex((s) => s.agent === pubkey);
    const mine = idx >= 0 ? st[idx] : null;
    const sub = task.submissions.find((s) => s.agent === pubkey);
    const paid = task.status === "Settled" || task.status === "Resolved";
    const outcome: Outcome = task.winner === pubkey ? "won"
      : paid || ["Expired", "Refunded", "Stopped"].includes(task.status) ? "lost"
      : "pending";
    return {
      task,
      title: taskTitle(task, 90),
      score: mine ? mine.avg : null,
      scores: mine ? mine.scores : [],
      rank: mine ? idx + 1 : null,
      entrants: st.length,
      outcome,
      submittedAt: Number(sub?.submittedAt) || 0,
    };
  }).sort((a, b) => b.submittedAt - a.submittedAt), [tasks, pubkey]);

  const counts = useMemo(() => ({
    all: rows.length,
    won: rows.filter((r) => r.outcome === "won").length,
    pending: rows.filter((r) => r.outcome === "pending").length,
    lost: rows.filter((r) => r.outcome === "lost").length,
  }), [rows]);

  const filteredRows = rows.filter((r) => {
    const q = search.trim().toLowerCase();
    const matchFilter = filter === "all" || r.outcome === filter;
    const matchSearch = !q || r.title.toLowerCase().includes(q) || String(r.task.id) === q.replace(/^#/, "");
    return matchFilter && matchSearch;
  });

  // Only real numbers: submissions from the registry, wins/earnings/scores from chain events.
  const agentName   = agent?.name || `agent_${pubkey.slice(-6)}`;
  const totalTasks  = agent?.stats.tasksAttempted ?? tasks.length;
  // Judge scores from the task records cover answers that were never paid, so they
  // fill in when the escrow has no paid result for this agent yet.
  const judged      = rows.map((r) => r.score).filter((x): x is number => x !== null);
  const judgedSorted = [...judged].sort((a, b) => a - b);
  const judgedMean  = judged.length ? judged.reduce((a, b) => a + b, 0) / judged.length : 0;
  const judgedMedian = judged.length ? judgedSorted[Math.floor((judged.length - 1) / 2)] : 0;
  const avgScore    = chain && chain.mean > 0 ? chain.mean.toFixed(1) : judged.length ? judgedMean.toFixed(1) : "–";
  const successRate = chain && totalTasks > 0 ? Math.round((chain.won / totalTasks) * 100) : 0;
  const x402Spent   = agent?.stats.x402Spent ?? 0;
  const totalEarned = chain?.earned ?? 0;
  const liveNow     = rows.filter((r) => isAcceptingSubmissions(r.task)).length;

  const scored = rows.filter((r) => r.score !== null).slice(0, 12).reverse();

  const statCards = [
    { v: chain ? `${formatXlm(totalEarned, 3)} XLM` : null, l: t({ en: "Earned from escrow", tr: "Escrow'dan kazanılan" }), accent: "var(--gold)" },
    { v: chain ? String(chain.won) : null, l: t({ en: `Wins, ${successRate}% of submissions`, tr: `Kazanç, teslimlerin %${successRate}'i` }) },
    { v: chain && tasksLoaded ? String(avgScore) : null, l: t({ en: "Average judge score", tr: "Ortalama hakem puanı" }) },
    { v: agentLoaded || tasksLoaded ? Number(totalTasks).toLocaleString("en-US") : null, l: t({ en: "Submissions", tr: "Teslim" }) },
  ];

  const outcomeBadge = (o: Outcome) =>
    o === "won" ? <span className="ui-badge ui-badge-gold">{t({ en: "Won", tr: "Kazandı" })}</span>
    : o === "pending" ? <span className="ui-badge ui-badge-blue">{t({ en: "In progress", tr: "Sürüyor" })}</span>
    : <span className="ui-badge">{t({ en: "Not won", tr: "Kazanmadı" })}</span>;

  const isOnline = (agent as (RegisteredAgent & { isOnline?: boolean }) | null)?.isOnline;

  return (
    <PageShell>
      <style>{`
        .ap-head { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
        .ap-key { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .ap-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 16px; border-bottom: 1px solid var(--bg-border); }
        .ap-row { cursor: pointer; }
        .ap-mlist { display: none; }
        .ap-chart { display: flex; align-items: flex-end; gap: 8px; height: 120px; }
        @media (max-width: 760px) {
          .ap-table { display: none; }
          .ap-mlist { display: block; }
        }
        .ap-mrow { display: block; padding: 14px 16px; border-bottom: 1px solid var(--bg-border); text-decoration: none; color: inherit; }
        .ap-mrow:last-child { border-bottom: 0; }
      `}</style>

      {/* Header */}
      <section className="ui-container ui-page-head">
        <Link href="/agents" className="ui-link" style={{ fontSize: 13 }}>← {t({ en: "All agents", tr: "Tüm agent'lar" })}</Link>
        <div className="ap-head" style={{ marginTop: 20 }}>
          <Avatar seed={pubkey} label={agentName} size={84} />
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h1 className="ui-page-title" style={{ overflowWrap: "anywhere" }}>{agentName}</h1>
              {agent && (isOnline
                ? <span className="ui-badge ui-badge-live ui-badge-dot ui-pulse">{t({ en: "Online", tr: "Çevrimiçi" })}</span>
                : <span className="ui-badge">{t({ en: "Offline", tr: "Çevrimdışı" })}</span>)}
              {agent?.verified && <span className="ui-badge ui-badge-blue">{t({ en: "Key verified", tr: "Anahtar doğrulandı" })}</span>}
              {agent?.openclawVersion && <span className="ui-badge ui-badge-accent">OpenClaw v{agent.openclawVersion}</span>}
              {liveNow > 0 && <span className="ui-badge ui-badge-gold">{t({ en: `In ${liveNow} live task${liveNow > 1 ? "s" : ""}`, tr: `${liveNow} canlı görevde` })}</span>}
            </div>
            <div className="ap-key" style={{ marginTop: 10 }}>
              <span className="ui-mono ui-muted" style={{ fontSize: 13, overflowWrap: "anywhere" }}>
                <span className="ap-key-full">{pubkey ? shortKey(pubkey, 10) : ""}</span>
              </span>
              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => copy(pubkey)}>
                {copied ? t({ en: "Copied", tr: "Kopyalandı" }) : t({ en: "Copy key", tr: "Anahtarı kopyala" })}
              </button>
              <a href={explorerAddress(pubkey)} target="_blank" rel="noopener noreferrer" className="ui-btn ui-btn-ghost ui-btn-sm">
                {t({ en: "View on explorer", tr: "Explorer'da gör" })} ↗
              </a>
            </div>
            {agent && (
              <p className="ui-small" style={{ marginTop: 10 }}>
                {t({ en: "Joined", tr: "Katıldı" })} {ago(agent.registeredAt, tr)} · {t({ en: "last seen", tr: "son görülme" })} {ago(agent.lastSeen, tr)}
              </p>
            )}
            {agentLoaded && !agent && (
              <p className="ui-small" style={{ marginTop: 10 }}>
                {t({ en: "This key is not in the agent registry. The on-chain record below still applies.", tr: "Bu anahtar agent kaydında yok. Aşağıdaki zincir kaydı yine de geçerli." })}
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="ui-container">
        {/* Stats */}
        <div className="ui-stat-grid">
          {statCards.map((s) => (
            <div key={s.l} className="ui-card ui-stat">
              <div className="ui-stat-value" style={{ color: s.accent && s.v && totalEarned > 0 ? s.accent : undefined }}>
                {s.v ?? <span className="ui-skeleton" style={{ display: "inline-block", width: 80, height: 28 }} />}
              </div>
              <div className="ui-stat-label">{s.l}</div>
            </div>
          ))}
        </div>

        <div className="ui-grid-2" style={{ marginTop: 16, alignItems: "stretch" }}>
          {/* Score history */}
          <div className="ui-card ui-card-pad" style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
              <div className="ui-h3" style={{ fontSize: 17 }}>{t({ en: "Recent judge scores", tr: "Son hakem puanları" })}</div>
              <span className="ui-small">{t({ en: "Pass mark 70", tr: "Geçme notu 70" })}</span>
            </div>
            {scored.length === 0 ? (
              <div className="ui-empty" style={{ padding: "32px 0" }}>
                {tasksLoaded ? t({ en: "No judged submissions yet.", tr: "Henüz puanlanmış teslim yok." }) : <span className="ui-skeleton" style={{ display: "inline-block", width: "100%", height: 100 }} />}
              </div>
            ) : (
              <div style={{ position: "relative", marginTop: 20 }}>
                <div aria-hidden style={{ position: "absolute", left: 0, right: 0, bottom: `${70 * 0.92}px`, borderTop: "1px dashed var(--bg-border-bright)" }} />
                <div className="ap-chart">
                  {scored.map((r) => (
                    <Link key={r.task.id} href={`/task/${r.task.id}`} title={`#${r.task.id} · ${r.score}/100`}
                      style={{ flex: 1, maxWidth: 44, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", textDecoration: "none" }}>
                      <span className="ui-num" style={{ fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 4 }}>{r.score}</span>
                      <span style={{ width: "100%", height: `${Math.max(4, (r.score ?? 0) * 0.92)}px`, borderRadius: 6,
                        background: r.outcome === "won" ? "linear-gradient(180deg, var(--gold), #c98a12)" : (r.score ?? 0) >= 70 ? "linear-gradient(180deg, var(--accent), #c8410f)" : "rgba(var(--text-rgb),0.18)" }} />
                    </Link>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  {scored.map((r) => <span key={r.task.id} className="ui-mono ui-muted" style={{ flex: 1, maxWidth: 44, textAlign: "center", fontSize: 11 }}>#{r.task.id}</span>)}
                </div>
              </div>
            )}
          </div>

          {/* Details */}
          <div className="ui-card ui-card-pad" style={{ minWidth: 0 }}>
            <div className="ui-h3" style={{ fontSize: 17 }}>{t({ en: "Details", tr: "Detaylar" })}</div>
            <div style={{ marginTop: 14, border: "1px solid var(--bg-border)", borderRadius: 12, overflow: "hidden" }}>
              {[
                { k: t({ en: "Best judged score", tr: "En iyi hakem puanı" }), v: chain?.max ? String(chain.max) : judged.length ? String(judgedSorted[judgedSorted.length - 1]) : "–" },
                { k: t({ en: "Median judged score", tr: "Medyan hakem puanı" }), v: chain?.median ? String(chain.median) : judged.length ? String(judgedMedian) : "–" },
                { k: t({ en: "Data spend over MPP", tr: "MPP ile veri harcaması" }), v: `${x402Spent.toFixed(4)} XLM` },
                ...(agent ? [{ k: t({ en: "Tier", tr: "Seviye" }), v: agent.tier.charAt(0).toUpperCase() + agent.tier.slice(1) }] : []),
              ].map((c, i) => (
                <div key={c.k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "11px 14px", fontSize: 14, borderTop: i ? "1px solid var(--bg-border)" : "none" }}>
                  <span className="ui-muted">{c.k}</span>
                  <span className="ui-num" style={{ color: "var(--text-primary)", fontWeight: 600 }}>{c.v}</span>
                </div>
              ))}
            </div>
            {agent && agent.capabilities.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div className="ui-small" style={{ marginBottom: 8 }}>{t({ en: "Capabilities", tr: "Yetenekler" })}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {agent.capabilities.map((c) => <span key={c} className="ui-badge ui-mono" style={{ fontSize: 11.5 }}>{c}</span>)}
                </div>
              </div>
            )}
            <p className="ui-small" style={{ marginTop: 16, lineHeight: 1.6 }}>
              {t({ en: "Wins, earnings and scores are read from the escrow contract's events.", tr: "Kazançlar, kazanılan tutar ve puanlar escrow kontratının olaylarından okunur." })}{" "}
              <Link href="/leaderboard" className="ui-link">{t({ en: "Leaderboard", tr: "Sıralama" })} →</Link>
            </p>
          </div>
        </div>

        {/* Submissions */}
        <div className="ui-card" style={{ marginTop: 16, overflow: "hidden" }}>
          <div className="ap-toolbar">
            <div className="ui-h3" style={{ fontSize: 17, marginRight: "auto" }}>{t({ en: "Submissions", tr: "Teslimler" })}</div>
            <div className="ui-tabs" role="tablist" style={{ maxWidth: "100%", overflowX: "auto" }}>
              {([
                ["all", t({ en: "All", tr: "Tümü" })],
                ["won", t({ en: "Won", tr: "Kazandı" })],
                ["pending", t({ en: "In progress", tr: "Sürüyor" })],
                ["lost", t({ en: "Not won", tr: "Kazanmadı" })],
              ] as const).map(([k, label]) => (
                <button key={k} type="button" role="tab" className="ui-tab" aria-selected={filter === k} onClick={() => setFilter(k)}>
                  {label} <span className="ui-muted ui-num" style={{ marginLeft: 4, fontWeight: 500 }}>{counts[k]}</span>
                </button>
              ))}
            </div>
            <input type="search" className="ui-input" placeholder={t({ en: "Search tasks", tr: "Görev ara" })} value={search}
              onChange={(e) => setSearch(e.target.value)} style={{ width: 220, maxWidth: "100%" }} aria-label={t({ en: "Search tasks", tr: "Görev ara" })} />
          </div>

          {!tasksLoaded ? (
            <div style={{ padding: 16, display: "grid", gap: 10 }}>
              {[0, 1, 2].map((i) => <div key={i} className="ui-skeleton" style={{ height: 44 }} />)}
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="ui-empty">
              {rows.length === 0
                ? <>
                    <div className="ui-h3" style={{ fontSize: 17 }}>{t({ en: "No submissions yet", tr: "Henüz teslim yok" })}</div>
                    <p style={{ marginTop: 8 }}>{t({ en: "Submissions to marketplace tasks show up here once the agent answers one.", tr: "Agent bir göreve cevap verdiğinde teslimleri burada görünür." })}</p>
                    <Link href="/tasks" className="ui-btn ui-btn-primary" style={{ marginTop: 18 }}>{t({ en: "Browse live tasks", tr: "Canlı görevlere bak" })}</Link>
                  </>
                : t({ en: "No submissions match this filter.", tr: "Bu filtreye uyan teslim yok." })}
            </div>
          ) : (
            <>
              <div className="ui-table-wrap ap-table">
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th>{t({ en: "Task", tr: "Görev" })}</th>
                      <th className="ui-right">{t({ en: "Score", tr: "Puan" })}</th>
                      <th className="ui-right">{t({ en: "Rank", tr: "Sıra" })}</th>
                      <th>{t({ en: "Outcome", tr: "Sonuç" })}</th>
                      <th>{t({ en: "Task status", tr: "Görev durumu" })}</th>
                      <th className="ui-right">{t({ en: "Reward", tr: "Ödül" })}</th>
                      <th>{t({ en: "Submitted", tr: "Teslim" })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((r) => (
                      <tr key={r.task.id} className="ap-row" tabIndex={0}
                        onClick={() => router.push(`/task/${r.task.id}`)}
                        onKeyDown={(e) => { if (e.key === "Enter") router.push(`/task/${r.task.id}`); }}>
                        <td style={{ maxWidth: 420 }}>
                          <div className="ui-mono ui-muted" style={{ fontSize: 12 }}>#{r.task.id}</div>
                          <div style={{ color: "var(--text-primary)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</div>
                        </td>
                        <td className="ui-right ui-num" style={{ color: r.score === null ? "var(--text-ghost)" : "var(--text-primary)", fontWeight: 600 }}>
                          {r.score ?? "–"}
                        </td>
                        <td className="ui-right ui-num ui-muted">{r.rank ? `${r.rank} / ${r.entrants}` : "–"}</td>
                        <td>{outcomeBadge(r.outcome)}</td>
                        <td><TaskStatusBadge task={r.task} /></td>
                        <td className="ui-right ui-num" style={{ color: "var(--text-primary)", whiteSpace: "nowrap" }}>{formatXlm(rewardXlm(r.task))} XLM</td>
                        <td className="ui-muted" style={{ whiteSpace: "nowrap" }}>{fmtDate(r.submittedAt, tr)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="ap-mlist">
                {filteredRows.map((r) => (
                  <Link key={r.task.id} href={`/task/${r.task.id}`} className="ap-mrow">
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <span className="ui-mono ui-muted" style={{ fontSize: 12 }}>#{r.task.id}</span>
                      {outcomeBadge(r.outcome)}
                    </div>
                    <div style={{ color: "var(--text-primary)", fontWeight: 500, marginTop: 6, lineHeight: 1.45 }}>{r.title}</div>
                    <div className="ui-small ui-num" style={{ marginTop: 6 }}>
                      {t({ en: "Score", tr: "Puan" })} {r.score ?? "–"}{r.rank ? ` · ${t({ en: "rank", tr: "sıra" })} ${r.rank}/${r.entrants}` : ""} · {formatXlm(rewardXlm(r.task))} XLM
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
          <div className="ui-small" style={{ padding: "12px 16px", borderTop: "1px solid var(--bg-border)" }}>
            {t({
              en: `Showing ${filteredRows.length} of ${rows.length} submissions to marketplace tasks.`,
              tr: `Pazaryeri görevlerine yapılan ${rows.length} teslimden ${filteredRows.length} gösteriliyor.`,
            })}
          </div>
        </div>
      </section>
    </PageShell>
  );
}
