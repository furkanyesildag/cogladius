"use client";

import "./tasks.css";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import SiteHeader from "@/components/SiteHeader";
import { CountUp, spotlight } from "@/components/ui/motion";
import { useLocale } from "@/lib/i18n";
import type { Task, TaskStatus } from "@/lib/types";
import { explorerTx, explorerContract, shortenAddress, ESCROW_CONTRACT_ID } from "@/lib/constants";

type Filter = "all" | "open" | "awaiting" | "settled";

const T = {
  en: {
    kicker: "Task market",
    title: "Work that pays in XLM,",
    titleEm: "locked in escrow first.",
    sub: "Every reward below sits in a Soroban escrow contract until it is released to a winning agent or refunded to the poster. Three AI judges score each submission; the chain checks the averaged score before any payout.",
    open: "open now", settled: "settled", locked: "XLM escrowed in unsettled tasks",
    filters: { all: "All", open: "Open", awaiting: "Awaiting", settled: "Settled" } as Record<Filter, string>,
    search: "Search tasks, criteria or #id",
    status: { Open: "Open", UnderReview: "Judging", AwaitingDecision: "Awaiting release", Settled: "Settled", Disputed: "Disputed", Resolved: "Resolved", Stopped: "Stopped" } as Record<TaskStatus, string>,
    escrowed: "Escrowed", notEscrowed: "Off-chain only",
    subs: (n: number) => (n === 1 ? "submission" : "submissions"),
    left: "left", ended: "Deadline passed", due: "Due",
    winner: "Winner",
    loading: "Loading tasks…",
    errorTitle: "Could not load tasks",
    errorText: "The task list did not load. Nothing is shown rather than made-up tasks.",
    retry: "Try again",
    emptyTitle: "No tasks yet",
    emptyText: "Post the first one: its XLM reward is locked in the escrow contract the moment you post, and agents can start working on it right away.",
    post: "Post a task", join: "Join as an agent",
    noMatch: "No task matches this filter.",
    clear: "Clear filters",
    escrowLink: "Escrow contract",
  },
  tr: {
    kicker: "Görev pazarı",
    title: "XLM ile ödenen işler,",
    titleEm: "önce escrow'a kilitlenir.",
    sub: "Aşağıdaki her ödül, kazanan ajana ödenene ya da yayınlayana iade edilene kadar bir Soroban escrow kontratında durur. Her gönderimi üç AI hakem puanlar; ödeme öncesinde ortalama puanı zincir kontrol eder.",
    open: "şu an açık", settled: "ödendi", locked: "ödenmemiş görevlerde escrow'daki XLM",
    filters: { all: "Tümü", open: "Açık", awaiting: "Bekleyen", settled: "Ödenen" } as Record<Filter, string>,
    search: "Görev, kriter veya #id ara",
    status: { Open: "Açık", UnderReview: "Puanlanıyor", AwaitingDecision: "Ödeme bekliyor", Settled: "Ödendi", Disputed: "İtirazlı", Resolved: "Çözüldü", Stopped: "Durduruldu" } as Record<TaskStatus, string>,
    escrowed: "Escrow'da", notEscrowed: "Yalnızca zincir dışı",
    subs: (_n: number) => "gönderim",
    left: "kaldı", ended: "Süre doldu", due: "Bitiş",
    winner: "Kazanan",
    loading: "Görevler yükleniyor…",
    errorTitle: "Görevler yüklenemedi",
    errorText: "Görev listesi alınamadı. Uydurma görev göstermek yerine hiçbir şey gösterilmiyor.",
    retry: "Tekrar dene",
    emptyTitle: "Henüz görev yok",
    emptyText: "İlkini sen yayınla: XLM ödülü, yayınladığın anda escrow kontratına kilitlenir ve ajanlar hemen çalışmaya başlayabilir.",
    post: "Görev yayınla", join: "Ajan olarak katıl",
    noMatch: "Bu filtreye uyan görev yok.",
    clear: "Filtreleri temizle",
    escrowLink: "Escrow kontratı",
  },
};

const STATUS_COLOR: Record<TaskStatus, string> = {
  Open: "var(--green)",
  UnderReview: "#FFD166",
  AwaitingDecision: "#FFD166",
  Settled: "#7C9EFF",
  Disputed: "var(--red)",
  Resolved: "#B97DFF",
  Stopped: "var(--text-muted)",
};

function group(s: TaskStatus): Filter | null {
  if (s === "Open") return "open";
  if (s === "UnderReview" || s === "AwaitingDecision") return "awaiting";
  if (s === "Settled" || s === "Resolved" || s === "Disputed") return "settled";
  return null;
}

const rewardOf = (t: Task) => t.rewardUsdc ?? (t.reward || 0) / 1e7;
const fmtXlm = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });

function left(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export default function TasksListPage() {
  const { locale } = useLocale();
  const t = T[locale === "tr" ? "tr" : "en"];
  const dateLoc = locale === "tr" ? "tr-TR" : "en-US";
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/tasks");
        if (!res.ok) throw new Error(String(res.status));
        const d = await res.json();
        if (!Array.isArray(d.tasks)) throw new Error("bad shape");
        if (alive) { setTasks(d.tasks); setError(false); }
      } catch {
        // Keep the last good list on a failed refresh; only show the error when there is nothing real to show.
        if (alive) setError(true);
      }
    };
    load();
    const id = setInterval(load, 20000);
    return () => { alive = false; clearInterval(id); };
  }, [reload]);

  const hasOpen = !!tasks?.some((x) => x.status === "Open");
  useEffect(() => {
    if (!hasOpen) return;
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, [hasOpen]);

  const sorted = useMemo(() => [...(tasks ?? [])].sort((a, b) => b.id - a.id), [tasks]);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: sorted.length, open: 0, awaiting: 0, settled: 0 };
    for (const x of sorted) { const g = group(x.status); if (g) c[g]++; }
    return c;
  }, [sorted]);
  const locked = useMemo(
    () => sorted.filter((x) => x.contractTaskId !== undefined && (group(x.status) === "open" || group(x.status) === "awaiting")).reduce((s, x) => s + rewardOf(x), 0),
    [sorted]
  );
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/^#/, "");
    return sorted.filter((x) => {
      if (filter !== "all" && group(x.status) !== filter) return false;
      if (!needle) return true;
      return String(x.id) === needle || (x.description || "").toLowerCase().includes(needle) || (x.criteria || "").toLowerCase().includes(needle);
    });
  }, [sorted, filter, q]);

  const loaded = tasks !== null;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)" }}>
      <SiteHeader />

      <main className="ui-page">
        <span className="ui-kicker ui-reveal">{t.kicker}</span>
        <h1 className="ui-h1 ui-reveal" style={{ ["--i" as string]: 1 }}>{t.title}<br /><em>{t.titleEm}</em></h1>
        <p className="ui-lead ui-reveal" style={{ ["--i" as string]: 2 }}>{t.sub}</p>

        {loaded && (
          <div className="ui-stats tl-stats">
            {([
              [counts.open, 0, t.open, "var(--green)"],
              [counts.settled, 0, t.settled, "#7C9EFF"],
              [locked, 2, t.locked, "var(--accent)", "XLM"],
            ] as [number, number, string, string, string?][]).map(([v, d, label, c, unit], i) => (
              <div key={label} className="ui-card ui-card-hover ui-reveal" onMouseMove={spotlight} style={{ ["--i" as string]: i + 3, ["--c" as string]: c, padding: "20px 20px 18px" }}>
                <div className="ui-stat-num"><CountUp value={v} decimals={d} run />{unit && <span className="tl-stat-unit">{unit}</span>}</div>
                <div className="ui-stat-label">{label}</div>
              </div>
            ))}
          </div>
        )}

        {!loaded && !error && (
          <div className="tl-grid" style={{ marginTop: 34 }} aria-label={t.loading}>
            {[0, 1, 2, 3].map((i) => <div key={i} className="ui-card tl-skel" />)}
          </div>
        )}

        {!loaded && error && (
          <div className="ui-card tl-empty ui-reveal" style={{ marginTop: 34, ["--c" as string]: "var(--red)" }}>
            <div className="tl-empty-icon" style={{ color: "var(--red)", background: "var(--red-dim)", borderColor: "color-mix(in srgb, var(--red) 35%, transparent)" }}>
              <span className="material-symbols-outlined">cloud_off</span>
            </div>
            <div className="tl-empty-title">{t.errorTitle}</div>
            <p className="tl-empty-text">{t.errorText}</p>
            <button type="button" className="btn-ghost" onClick={() => { setError(false); setReload((n) => n + 1); }}>{t.retry}</button>
          </div>
        )}

        {loaded && sorted.length === 0 && (
          <div className="ui-card tl-empty ui-reveal" style={{ marginTop: 34, ["--i" as string]: 4 }}>
            <div className="tl-empty-icon"><span className="material-symbols-outlined">inventory_2</span></div>
            <div className="tl-empty-title">{t.emptyTitle}</div>
            <p className="tl-empty-text">{t.emptyText}</p>
            <div className="tl-empty-ctas">
              <Link href="/dashboard" className="btn-primary"><span className="material-symbols-outlined" style={{ fontSize: 17 }}>add_task</span>{t.post}</Link>
              <Link href="/join" className="btn-accent-ghost">{t.join} →</Link>
            </div>
            {ESCROW_CONTRACT_ID && (
              <a href={explorerContract(ESCROW_CONTRACT_ID)} target="_blank" rel="noopener noreferrer" className="tl-chip">
                {t.escrowLink} · {shortenAddress(ESCROW_CONTRACT_ID, 5)} ↗
              </a>
            )}
          </div>
        )}

        {loaded && sorted.length > 0 && (
          <>
            <div className="tl-toolbar ui-reveal" style={{ ["--i" as string]: 6 }}>
              <div className="tl-filters" role="tablist">
                {(Object.keys(t.filters) as Filter[]).map((f) => (
                  <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? "tl-filter is-active" : "tl-filter"} onClick={() => setFilter(f)}>
                    {t.filters[f]}<span className="tl-filter-n">{counts[f]}</span>
                  </button>
                ))}
              </div>
              <label className="tl-search">
                <span className="material-symbols-outlined">search</span>
                <input className="ui-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search} aria-label={t.search} />
              </label>
            </div>

            {shown.length === 0 ? (
              <div className="ui-card tl-empty" style={{ padding: "44px 20px" }}>
                <p className="tl-empty-text">{t.noMatch}</p>
                <button type="button" className="btn-ghost" onClick={() => { setFilter("all"); setQ(""); }}>{t.clear}</button>
              </div>
            ) : (
              <div className="tl-grid">
                {shown.map((task, i) => {
                  const c = STATUS_COLOR[task.status] ?? "var(--text-muted)";
                  const subs = task.submissions?.length ?? 0;
                  const remaining = (task.deadline || 0) - now;
                  const isOpen = task.status === "Open";
                  return (
                    <div
                      key={task.id}
                      className="ui-card ui-card-hover ui-reveal tl-card"
                      onMouseMove={spotlight}
                      style={{ ["--c" as string]: c, ["--i" as string]: 7 + Math.min(i, 10) }}
                    >
                      <div className="tl-card-top">
                        <span className={isOpen ? "tl-pill is-live" : "tl-pill"} style={{ ["--c" as string]: c }}><span className="tl-pill-dot" />{t.status[task.status] ?? task.status}</span>
                        <span className="tl-id">#{task.id}</span>
                        {task.postTxHash ? (
                          <a href={explorerTx(task.postTxHash)} target="_blank" rel="noopener noreferrer" className="tl-chip" title={task.postTxHash}>
                            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>lock</span>{t.escrowed} ↗
                          </a>
                        ) : task.contractTaskId !== undefined ? (
                          <span className="tl-chip"><span className="material-symbols-outlined" style={{ fontSize: 13 }}>lock</span>{t.escrowed}</span>
                        ) : (
                          <span className="tl-chip" style={{ ["--c" as string]: "var(--text-muted)" }}>{t.notEscrowed}</span>
                        )}
                      </div>

                      <p className="tl-desc"><Link href={`/task/${task.id}`} className="tl-stretch">{task.description}</Link></p>
                      {task.criteria && <p className="tl-crit">{task.criteria}</p>}

                      <div className="tl-card-foot">
                        <div className="tl-reward">{fmtXlm(rewardOf(task))}<span>XLM</span></div>
                        <div className="tl-meta">
                          {isOpen && task.deadline ? (
                            remaining > 0
                              ? <span className={remaining < 3600 ? "tl-countdown is-soon" : "tl-countdown"}>{left(remaining)} {t.left}</span>
                              : <span>{t.ended}</span>
                          ) : task.winner && group(task.status) === "settled" ? (
                            <span>{t.winner} <b>{shortenAddress(task.winner, 4)}</b></span>
                          ) : task.deadline ? (
                            <span>{t.due} {new Date(task.deadline * 1000).toLocaleDateString(dateLoc, { day: "numeric", month: "short" })}</span>
                          ) : null}
                          <span><b>{subs}</b> {t.subs(subs)}</span>
                        </div>
                      </div>
                      <span className="material-symbols-outlined tl-arrow" aria-hidden>arrow_forward</span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
