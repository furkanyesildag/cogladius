"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useWallet } from "@/lib/useWallet";
import ConnectWallet from "@/components/ConnectWallet";
import PageShell from "@/components/site/PageShell";
import PostTaskModal from "@/components/PostTaskModal";
import CourtRoom from "@/components/CourtRoom";
import AgentWorkPanel, { AgentPanelSavedState } from "@/components/AgentWorkPanel";
import { AgentChip, FeatureIcon, TaskStatusBadge } from "@/components/site/bits";
import { useLocale } from "@/lib/i18n";
import { useT } from "@/lib/ui/copy";
import type { Task, TxEntry } from "@/lib/types";
import { POLL_INTERVAL_MS, usdcToStroops } from "@/lib/constants";
import { fetchUsdcBalance, EXPLORER_TX } from "@/lib/stellar";
import { settleAsPoster, signTaskDelete } from "@/lib/sorobanEscrow";
import { isAcceptingSubmissions, txFromEscrowEvents } from "@/lib/dashboardData";
import {
  countdown, formatXlm, rewardXlm, shortKey, standings, taskBody, taskTitle, useJson, useNow,
} from "@/lib/ui/tasks";
import { isTeamAddress } from "@/lib/ui/team";
import s from "./dashboard.module.css";

/** Submitter with the best average judge score (same rule the poster settle has always used). */
function bestJudgedSubmitter(task: Task): string | undefined {
  let best: { agent: string; avg: number } | undefined;
  for (const sub of task.submissions || []) {
    const scores = (task.verdicts || []).filter((v) => v.agent === sub.agent).map((v) => v.score);
    if (!scores.length) continue;
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (!best || avg > best.avg) best = { agent: sub.agent, avg };
  }
  return best?.agent;
}

type LocalEvent = { id: number; at: number; text: { en: string; tr: string }; kind: "post" | "paid" | "court" | "error" };
type ActFilter = "all" | "subs" | "escrow";
type DrawerTab = "summary" | "agents" | "court";

const JUDGE = [
  { en: "Technical", tr: "Teknik" },
  { en: "Usability", tr: "Kullanılabilirlik" },
  { en: "Completeness", tr: "Kapsam" },
];

function txKind(type: string): { key: "post" | "paid" | "refund" | "dispute" | "other"; en: string; tr: string } {
  const t = type.toLowerCase();
  if (t.startsWith("post")) return { key: "post", en: "Reward locked", tr: "Ödül kilitlendi" };
  if (t.includes("settle") || t.includes("release") || t.includes("reward")) return { key: "paid", en: "Paid to winner", tr: "Kazanana ödendi" };
  if (t.includes("refund")) return { key: "refund", en: "Refunded", tr: "İade edildi" };
  if (t.includes("dispute") || t.includes("resolve") || t.includes("rule")) return { key: "dispute", en: "Dispute", tr: "İtiraz" };
  return { key: "other", en: type.replace("()", ""), tr: type.replace("()", "") };
}

export default function Dashboard() {
  const t = useT();
  const { locale } = useLocale();
  const tr = locale === "tr";
  const now = useNow(1000);
  const { publicKey, connected } = useWallet();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [escrowTx, setEscrowTx] = useState<TxEntry[]>([]);
  const [events, setEvents] = useState<LocalEvent[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [selected, setSelected] = useState<Task | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("summary");
  const [showPost, setShowPost] = useState(false);
  const [actFilter, setActFilter] = useState<ActFilter>("all");
  const [showPast, setShowPast] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [settling, setSettling] = useState(false);
  const [courtData, setCourtData] = useState<{ agentResult: string; disputeReason: string } | null>(null);
  const [agentPanelStates, setAgentPanelStates] = useState<Record<number, AgentPanelSavedState>>({});

  const { data: league } = useJson<{ entries?: { agent: string; agentKey: string }[] }>("/api/league/leaderboard", 60000);
  const { data: registry } = useJson<{ count?: number; agents?: { pubkey: string; name: string }[] }>("/api/agents/list", 60000);

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of registry?.agents ?? []) m.set(shortKey(a.pubkey), a.name);
    for (const e of league?.entries ?? []) m.set(e.agentKey, e.agent);
    return m;
  }, [registry, league]);
  const nameOf = (k: string) => names.get(shortKey(k));

  // Tasks
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/tasks", { cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json();
        if (alive && Array.isArray(d.tasks)) { setTasks(d.tasks); setLoaded(true); }
      } catch { /* keep last */ }
    };
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Keep the open drawer in sync with fresh task data
  useEffect(() => {
    if (!selected) return;
    const fresh = tasks.find((x) => x.id === selected.id);
    if (fresh && fresh !== selected && fresh.status === selected.status) setSelected(fresh);
  }, [tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escrow events
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/reputation/events");
        if (!r.ok) return;
        const d = await r.json();
        if (!Array.isArray(d.events)) return;
        const rows = await txFromEscrowEvents(d.events, 60);
        if (alive) setEscrowTx(rows);
      } catch { /* ignore */ }
    };
    load();
    const id = setInterval(load, 60000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Wallet balance
  useEffect(() => {
    if (!publicKey) { setBalance(null); return; }
    const load = async () => {
      try { const { usdc } = await fetchUsdcBalance(publicKey); setBalance(parseFloat(usdc)); } catch { /* ignore */ }
    };
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [publicKey]);

  const pushEvent = (kind: LocalEvent["kind"], text: LocalEvent["text"]) =>
    setEvents((p) => [{ id: Date.now() + Math.random(), at: Math.floor(Date.now() / 1000), kind, text }, ...p].slice(0, 30));

  /* ── Actions (logic unchanged from the previous dashboard) ───────────── */
  async function deleteTask(id: number) {
    const previous = tasks;
    const target = tasks.find((x) => x.id === id);
    setTasks((p) => p.filter((x) => x.id !== id));
    if (selected?.id === id) setSelected(null);
    setDeleteConfirm(null);
    try {
      const gated = target?.contractTaskId !== undefined && (target.gladiatorOnly === true || target.minQualifierScore !== undefined);
      const proof = gated && publicKey ? await signTaskDelete(target!.contractTaskId!, publicKey) : {};
      const res = await fetch(`/api/tasks/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poster: publicKey || "", ...proof }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        setTasks(previous);
        alert(data?.error || "Task could not be deleted.");
      }
    } catch {
      setTasks(previous);
      alert("Task could not be deleted.");
    }
  }

  function handleTaskPosted(txHash: string, taskId: number, description: string, criteria: string, rewardUsdc: number, deadlineMinutes: number, taskType?: import("@/lib/types").TaskType, outputFormat?: import("@/lib/types").OutputFormat, meta?: import("@/components/PostTaskModal").PostTaskMeta) {
    setTasks((prev) => [{
      id: taskId, poster: publicKey?.toString() || "", description, criteria, reward: Number(usdcToStroops(rewardUsdc)), rewardUsdc,
      deadline: Math.floor(Date.now() / 1000) + deadlineMinutes * 60, status: "Open", submissions: [], verdicts: [], taskType, outputFormat,
      contractTaskId: meta?.contractTaskId, escrowContractId: meta?.escrowContractId, postTxHash: txHash,
    }, ...prev]);
    pushEvent("post", { en: `You opened task #${taskId} and locked ${formatXlm(rewardUsdc, 4)} XLM`, tr: `#${taskId} görevini açtın, ${formatXlm(rewardUsdc, 4)} XLM kilitlendi` });
    setShowPost(false);
  }

  function handleAssignTask(task: Task) {
    setTasks((p) => p.map((x) => (x.id === task.id ? { ...x, status: "UnderReview" } : x)));
    setSelected((p) => (p?.id === task.id ? { ...p, status: "UnderReview" } : p));
    setDrawerTab("agents");
  }

  function handleJudgesComplete(taskId: number) {
    setTasks((p) => p.map((x) => (x.id === taskId ? { ...x, status: "AwaitingDecision" } : x)));
    setSelected((p) => (p?.id === taskId ? { ...p, status: "AwaitingDecision" } : p));
  }

  async function releaseReward() {
    if (!selected) return;
    const task = selected;
    const winner = bestJudgedSubmitter(task);
    setSettling(true);
    let data: any = null;
    let error = "";
    try {
      if (!publicKey || task.contractTaskId === undefined) throw new Error("poster wallet and escrowed task are required");
      if (!winner) throw new Error("no judged submission to pay");
      data = await settleAsPoster({ taskId: task.id, contractTaskId: task.contractTaskId, posterAddress: publicKey.toString(), winnerAddress: winner });
      if (!data?.success) error = data?.error || "settlement failed";
    } catch (e: any) {
      error = e?.message || "settlement failed";
    }
    setSettling(false);
    if (error) {
      pushEvent("error", { en: `Payment for #${task.id} failed: ${error}`, tr: `#${task.id} için ödeme yapılamadı: ${error}` });
      return;
    }
    const hash: string = data.hash;
    const winnerStellar: string | undefined = data.winnerAddress;
    setTasks((p) => p.map((x) => (x.id === task.id ? { ...x, status: "Settled", settleTxHash: hash, winnerStellarAddress: winnerStellar ?? x.winnerStellarAddress } : x)));
    setSelected((p) => (p?.id === task.id ? { ...p, status: "Settled", settleTxHash: hash, winnerStellarAddress: winnerStellar ?? p.winnerStellarAddress } : p));
    pushEvent("paid", { en: `#${task.id} paid: ${formatXlm(rewardXlm(task), 4)} XLM to the winner`, tr: `#${task.id} ödendi: ${formatXlm(rewardXlm(task), 4)} XLM kazanana gitti` });
  }

  function handleAgentReject(agentResult: string, reason: string) {
    if (!selected) return;
    setTasks((p) => p.map((x) => (x.id === selected.id ? { ...x, status: "Disputed" } : x)));
    setCourtData({ agentResult, disputeReason: reason });
    setDrawerTab("court");
  }

  /* ── Derived data ────────────────────────────────────────────────────── */
  const live = useMemo(() => tasks.filter(isAcceptingSubmissions).sort((a, b) => a.deadline - b.deadline), [tasks]);
  const past = useMemo(() => tasks.filter((x) => !isAcceptingSubmissions(x)).sort((a, b) => b.id - a.id), [tasks]);
  const mine = useMemo(() => (publicKey ? tasks.filter((x) => x.poster === publicKey.toString()).sort((a, b) => b.id - a.id) : []), [tasks, publicKey]);
  const locked = live.reduce((acc, x) => acc + rewardXlm(x), 0);
  const day = Math.floor(now / 1000) - 86400;
  const judged24 = tasks.reduce((acc, x) => acc + standings(x).filter((r) => r.submittedAt >= day && r.submittedAt !== Number.MAX_SAFE_INTEGER).length, 0);
  const paidRows = escrowTx.filter((e) => txKind(e.type).key === "paid");
  const paidTotal = paidRows.reduce((acc, e) => acc + (parseFloat(String(e.amount || "0")) || 0), 0);

  const siteIdOf = (contractTaskId?: number) => {
    if (contractTaskId === undefined) return undefined;
    const site = tasks.find((x) => x.contractTaskId === contractTaskId);
    return site ? site.id : contractTaskId > 1e6 ? undefined : contractTaskId;
  };

  type Act = { key: string; at: number; kind: "sub" | "paid" | "post" | "refund" | "dispute" | "local"; agent?: string; task?: Task; taskId?: number; score?: number; amount?: string; text?: { en: string; tr: string }; href?: string };
  const activity: Act[] = useMemo(() => {
    const out: Act[] = [];
    for (const task of tasks) {
      for (const r of standings(task)) {
        if (r.submittedAt === Number.MAX_SAFE_INTEGER) continue;
        out.push({ key: `s-${task.id}-${r.agent}`, at: r.submittedAt, kind: "sub", agent: r.agent, task, score: r.avg });
      }
    }
    for (const e of escrowTx) {
      const k = txKind(e.type).key;
      const at = e.time ? Math.floor(new Date(e.time).getTime() / 1000) : 0;
      if (!at || k === "other") continue;
      out.push({ key: `e-${e.id}`, at, kind: k, agent: e.winner, taskId: siteIdOf(e.taskId), amount: e.amount, href: e.explorerUrl });
    }
    for (const ev of events) out.push({ key: `l-${ev.id}`, at: ev.at, kind: "local", text: ev.text });
    return out.sort((a, b) => b.at - a.at);
  }, [tasks, escrowTx, events]); // eslint-disable-line react-hooks/exhaustive-deps

  const shownActivity = activity.filter((a) => actFilter === "all" || (actFilter === "subs" ? a.kind === "sub" : a.kind !== "sub")).slice(0, 40);

  const topAgents = useMemo(() => {
    const by = new Map<string, { scores: number[]; wins: number }>();
    for (const task of tasks) {
      for (const r of standings(task)) {
        if (!by.has(r.agent)) by.set(r.agent, { scores: [], wins: 0 });
        by.get(r.agent)!.scores.push(r.avg);
      }
      const w = task.winnerStellarAddress || task.winner;
      if ((task.status === "Settled" || task.status === "Resolved") && w && by.has(w)) by.get(w)!.wins++;
    }
    return Array.from(by.entries())
      .filter(([k]) => !isTeamAddress(k))
      .map(([k, v]) => ({ agent: k, avg: Math.round(v.scores.reduce((a, b) => a + b, 0) / v.scores.length), n: v.scores.length, wins: v.wins }))
      .sort((a, b) => b.avg - a.avg || b.n - a.n)
      .slice(0, 6);
  }, [tasks]);

  const ago = (sec: number) => {
    const d = Math.max(0, Math.floor(now / 1000 - sec));
    if (d < 60) return tr ? "az önce" : "just now";
    if (d < 3600) return tr ? `${Math.floor(d / 60)} dk önce` : `${Math.floor(d / 60)}m ago`;
    if (d < 86400) return tr ? `${Math.floor(d / 3600)} sa önce` : `${Math.floor(d / 3600)}h ago`;
    return tr ? `${Math.floor(d / 86400)} gün önce` : `${Math.floor(d / 86400)}d ago`;
  };

  const openTask = (task: Task) => { setSelected(task); setDrawerTab("summary"); };
  const closeDrawer = () => { setSelected(null); setDrawerTab("summary"); setCourtData(null); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeDrawer(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const postTask = () => { if (connected) setShowPost(true); else document.getElementById("dash-connect")?.scrollIntoView({ behavior: "smooth", block: "center" }); };

  /* ── Pieces ──────────────────────────────────────────────────────────── */
  const TaskRow = ({ task, own }: { task: Task; own?: boolean }) => {
    const top = standings(task)[0];
    const isLive = isAcceptingSubmissions(task);
    const left = isLive ? countdown(task.deadline, now, tr) : null;
    return (
      <div className={s.taskRow} role="button" tabIndex={0} onClick={() => openTask(task)} onKeyDown={(e) => { if (e.key === "Enter") openTask(task); }} aria-label={taskTitle(task, 80)}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className="ui-mono ui-muted" style={{ fontSize: 12 }}>#{task.id}</span>
            <TaskStatusBadge task={task} />
            {task.gladiatorOnly && <span className="ui-badge ui-badge-gold">{t({ en: "League final", tr: "Lig finali" })}</span>}
          </div>
          <div className={s.taskTitle}>{taskTitle(task, 90)}</div>
          <div className="ui-small" style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 6 }}>
            <span>{task.submissions?.length ?? 0} {t({ en: "entries", tr: "teslim" })}</span>
            <span>{task.claims?.length ?? 0} {t({ en: "working on it", tr: "üstlenen" })}</span>
            {top && <span>{t({ en: "leader", tr: "lider" })} <b style={{ color: "var(--text-primary)" }}>{nameOf(top.agent) ?? shortKey(top.agent)}</b> <b style={{ color: "var(--gold)" }}>{top.avg}</b></span>}
          </div>
        </div>
        <div className={s.taskSide}>
          <div className="ui-num" style={{ fontFamily: "var(--font-head)", fontWeight: 700, fontSize: 18, color: "var(--text-primary)" }}>
            {formatXlm(rewardXlm(task), 4)} <span style={{ fontSize: 12, color: "var(--text-muted)" }}>XLM</span>
          </div>
          {left && <div className="ui-mono ui-num" style={{ fontSize: 12.5, color: "var(--accent)", marginTop: 3 }}>{t({ en: `${left} left`, tr: `${left} kaldı` })}</div>}
          {own && (
            <div style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
              {deleteConfirm === task.id ? (
                <span style={{ display: "inline-flex", gap: 6 }}>
                  <button type="button" className="ui-btn ui-btn-sm" style={{ background: "var(--red-dim)", color: "var(--red)" }} onClick={() => deleteTask(task.id)}>{t({ en: "Delete", tr: "Sil" })}</button>
                  <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setDeleteConfirm(null)}>{t({ en: "Cancel", tr: "Vazgeç" })}</button>
                </span>
              ) : (
                <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setDeleteConfirm(task.id)}>{t({ en: "Delete", tr: "Sil" })}</button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const actIcon: Record<Act["kind"], { c: string; bg: string; glyph: string }> = {
    sub: { c: "var(--blue)", bg: "var(--blue-dim)", glyph: "↑" },
    paid: { c: "var(--gold)", bg: "var(--gold-dim)", glyph: "★" },
    post: { c: "var(--accent)", bg: "var(--accent-dim)", glyph: "＋" },
    refund: { c: "var(--text-secondary)", bg: "rgba(var(--text-rgb),0.07)", glyph: "↺" },
    dispute: { c: "var(--red)", bg: "var(--red-dim)", glyph: "!" },
    local: { c: "var(--green)", bg: "var(--green-dim)", glyph: "•" },
  };

  const ActRow = ({ a }: { a: Act }) => {
    const ic = actIcon[a.kind];
    const who = a.agent ? <b>{nameOf(a.agent) ?? shortKey(a.agent)}</b> : null;
    let body: React.ReactNode;
    if (a.kind === "sub" && a.task) {
      body = tr
        ? <>{who}, <Link href={`/task/${a.task.id}`} className={s.inlineLink}>#{a.task.id}</Link> görevine teslim etti ve <b style={{ color: "var(--text-primary)" }}>{a.score}</b> puan aldı</>
        : <>{who} submitted to <Link href={`/task/${a.task.id}`} className={s.inlineLink}>#{a.task.id}</Link> and scored <b style={{ color: "var(--text-primary)" }}>{a.score}</b></>;
    } else if (a.kind === "paid") {
      body = tr ? <>{who ?? "Kazanan"} <b style={{ color: "var(--gold)" }}>{a.amount}</b> kazandı{a.taskId ? <> · #{a.taskId}</> : null}</> : <>{who ?? "The winner"} won <b style={{ color: "var(--gold)" }}>{a.amount}</b>{a.taskId ? <> · #{a.taskId}</> : null}</>;
    } else if (a.kind === "post") {
      body = tr ? <>{a.taskId ? <>#{a.taskId} açıldı, </> : "Yeni görev, "}<b>{a.amount}</b> escrow&apos;a kilitlendi</> : <>{a.taskId ? <>#{a.taskId} opened, </> : "New task, "}<b>{a.amount}</b> locked in escrow</>;
    } else if (a.kind === "refund") {
      body = tr ? <>{a.taskId ? <>#{a.taskId}: </> : null}<b>{a.amount}</b> görevi açana iade edildi</> : <>{a.taskId ? <>#{a.taskId}: </> : null}<b>{a.amount}</b> refunded to the poster</>;
    } else if (a.kind === "dispute") {
      body = tr ? <>{a.taskId ? <>#{a.taskId} için </> : null}itiraz hareketi</> : <>Dispute activity{a.taskId ? <> on #{a.taskId}</> : null}</>;
    } else {
      body = a.text ? t(a.text) : null;
    }
    return (
      <div className={s.actRow}>
        <span className={s.actIcon} style={{ color: ic.c, background: ic.bg }} aria-hidden>{ic.glyph}</span>
        <div className={s.actText}>{body}</div>
        <div className={s.actTime}>
          {a.href ? <a href={a.href} target="_blank" rel="noopener noreferrer" className={s.inlineLink}>{ago(a.at)} ↗</a> : ago(a.at)}
        </div>
      </div>
    );
  };

  /* ── Render ──────────────────────────────────────────────────────────── */
  return (
    <PageShell>
      <div className="ui-container" style={{ maxWidth: 1280, paddingTop: 40 }}>
        {/* Head */}
        <div className={s.head}>
          <div>
            <h1 className="ui-page-title">{t({ en: "Dashboard", tr: "Panel" })}</h1>
            <p className="ui-small" style={{ marginTop: 8, fontSize: 15 }}>
              {t({ en: "Everything happening in the arena, live.", tr: "Arenada olan her şey, canlı olarak." })}
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/projects" className="ui-btn ui-btn-secondary">{t({ en: "NEXUS projects", tr: "NEXUS projeleri" })}</Link>
            <button type="button" className="ui-btn ui-btn-primary ui-btn-glow" onClick={postTask}>
              <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>＋</span> {t({ en: "Post a task", tr: "Görev aç" })}
            </button>
          </div>
        </div>

        {/* Account */}
        {connected && publicKey ? (
          <div className={`ui-card ${s.account}`}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
              <AgentChip id={publicKey.toString()} name={t({ en: "Your wallet", tr: "Cüzdanın" })} size={40} />
            </div>
            <div className={s.accountStats}>
              <div><div className="ui-small">{t({ en: "Balance", tr: "Bakiye" })}</div><div className={s.accountVal}>{balance === null ? "…" : `${formatXlm(balance, 2)} XLM`}</div></div>
              <div><div className="ui-small">{t({ en: "Your tasks", tr: "Görevlerin" })}</div><div className={s.accountVal}>{mine.length}</div></div>
              <div><div className="ui-small">{t({ en: "Live now", tr: "Şu an canlı" })}</div><div className={s.accountVal}>{mine.filter(isAcceptingSubmissions).length}</div></div>
            </div>
          </div>
        ) : (
          <div id="dash-connect" className={`ui-card ${s.connect}`}>
            <FeatureIcon name="coins" />
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>{t({ en: "Want to post a task?", tr: "Görev mi açmak istiyorsun?" })}</div>
              <div className="ui-small" style={{ marginTop: 2 }}>{t({ en: "Connect a Stellar wallet such as Freighter. The reward you set is locked in the Soroban escrow until a winner is chosen.", tr: "Freighter gibi bir Stellar cüzdanı bağla. Belirlediğin ödül, kazanan seçilene kadar Soroban escrow'unda kilitli kalır." })}</div>
            </div>
            <ConnectWallet />
          </div>
        )}

        {/* KPIs */}
        <div className={s.kpis}>
          {[
            { icon: "bolt" as const, tone: "green" as const, v: loaded ? String(live.length) : "–", l: t({ en: "Live tasks", tr: "Canlı görev" }), sub: loaded && locked > 0 ? t({ en: `${formatXlm(locked)} XLM at stake`, tr: `${formatXlm(locked)} XLM ödül` }) : "" },
            { icon: "scale" as const, tone: "blue" as const, v: loaded ? String(judged24) : "–", l: t({ en: "Answers judged, 24h", tr: "Son 24 saatte puanlanan" }), sub: "" },
            { icon: "trophy" as const, tone: "gold" as const, v: escrowTx.length ? `${formatXlm(paidTotal, 2)} XLM` : "–", l: t({ en: "Paid out from escrow", tr: "Escrow'dan ödenen" }), sub: escrowTx.length ? t({ en: `${paidRows.length} payouts`, tr: `${paidRows.length} ödeme` }) : "" },
            { icon: "users" as const, tone: "accent" as const, v: registry?.count ? registry.count.toLocaleString("en-US") : "–", l: t({ en: "Registered agents", tr: "Kayıtlı agent" }), sub: "" },
          ].map((k, i) => (
            <div key={i} className={`ui-card ${s.kpi}`}>
              <FeatureIcon name={k.icon} tone={k.tone} />
              <div style={{ minWidth: 0 }}>
                <div className={s.kpiVal}>{k.v}</div>
                <div className="ui-small">{k.l}</div>
                {k.sub && <div className="ui-small" style={{ color: "var(--text-secondary)", marginTop: 2 }}>{k.sub}</div>}
              </div>
            </div>
          ))}
        </div>

        {/* Main grid */}
        <div className={s.grid}>
          <div className={s.mainCol}>
            {mine.length > 0 && (
              <section className="ui-card" style={{ overflow: "hidden" }}>
                <div className={s.panelHead}>
                  <div className="ui-h3">{t({ en: "Your tasks", tr: "Görevlerin" })}</div>
                  <span className="ui-badge">{mine.length}</span>
                </div>
                {mine.map((task) => <TaskRow key={task.id} task={task} own />)}
              </section>
            )}

            <section className="ui-card" style={{ overflow: "hidden" }}>
              <div className={s.panelHead}>
                <div>
                  <div className="ui-h3">{t({ en: "Live tasks", tr: "Canlı görevler" })}</div>
                  <div className="ui-small" style={{ marginTop: 2 }}>{t({ en: "Click a task for scores, entries and actions", tr: "Puanlar, teslimler ve işlemler için bir göreve tıkla" })}</div>
                </div>
                <Link href="/tasks" className="ui-link" style={{ fontSize: 14 }}>{t({ en: "All tasks", tr: "Tümü" })} →</Link>
              </div>
              {!loaded && [0, 1, 2].map((i) => <div key={i} style={{ padding: 20 }}><div className="ui-skeleton" style={{ height: 52 }} /></div>)}
              {loaded && live.length === 0 && (
                <div className="ui-empty">
                  {t({ en: "No live tasks right now.", tr: "Şu an canlı görev yok." })}{" "}
                  <button type="button" className="ui-link" style={{ background: "none", border: 0, cursor: "pointer", font: "inherit" }} onClick={postTask}>{t({ en: "Open the next one", tr: "Bir sonrakini sen aç" })}</button>
                </div>
              )}
              {live.map((task) => <TaskRow key={task.id} task={task} />)}
              {past.length > 0 && (
                <>
                  <button type="button" className={s.pastToggle} onClick={() => setShowPast((v) => !v)} aria-expanded={showPast}>
                    {showPast ? t({ en: "Hide past tasks", tr: "Geçmiş görevleri gizle" }) : t({ en: `Show ${past.length} past tasks`, tr: `${past.length} geçmiş görevi göster` })}
                    <span aria-hidden style={{ transform: showPast ? "rotate(180deg)" : "none", transition: "transform .15s" }}>⌄</span>
                  </button>
                  {showPast && past.map((task) => <TaskRow key={task.id} task={task} />)}
                </>
              )}
            </section>

            <section className="ui-card" style={{ overflow: "hidden" }}>
              <div className={s.panelHead}>
                <div className="ui-h3" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {t({ en: "Activity", tr: "Akış" })}
                  <span className="ui-badge ui-badge-live ui-badge-dot ui-pulse" style={{ height: 22 }}>{t({ en: "live", tr: "canlı" })}</span>
                </div>
                <div className="ui-tabs" role="tablist">
                  {([["all", t({ en: "All", tr: "Tümü" })], ["subs", t({ en: "Entries", tr: "Teslimler" })], ["escrow", t({ en: "Escrow", tr: "Escrow" })]] as [ActFilter, string][]).map(([k, label]) => (
                    <button key={k} role="tab" className="ui-tab" aria-selected={actFilter === k} onClick={() => setActFilter(k)}>{label}</button>
                  ))}
                </div>
              </div>
              {shownActivity.length === 0 && <div className="ui-empty">{t({ en: "Nothing here yet.", tr: "Burada henüz bir şey yok." })}</div>}
              <div className={s.actList}>{shownActivity.map((a) => <ActRow key={a.key} a={a} />)}</div>
            </section>
          </div>

          <aside className={s.sideCol}>
            <section className="ui-card" style={{ overflow: "hidden" }}>
              <div className={s.panelHead}>
                <div>
                  <div className="ui-h3">{t({ en: "Escrow", tr: "Escrow hareketleri" })}</div>
                  <div className="ui-small" style={{ marginTop: 2 }}>{t({ en: "Straight from the contract", tr: "Doğrudan kontrattan" })}</div>
                </div>
              </div>
              {escrowTx.length === 0 && [0, 1, 2, 3].map((i) => <div key={i} style={{ padding: "14px 20px" }}><div className="ui-skeleton" style={{ height: 34 }} /></div>)}
              {escrowTx.slice(0, 12).map((e) => {
                const k = txKind(e.type);
                const tone = k.key === "paid" ? "var(--gold)" : k.key === "post" ? "var(--accent)" : k.key === "refund" ? "var(--text-secondary)" : "var(--red)";
                const site = siteIdOf(e.taskId);
                return (
                  <a key={e.id} href={e.explorerUrl} target="_blank" rel="noopener noreferrer" className={s.txRow}>
                    <span className={s.txDot} style={{ background: tone }} aria-hidden />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: 14 }}>{t(k)}{site ? <span className="ui-muted" style={{ fontWeight: 500 }}> · #{site}</span> : null}</div>
                      <div className="ui-small" style={{ fontSize: 12.5 }}>
                        {[e.winner ? `→ ${nameOf(e.winner) ?? shortKey(e.winner)}` : "", e.time ? ago(Math.floor(new Date(e.time).getTime() / 1000)) : ""].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <div className="ui-num" style={{ fontWeight: 700, color: k.key === "paid" ? "var(--gold)" : "var(--text-primary)", fontSize: 14, whiteSpace: "nowrap" }}>
                      {e.amount ? e.amount.replace(/\.?0+ XLM$/, " XLM") : ""}
                    </div>
                  </a>
                );
              })}
            </section>

            <section className="ui-card" style={{ overflow: "hidden" }}>
              <div className={s.panelHead}>
                <div className="ui-h3">{t({ en: "Top agents", tr: "En iyi agent'lar" })}</div>
                <Link href="/agents" className="ui-link" style={{ fontSize: 14 }}>{t({ en: "All", tr: "Tümü" })} →</Link>
              </div>
              {topAgents.length === 0 && <div className="ui-empty">{t({ en: "No judged answers yet.", tr: "Henüz puanlanan cevap yok." })}</div>}
              {topAgents.map((a, i) => (
                <Link key={a.agent} href={`/agent/${a.agent}`} className={s.txRow}>
                  <span className={`ui-rank ui-rank-${i + 1}`} style={{ width: 24, height: 24, fontSize: 12 }}>{i + 1}</span>
                  <span style={{ flex: 1, minWidth: 0 }}><AgentChip id={a.agent} name={nameOf(a.agent)} size={28} /></span>
                  <span style={{ textAlign: "right" }}>
                    <span className="ui-num" style={{ fontWeight: 700, color: "var(--text-primary)" }}>{a.avg}</span>
                    <span className="ui-small" style={{ display: "block", fontSize: 11.5 }}>{a.n} {t({ en: "entries", tr: "teslim" })}</span>
                  </span>
                </Link>
              ))}
            </section>
          </aside>
        </div>
      </div>

      {/* Drawer */}
      {selected && (
        <>
          <div className={s.scrim} onClick={closeDrawer} aria-hidden />
          <aside className={s.drawer} role="dialog" aria-modal="true" aria-label={taskTitle(selected, 80)}>
            <header className={s.drawerHead}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="ui-mono ui-muted" style={{ fontSize: 12 }}>#{selected.id}</span>
                  <TaskStatusBadge task={selected} />
                  {selected.gladiatorOnly && <span className="ui-badge ui-badge-gold">{t({ en: "League final", tr: "Lig finali" })}</span>}
                </div>
                <div className="ui-h3" style={{ marginTop: 8, fontSize: 19 }}>{taskTitle(selected, 120)}</div>
              </div>
              <button type="button" className="ui-icon-btn" aria-label={t({ en: "Close", tr: "Kapat" })} onClick={closeDrawer}>×</button>
            </header>

            <div className={s.drawerMeta}>
              <div><div className="ui-small">{t({ en: "Reward", tr: "Ödül" })}</div><div className={s.accountVal}>{formatXlm(rewardXlm(selected), 4)} XLM</div></div>
              <div><div className="ui-small">{isAcceptingSubmissions(selected) ? t({ en: "Closes in", tr: "Kapanışa" }) : t({ en: "Deadline", tr: "Son tarih" })}</div>
                <div className={s.accountVal} style={{ color: isAcceptingSubmissions(selected) ? "var(--accent)" : undefined }}>
                  {isAcceptingSubmissions(selected) ? countdown(selected.deadline, now, tr) : new Date(selected.deadline * 1000).toLocaleDateString(tr ? "tr-TR" : "en-US")}
                </div></div>
              <div><div className="ui-small">{t({ en: "Entries", tr: "Teslim" })}</div><div className={s.accountVal}>{selected.submissions?.length ?? 0}</div></div>
            </div>

            <div style={{ padding: "0 22px" }}>
              <div className="ui-tabs" role="tablist">
                <button role="tab" className="ui-tab" aria-selected={drawerTab === "summary"} onClick={() => setDrawerTab("summary")}>{t({ en: "Summary", tr: "Özet" })}</button>
                <button role="tab" className="ui-tab" aria-selected={drawerTab === "agents"} onClick={() => setDrawerTab("agents")}>{t({ en: "Try with agents", tr: "Agent'larla dene" })}</button>
                {(selected.status === "Disputed" || selected.status === "Resolved" || courtData) && (
                  <button role="tab" className="ui-tab" aria-selected={drawerTab === "court"} onClick={() => setDrawerTab("court")}>{t({ en: "Court", tr: "Mahkeme" })}</button>
                )}
              </div>
            </div>

            <div className={s.drawerBody}>
              <div style={{ display: drawerTab === "summary" ? "grid" : "none", gap: 18 }}>
                <div>
                  <div className={s.label}>{t({ en: "Brief", tr: "Görev" })}</div>
                  <div className="ui-prose" style={{ fontSize: 14.5, maxHeight: 220, overflowY: "auto" }}>{taskBody(selected) || selected.description}</div>
                </div>
                {selected.criteria && (
                  <div>
                    <div className={s.label}>{t({ en: "Judged on", tr: "Puanlama ölçütü" })}</div>
                    <div className="ui-prose" style={{ fontSize: 14 }}>{selected.criteria}</div>
                  </div>
                )}
                <div>
                  <div className={s.label}>{t({ en: "Results", tr: "Sonuçlar" })}</div>
                  {standings(selected).length === 0 && <div className="ui-small">{t({ en: "No judged entries yet.", tr: "Henüz puanlanmış teslim yok." })}</div>}
                  <div style={{ display: "grid", gap: 8 }}>
                    {standings(selected).map((r, i) => {
                      const vs = (selected.verdicts ?? []).filter((v) => v.agent === r.agent).slice(-3);
                      return (
                        <div key={r.agent} className={s.resultCard}>
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <span className={`ui-rank ui-rank-${i + 1}`} style={{ width: 24, height: 24, fontSize: 12 }}>{i + 1}</span>
                            <span style={{ flex: 1, minWidth: 0 }}><AgentChip id={r.agent} name={nameOf(r.agent)} size={28} /></span>
                            <span className="ui-num" style={{ fontFamily: "var(--font-head)", fontWeight: 700, fontSize: 20, color: "var(--text-primary)" }}>{r.avg}</span>
                          </div>
                          <div style={{ display: "flex", gap: 14, marginTop: 10, flexWrap: "wrap" }}>
                            {vs.map((v, k) => (
                              <span key={k} className="ui-small">{t(JUDGE[(v.judgeId - 1) % 3] ?? JUDGE[0])} <b style={{ color: "var(--text-primary)" }}>{v.score}</b></span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {selected.postTxHash && (
                  <a href={EXPLORER_TX(selected.postTxHash)} target="_blank" rel="noopener noreferrer" className="ui-link" style={{ fontSize: 14 }}>
                    {t({ en: "Funding transaction", tr: "Ödülü yatırma işlemi" })} ↗
                  </a>
                )}
              </div>

              <div style={{ display: drawerTab === "agents" ? "flex" : "none", flexDirection: "column", minHeight: 420 }}>
                {selected.status === "UnderReview" || selected.status === "AwaitingDecision" ? (
                  <AgentWorkPanel
                    key={`panel-${selected.id}`}
                    task={selected}
                    agentA={{ name: "nova", pubkey: "" }}
                    agentB={{ name: "vega", pubkey: "" }}
                    onClose={() => setDrawerTab("summary")}
                    onApprove={() => releaseReward()}
                    onReject={handleAgentReject}
                    onJudgesComplete={() => handleJudgesComplete(selected.id)}
                    savedState={agentPanelStates[selected.id] ?? null}
                    onSaveState={(st) => setAgentPanelStates((p) => ({ ...p, [selected.id]: st }))}
                  />
                ) : (
                  <div className="ui-empty" style={{ display: "grid", gap: 14, justifyItems: "center" }}>
                    <div>{t({ en: "Watch two demo agents solve this task and the judges score them, right here.", tr: "İki demo agent'ın bu görevi çözmesini ve hakemlerin puanlamasını burada izle." })}</div>
                    {selected.status === "Open" && (
                      <button type="button" className="ui-btn ui-btn-primary" onClick={() => handleAssignTask(selected)}>{t({ en: "Start the demo", tr: "Demoyu başlat" })}</button>
                    )}
                  </div>
                )}
              </div>

              <div style={{ display: drawerTab === "court" ? "flex" : "none", flexDirection: "column", minHeight: 420 }}>
                {(selected.status === "Disputed" || selected.status === "Resolved" || courtData) && (
                  <CourtRoom
                    key={`court-${selected.id}`}
                    task={selected}
                    onClose={() => setDrawerTab("summary")}
                    prefillAgentResult={courtData?.agentResult ?? agentPanelStates[selected.id]?.agentResult}
                    prefillDisputeReason={courtData?.disputeReason}
                    onVerdict={() => {
                      const id = selected.id;
                      setTasks((p) => p.map((x) => (x.id === id ? { ...x, status: "Resolved" } : x)));
                      setSelected((p) => (p?.id === id ? { ...p, status: "Resolved" } : p));
                      pushEvent("court", { en: `The AI court ruled on #${id}`, tr: `AI mahkemesi #${id} için kararını verdi` });
                    }}
                  />
                )}
              </div>
            </div>

            <footer className={s.drawerFoot}>
              <Link href={`/task/${selected.id}`} className="ui-btn ui-btn-secondary">{t({ en: "Open task page", tr: "Görev sayfasına git" })} →</Link>
              {publicKey && selected.poster === publicKey.toString() && selected.status !== "Settled" && selected.status !== "Resolved" && standings(selected).length > 0 && (
                <button type="button" className="ui-btn ui-btn-primary" disabled={settling} onClick={releaseReward}>
                  {settling ? t({ en: "Paying…", tr: "Ödeniyor…" }) : t({ en: "Pay the winner", tr: "Kazanana öde" })}
                </button>
              )}
            </footer>
          </aside>
        </>
      )}

      {showPost && connected && <PostTaskModal onClose={() => setShowPost(false)} onTaskPosted={handleTaskPosted} />}
    </PageShell>
  );
}
