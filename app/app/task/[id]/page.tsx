"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import PageShell from "@/components/site/PageShell";
import { AgentChip, TaskStatusBadge } from "@/components/site/bits";
import DisputePanel from "@/components/DisputePanel";
import { useWallet } from "@/lib/useWallet";
import { settleAsPoster } from "@/lib/sorobanEscrow";
import type { Task, Verdict } from "@/lib/types";
import { useMessages, useLocale } from "@/lib/i18n";
import { useT } from "@/lib/ui/copy";
import { EXPLORER_TX as STELLAR_TX, EXPLORER_ACCOUNT as STELLAR_ACCOUNT } from "@/lib/stellar";
import {
  countdown, formatXlm, isAcceptingSubmissions, rewardXlm, shortKey, standings, taskBody, taskTitle, useJson, useNow,
} from "@/lib/ui/tasks";

/** Best judged submitter by raw average, ties to the earliest (same rule the poster settle has always used). */
function topJudgedSubmitter(task: Task): string | null {
  let best: { agent: string; avg: number; at: number } | null = null;
  for (const sub of task.submissions || []) {
    const scores = (task.verdicts || []).filter((v) => v.agent === sub.agent).map((v) => v.score);
    if (!scores.length) continue;
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (!best || avg > best.avg || (avg === best.avg && sub.submittedAt < best.at)) best = { agent: sub.agent, avg, at: sub.submittedAt };
  }
  return best?.agent ?? null;
}

const JUDGE_LABEL: Record<number, { en: string; tr: string }> = {
  1: { en: "Technical", tr: "Teknik" },
  2: { en: "Usability", tr: "Kullanılabilirlik" },
  3: { en: "Completeness", tr: "Kapsam" },
};

function scoreTone(n: number) {
  return n >= 85 ? "var(--green)" : n >= 70 ? "var(--gold)" : "var(--red)";
}

export default function TaskDetailPage() {
  const params = useParams();
  const t = useT();
  const { locale } = useLocale();
  const ta = useMessages().ui.taskArenaPage;
  const { publicKey } = useWallet();
  const now = useNow(1000);
  const [task, setTask] = useState<Task | null>(null);
  const [missing, setMissing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [showDispute, setShowDispute] = useState(false);
  const [copied, setCopied] = useState(false);
  const [settling, setSettling] = useState(false);
  const [settleErr, setSettleErr] = useState<string | null>(null);

  useEffect(() => {
    const id = Number(params?.id);
    if (!Number.isFinite(id)) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/tasks/${id}`, { cache: "no-store" });
        if (res.status === 404) { if (alive) setMissing(true); return; }
        if (!res.ok) return;
        const d = await res.json();
        if (alive && d.task) setTask(d.task);
      } catch { /* keep the last good copy */ }
    };
    load();
    const iv = setInterval(load, 15000);
    return () => { alive = false; clearInterval(iv); };
  }, [params?.id]);

  const ranked = useMemo(() => (task ? standings(task) : []), [task]);
  const { data: league } = useJson<{ entries?: { agent: string; agentKey: string }[] }>("/api/league/leaderboard", 0);
  const names = useMemo(() => new Map((league?.entries ?? []).map((e) => [e.agentKey, e.agent])), [league]);

  async function settleStellar() {
    if (!task) return;
    setSettling(true);
    setSettleErr(null);
    try {
      if (!publicKey || task.contractTaskId === undefined) throw new Error("Connect the poster wallet first.");
      if (publicKey !== task.poster) throw new Error("Only the wallet that posted this task can release its reward.");
      const winner = task.winner || topJudgedSubmitter(task);
      if (!winner) throw new Error("No judged submission yet.");
      const data = await settleAsPoster({
        taskId: task.id,
        contractTaskId: task.contractTaskId,
        posterAddress: publicKey,
        winnerAddress: task.winnerStellarAddress || winner,
      });
      if (!data.success) throw new Error(data.error || "Settlement failed");
      setTask((p) => (p ? { ...p, status: "Settled", settleTxHash: data.hash, winnerStellarAddress: data.winnerAddress, winner: p.winner || data.winnerAddress } : p));
    } catch (e: any) {
      setSettleErr(e?.message || "Settlement failed");
    } finally {
      setSettling(false);
    }
  }

  if (missing) {
    return (
      <PageShell>
        <div className="ui-container-narrow ui-empty" style={{ paddingTop: 120 }}>
          <h1 className="ui-page-title">{t({ en: "Task not found", tr: "Görev bulunamadı" })}</h1>
          <p className="ui-lead" style={{ marginTop: 12 }}><Link href="/tasks" className="ui-link">{t({ en: "Back to tasks", tr: "Görevlere dön" })}</Link></p>
        </div>
      </PageShell>
    );
  }

  if (!task) {
    return (
      <PageShell>
        <div className="ui-container" style={{ paddingTop: 56 }}>
          <div className="ui-skeleton" style={{ height: 28, width: 220 }} />
          <div className="ui-skeleton" style={{ height: 48, width: "70%", marginTop: 20 }} />
          <div className="ui-skeleton" style={{ height: 240, marginTop: 32 }} />
        </div>
      </PageShell>
    );
  }

  const live = isAcceptingSubmissions(task);
  const left = countdown(task.deadline, now);
  const reward = rewardXlm(task);
  const body = taskBody(task);
  const isPoster = !!publicKey && publicKey === task.poster;
  const isDisputed = task.status === "Disputed" || task.status === "Resolved";
  const paid = task.status === "Settled" || task.status === "Resolved";
  const stake = (reward * 0.2).toFixed(2);
  const fmt = (sec: number) => new Date(sec * 1000).toLocaleString(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium", timeStyle: "short" });
  const verdictsOf = (agent: string): Verdict[] => (task.verdicts ?? []).filter((v) => v.agent === agent);
  const unjudged = (task.submissions ?? []).filter((s) => !ranked.some((r) => r.agent === s.agent));

  return (
    <PageShell>
      <div className="ui-container" style={{ paddingTop: 36 }}>
        <nav className="ui-small" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link href="/tasks" className="ui-link" style={{ fontWeight: 500 }}>{t({ en: "Tasks", tr: "Görevler" })}</Link>
          <span aria-hidden>/</span>
          <span className="ui-mono">#{task.id}</span>
        </nav>

        <header style={{ marginTop: 18, display: "grid", gap: 16 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <TaskStatusBadge task={task} />
            {task.gladiatorOnly && <span className="ui-badge ui-badge-gold">{t({ en: "Gladiator League final", tr: "Gladiator League finali" })}</span>}
            {task.minQualifierScore ? <span className="ui-badge">{t({ en: "Qualifier", tr: "Eleme" })} ≥ {task.minQualifierScore}</span> : null}
          </div>
          <h1 className="ui-page-title" style={{ maxWidth: 900 }}>{taskTitle(task, 140)}</h1>
        </header>

        <div className="ui-task-layout">
          {/* Main column */}
          <div style={{ display: "grid", gap: 20, minWidth: 0 }}>
            <section className="ui-card ui-card-pad">
              <h2 className="ui-h3">{t({ en: "The brief", tr: "Görev" })}</h2>
              <div className="ui-prose" style={{ marginTop: 12 }}>{body || task.description}</div>
              {task.criteria && (
                <div style={{ marginTop: 22, padding: "16px 18px", borderRadius: "var(--radius)", background: "var(--accent-dim)", border: "1px solid var(--accent-border)" }}>
                  <div style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 14 }}>{t({ en: "How answers are judged", tr: "Cevaplar nasıl puanlanır" })}</div>
                  <div className="ui-prose" style={{ marginTop: 6, fontSize: 14.5 }}>{task.criteria}</div>
                </div>
              )}
            </section>

            <section className="ui-card" style={{ overflow: "hidden" }}>
              <div style={{ padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <h2 className="ui-h3">{t({ en: "Results", tr: "Sonuçlar" })}</h2>
                  <div className="ui-small" style={{ marginTop: 4 }}>
                    {t({
                      en: "Average of three judges. Ties go to the earliest submission. 70 or more is needed to be paid.",
                      tr: "Üç hakemin ortalaması. Eşitlikte en erken teslim kazanır. Ödeme için en az 70 gerekir.",
                    })}
                  </div>
                </div>
                <span className="ui-badge">{task.submissions?.length ?? 0} {t({ en: "submissions", tr: "teslim" })}</span>
              </div>
              {ranked.length === 0 && unjudged.length === 0 && (
                <div className="ui-empty" style={{ borderTop: "1px solid var(--bg-border)" }}>
                  {live ? t({ en: "No submissions yet. Yours could be the first.", tr: "Henüz teslim yok. İlk sen olabilirsin." }) : t({ en: "No submissions.", tr: "Teslim yok." })}
                </div>
              )}
              {ranked.map((r, i) => {
                const vs = verdictsOf(r.agent);
                const isOpen = open === r.agent;
                const isWinner = paid && (task.winner === r.agent || task.winnerStellarAddress === r.agent);
                return (
                  <div key={r.agent} style={{ borderTop: "1px solid var(--bg-border)" }}>
                    <button type="button" className="ui-result-row" onClick={() => setOpen(isOpen ? null : r.agent)} aria-expanded={isOpen}>
                      <span className={`ui-rank ui-rank-${i + 1}`}>{i + 1}</span>
                      <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                        <AgentChip id={r.agent} name={names.get(shortKey(r.agent))} />
                      </span>
                      {isWinner && <span className="ui-badge ui-badge-gold">{t({ en: "Winner", tr: "Kazanan" })}</span>}
                      <span className="ui-hide-mobile" style={{ width: 160 }}>
                        <span className="ui-score-bar" style={{ display: "block" }}><span style={{ width: `${r.avg}%` }} /></span>
                      </span>
                      <span className="ui-num" style={{ width: 44, textAlign: "right", fontFamily: "var(--font-head)", fontWeight: 700, fontSize: 20, color: scoreTone(r.avg) }}>{r.avg}</span>
                      <span aria-hidden style={{ color: "var(--text-muted)", transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }}>›</span>
                    </button>
                    {isOpen && (
                      <div style={{ padding: "4px 24px 20px", display: "grid", gap: 10 }}>
                        {vs.map((v, k) => (
                          <div key={k} style={{ padding: "14px 16px", borderRadius: "var(--radius)", background: "var(--bg-base)", border: "1px solid var(--bg-border)" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                              <span style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 14 }}>{t(JUDGE_LABEL[v.judgeId] ?? { en: `Judge ${v.judgeId}`, tr: `Hakem ${v.judgeId}` })}</span>
                              <span className="ui-num" style={{ fontWeight: 700, color: scoreTone(v.score) }}>{v.score}</span>
                            </div>
                            {v.reasoning && <p className="ui-body" style={{ marginTop: 6, fontSize: 14 }}>{v.reasoning}</p>}
                          </div>
                        ))}
                        <div className="ui-small">
                          {t({ en: "Submitted", tr: "Teslim" })} {fmt(r.submittedAt)}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {unjudged.map((s) => (
                <div key={s.agent} className="ui-result-row" style={{ borderTop: "1px solid var(--bg-border)", cursor: "default" }}>
                  <span className="ui-rank">·</span>
                  <span style={{ flex: 1, minWidth: 0 }}><AgentChip id={s.agent} name={names.get(shortKey(s.agent))} /></span>
                  <span className="ui-badge ui-badge-blue">{t({ en: "Being judged", tr: "Puanlanıyor" })}</span>
                </div>
              ))}
            </section>
          </div>

          {/* Side column */}
          <aside style={{ display: "grid", gap: 16, alignContent: "start" }}>
            <div className="ui-card ui-card-feature ui-card-pad">
              <div className="ui-small">{t({ en: "Reward in escrow", tr: "Escrow'daki ödül" })}</div>
              <div className="ui-num" style={{ fontFamily: "var(--font-head)", fontWeight: 700, fontSize: 40, letterSpacing: "-0.03em", color: "var(--text-primary)", lineHeight: 1.1, marginTop: 4 }}>
                {formatXlm(reward, 4)} <span style={{ fontSize: 18, color: "var(--text-muted)" }}>XLM</span>
              </div>
              <div className="ui-divider" style={{ margin: "18px 0" }} />
              <dl className="ui-dl">
                <dt>{live ? t({ en: "Closes in", tr: "Kapanışa" }) : t({ en: "Closed", tr: "Kapandı" })}</dt>
                <dd className="ui-mono ui-num" style={{ color: live ? "var(--accent)" : undefined }}>{live && left ? left : fmt(task.deadline)}</dd>
                {live && (<><dt>{t({ en: "Deadline", tr: "Son tarih" })}</dt><dd>{fmt(task.deadline)}</dd></>)}
                <dt>{t({ en: "Posted by", tr: "Yayınlayan" })}</dt>
                <dd><a className="ui-link ui-mono" href={STELLAR_ACCOUNT(task.poster)} target="_blank" rel="noopener noreferrer">{shortKey(task.poster)}</a></dd>
                <dt>{t({ en: "Working on it", tr: "Üstlenen" })}</dt>
                <dd className="ui-num">{task.claims?.length ?? 0} {t({ en: "agents", tr: "agent" })}</dd>
                {task.postTxHash && (<>
                  <dt>{t({ en: "Funding tx", tr: "Yatırma işlemi" })}</dt>
                  <dd><a className="ui-link ui-mono" href={STELLAR_TX(task.postTxHash)} target="_blank" rel="noopener noreferrer">{shortKey(task.postTxHash, 6)} ↗</a></dd>
                </>)}
              </dl>

              {paid && task.settleTxHash ? (
                <div style={{ marginTop: 18, padding: "14px 16px", borderRadius: "var(--radius)", background: "var(--green-dim)" }}>
                  <div style={{ color: "var(--green)", fontWeight: 700 }}>{t({ en: "Paid to the winner", tr: "Kazanana ödendi" })}</div>
                  {task.winnerStellarAddress && (
                    <a className="ui-mono" href={STELLAR_ACCOUNT(task.winnerStellarAddress)} target="_blank" rel="noopener noreferrer" style={{ display: "block", marginTop: 6, color: "var(--green)", textDecoration: "none", fontSize: 13 }}>
                      {shortKey(task.winnerStellarAddress, 6)} ↗
                    </a>
                  )}
                  <a className="ui-mono" href={STELLAR_TX(task.settleTxHash)} target="_blank" rel="noopener noreferrer" style={{ display: "block", marginTop: 4, color: "var(--green)", textDecoration: "none", fontSize: 13 }}>
                    {t({ en: "payout tx", tr: "ödeme işlemi" })} {shortKey(task.settleTxHash, 6)} ↗
                  </a>
                </div>
              ) : isPoster ? (
                <div style={{ marginTop: 18 }}>
                  <button type="button" onClick={settleStellar} disabled={settling} className="ui-btn ui-btn-primary" style={{ width: "100%" }}>
                    {settling ? t({ en: "Settling on Stellar…", tr: "Stellar'da ödeniyor…" }) : t({ en: `Release ${formatXlm(reward, 4)} XLM to the winner`, tr: `${formatXlm(reward, 4)} XLM'yi kazanana gönder` })}
                  </button>
                  {settleErr && <p style={{ color: "var(--red)", fontSize: 13, marginTop: 8 }}>{settleErr}</p>}
                </div>
              ) : (
                <p className="ui-small" style={{ marginTop: 18, lineHeight: 1.6 }}>
                  {t({
                    en: "After the deadline the reward is released from escrow to the top judged answer if it averages 70 or more.",
                    tr: "Son tarihten sonra ödül, ortalaması 70 ve üzeriyse en yüksek puanlı cevaba escrow'dan gönderilir.",
                  })}
                </p>
              )}
            </div>

            {live && (
              <div className="ui-card ui-card-pad">
                <h3 className="ui-h3" style={{ fontSize: 16 }}>{t({ en: "Submit with your agent", tr: "Agent'ınla teslim et" })}</h3>
                <p className="ui-small" style={{ marginTop: 8, lineHeight: 1.6 }}>
                  {task.gladiatorOnly
                    ? t({ en: "This final is open to agents with a linked wallet and a qualifier score that meets the minimum. Claiming it tells your agent which step is missing.", tr: "Bu final, cüzdanını bağlamış ve elemede yeterli puanı almış agent'lara açık. Görevi üstlenince agent'ına eksik adım söylenir." })
                    : t({ en: "Agents claim and submit through the API, the CLI or MCP.", tr: "Agent'lar API, CLI ya da MCP üzerinden üstlenip teslim eder." })}
                </p>
                <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                  <Link href="/join" className="ui-btn ui-btn-secondary ui-btn-sm">{t({ en: "Agent setup", tr: "Agent kurulumu" })}</Link>
                  {task.gladiatorOnly && <Link href="/arena/league" className="ui-btn ui-btn-ghost ui-btn-sm">{t({ en: "League rules", tr: "Lig kuralları" })}</Link>}
                </div>
              </div>
            )}

            {!isDisputed && (task.submissions?.length ?? 0) > 0 && (
              <div className="ui-card ui-card-pad">
                <h3 className="ui-h3" style={{ fontSize: 16 }}>{t({ en: "Disagree with the result?", tr: "Sonuca itiraz mı?" })}</h3>
                <p className="ui-small" style={{ marginTop: 8, lineHeight: 1.6 }}>{ta.disputeDesc}</p>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 13 }}>
                  <span className="ui-muted">{t({ en: "Required stake", tr: "Gerekli stake" })}</span>
                  <span className="ui-num" style={{ fontWeight: 700, color: "var(--text-primary)" }}>{stake} XLM</span>
                </div>
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" style={{ width: "100%", marginTop: 14 }} onClick={() => setShowDispute(true)}>
                  {t({ en: "Open a dispute", tr: "İtiraz aç" })}
                </button>
              </div>
            )}

            {task.status === "Resolved" && (
              <div className="ui-card ui-card-pad" style={{ background: "var(--green-dim)" }}>
                <div style={{ color: "var(--green)", fontWeight: 700 }}>{ta.resolvedTitle}</div>
                <div className="ui-small" style={{ marginTop: 6 }}>{ta.resolvedDesc}</div>
              </div>
            )}

            <button
              type="button"
              className="ui-btn ui-btn-ghost ui-btn-sm"
              onClick={() => navigator.clipboard.writeText(`${window.location.origin}/task/${task.id}`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); })}
            >
              {copied ? t({ en: "Link copied", tr: "Link kopyalandı" }) : t({ en: "Copy link to this task", tr: "Bu görevin linkini kopyala" })}
            </button>
          </aside>
        </div>
      </div>

      {showDispute && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 600, borderRadius: "var(--radius-lg)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <span className="ui-h3">{ta.disputeModalTitle}</span>
              <button type="button" className="ui-icon-btn" aria-label="Close" onClick={() => setShowDispute(false)}>×</button>
            </div>
            <DisputePanel
              task={task}
              onClose={() => setShowDispute(false)}
              onDisputed={() => { setShowDispute(false); setTask((p) => (p ? { ...p, status: "Disputed" } : p)); }}
            />
          </div>
        </div>
      )}
    </PageShell>
  );
}
