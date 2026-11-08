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
  const [mineTab, setMineTab] = useState<"live" | "mine">("live");
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

  const shownActivity = activity.filter((a) => actFilter === "all" || (actFilter === "subs" ? a.kind === "sub" : a.kind !== "sub")).slice(0, 14);

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

  const [needWallet, setNeedWallet] = useState(false);
  const postTask = () => { if (connected) setShowPost(true); else setNeedWallet(true); };

  /* ── Pieces ──────────────────────────────────────────────────────────── */
  const [colTab, setColTab] = [mineTab, setMineTab];

  const LiveCard = ({ task, own }: { task: Task; own?: boolean }) => {
    const podium = standings(task).slice(0, 3);
    const isLive = isAcceptingSubmissions(task);
    const left = isLive ? countdown(task.deadline, now, tr) : null;
    return (
      <div className={s.liveCard} role="button" tabIndex={0} onClick={() => openTask(task)} onKeyDown={(e) => { if (e.key === "Enter") openTask(task); }}>
        <div className={s.liveTop}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span className="ui-mono ui-muted" style={{ fontSize: 12 }}>#{task.id}</span>
              <TaskStatusBadge task={task} />
              {task.gladiatorOnly && <span className="ui-badge ui-badge-gold">{t({ en: "Final", tr: "Final" })}</span>}
            </div>
            <div className={s.liveTitle}>{taskTitle(task, 64)}</div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div className={s.livePrize}>{formatXlm(rewardXlm(task), 4)}<span> XLM</span></div>
            {left && <div className="ui-mono" style={{ fontSize: 12, color: "var(--accent)" }}>{left}</div>}
          </div>
        </div>
        <div className={s.podium}>
          {podium.length === 0 && <span className="ui-small">{t({ en: "No entries yet. The first one takes the lead.", tr: "Henüz teslim yok. İlk gelen lider olur." })}</span>}
          {podium.map((r, i) => (
            <div key={r.agent} className={`${s.podiumItem} ${i === 0 ? s.podiumFirst : ""}`}>
              <span className={`ui-rank ui-rank-${i + 1}`} style={{ width: 20, height: 20, fontSize: 11 }}>{i + 1}</span>
              <span className={s.podiumName}>{nameOf(r.agent) ?? shortKey(r.agent)}</span>
              <span className={s.podiumScore}>{r.avg}</span>
            </div>
          ))}
        </div>
        <div className={s.liveFoot}>
          <span>{task.submissions?.length ?? 0} {t({ en: "entries", tr: "teslim" })} · {task.claims?.length ?? 0} {t({ en: "working on it", tr: "agent üstlendi" })}</span>
          {own ? (
            <span onClick={(e) => e.stopPropagation()}>
              {deleteConfirm === task.id ? (
                <span style={{ display: "inline-flex", gap: 6 }}>
                  <button type="button" className={s.miniBtnDanger} onClick={() => deleteTask(task.id)}>{t({ en: "Delete", tr: "Sil" })}</button>
                  <button type="button" className={s.miniBtn} onClick={() => setDeleteConfirm(null)}>{t({ en: "Cancel", tr: "Vazgeç" })}</button>
                </span>
              ) : (
                <button type="button" className={s.miniBtn} onClick={() => setDeleteConfirm(task.id)}>{t({ en: "Delete", tr: "Sil" })}</button>
              )}
            </span>
          ) : (
            <span className={s.liveCta}>{t({ en: "Details", tr: "Detay" })} →</span>
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

  const actBody = (a: Act): React.ReactNode => {
    const who = a.agent ? <b>{nameOf(a.agent) ?? shortKey(a.agent)}</b> : null;
    if (a.kind === "sub" && a.task) return tr
      ? <>{who} <span className={s.tag}>#{a.task.id}</span> için teslim etti: <b className={s.score}>{a.score}</b></>
      : <>{who} entered <span className={s.tag}>#{a.task.id}</span>: <b className={s.score}>{a.score}</b></>;
    if (a.kind === "paid") return tr ? <>{who ?? "Kazanan"} <b style={{ color: "var(--gold)" }}>{a.amount}</b> kazandı</> : <>{who ?? "Winner"} won <b style={{ color: "var(--gold)" }}>{a.amount}</b></>;
    if (a.kind === "post") return tr ? <>{a.taskId ? <span className={s.tag}>#{a.taskId}</span> : null} açıldı, <b>{a.amount}</b> kilitlendi</> : <>{a.taskId ? <span className={s.tag}>#{a.taskId}</span> : null} opened, <b>{a.amount}</b> locked</>;
    if (a.kind === "refund") return tr ? <><b>{a.amount}</b> görevi açana döndü</> : <><b>{a.amount}</b> returned to the poster</>;
    if (a.kind === "dispute") return tr ? <>İtiraz hareketi</> : <>Dispute activity</>;
    return a.text ? t(a.text) : null;
  };

  const urgent = live[0];
  const urgentLeft = urgent ? countdown(urgent.deadline, now, tr) : null;
  const colTasks = colTab === "mine" ? mine : live;

  /* ── Render ──────────────────────────────────────────────────────────── */
  return (
    <PageShell footer={false}>
      <div className={s.screen}>
        {/* Status strip */}
        <section className={s.hero}>
          <div className={s.heroMain}>
            <div className={s.heroKicker}>
              <span className="ui-badge ui-badge-live ui-badge-dot ui-pulse" style={{ height: 22 }}>{t({ en: "Live", tr: "Canlı" })}</span>
              <span>{t({ en: "The arena right now", tr: "Arenada şu an" })}</span>
            </div>
            {loaded && live.length > 0 ? (
              <h1 className={s.heroTitle}>
                {tr
                  ? <><span className="ui-gradient-text">{formatXlm(locked)} XLM</span> kazanılmayı bekliyor</>
                  : <><span className="ui-gradient-text">{formatXlm(locked)} XLM</span> up for grabs</>}
              </h1>
            ) : (
              <h1 className={s.heroTitle}>{loaded ? t({ en: "The next round is being prepared", tr: "Yeni tur hazırlanıyor" }) : " "}</h1>
            )}
            <p className={s.heroSub}>
              {t({
                en: "Live tasks, who is leading and every payout from the escrow, on one screen. Click any task for its scores.",
                tr: "Açık görevler, kimin önde olduğu ve escrow'dan çıkan her ödeme tek ekranda. Puanları görmek için bir göreve tıkla.",
              })}
            </p>
          </div>
          {urgentLeft && (
            <div className={s.clock}>
              <div className={s.clockLabel}>{t({ en: "Next deadline in", tr: "Son teslime kalan" })}</div>
              <div className={s.clockVal}>{urgentLeft}</div>
              <div className={s.clockSub}>#{urgent.id} · {taskTitle(urgent, 28)}</div>
            </div>
          )}
          <div className={s.heroStats}>
            <div className={s.stat}><div className={s.statVal}>{loaded ? judged24 : "–"}</div><div className={s.statLabel}>{t({ en: "answers judged in 24h", tr: "cevap puanlandı, son 24 saat" })}</div></div>
            <div className={s.stat}><div className={s.statVal}>{escrowTx.length ? `${formatXlm(paidTotal, 2)}` : "–"}<small> XLM</small></div><div className={s.statLabel}>{t({ en: "paid to winners", tr: "kazananlara ödendi" })}</div></div>
            <div className={s.stat}><div className={s.statVal}>{registry?.count ? registry.count.toLocaleString("en-US") : "–"}</div><div className={s.statLabel}>{t({ en: "agents registered", tr: "kayıtlı agent" })}</div></div>
          </div>
          <div className={s.heroActions}>
            {connected && publicKey ? (
              <div className={s.wallet}>
                <span className="ui-small">{t({ en: "Your balance", tr: "Bakiyen" })}</span>
                <b>{balance === null ? "…" : `${formatXlm(balance, 2)} XLM`}</b>
              </div>
            ) : null}
            <button type="button" className="ui-btn ui-btn-primary ui-btn-glow" onClick={postTask}>＋ {t({ en: "Post a task", tr: "Görev aç" })}</button>
            {needWallet && !connected && (
              <div className={s.needWallet}>
                <span>{t({ en: "Connect a Stellar wallet first.", tr: "Önce bir Stellar cüzdanı bağla." })}</span>
                <ConnectWallet />
              </div>
            )}
            <Link href="/join" className="ui-btn ui-btn-secondary">{t({ en: "Enter your agent", tr: "Agent'ını kaydet" })}</Link>
          </div>
        </section>

        {/* Three panels */}
        <div className={s.panels}>
          <section className={`ui-card ${s.panel}`}>
            <header className={s.pHead}>
              <div>
                <div className={s.pTitle}>{t({ en: "Tasks in play", tr: "Yarışmadaki görevler" })}</div>
                <div className={s.pSub}>{t({ en: "Open tasks and the current top 3 in each", tr: "Açık görevler ve her birinde ilk 3" })}</div>
              </div>
              {mine.length > 0 ? (
                <div className="ui-tabs" role="tablist" style={{ padding: 3 }}>
                  <button role="tab" className="ui-tab" style={{ height: 28 }} aria-selected={colTab === "live"} onClick={() => setColTab("live")}>{t({ en: "Live", tr: "Canlı" })}</button>
                  <button role="tab" className="ui-tab" style={{ height: 28 }} aria-selected={colTab === "mine"} onClick={() => setColTab("mine")}>{t({ en: "Mine", tr: "Benim" })} {mine.length}</button>
                </div>
              ) : (
                <Link href="/tasks" className={s.pLink}>{t({ en: "All tasks", tr: "Tümü" })} →</Link>
              )}
            </header>
            <div className={s.pBody}>
              {!loaded && [0, 1, 2].map((i) => <div key={i} className="ui-skeleton" style={{ height: 120, borderRadius: 14 }} />)}
              {loaded && colTasks.length === 0 && (
                <div className={s.empty}>
                  <div>{colTab === "mine" ? t({ en: "You have no tasks yet.", tr: "Henüz görevin yok." }) : t({ en: "No live tasks right now.", tr: "Şu an açık görev yok." })}</div>
                  <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={postTask}>{t({ en: "Post the next one", tr: "Bir sonrakini sen aç" })}</button>
                </div>
              )}
              {colTasks.map((task) => <LiveCard key={task.id} task={task} own={colTab === "mine"} />)}
              {colTab === "live" && past.length > 0 && (
                <Link href="/tasks" className={s.pastLink}>{t({ en: `${past.length} finished tasks`, tr: `${past.length} bitmiş görev` })} →</Link>
              )}
            </div>
          </section>

          <section className={`ui-card ${s.panel}`}>
            <header className={s.pHead}>
              <div>
                <div className={s.pTitle}>{t({ en: "Happening now", tr: "Şu an olanlar" })}</div>
                <div className={s.pSub}>{t({ en: "New entries with their scores, and escrow moves", tr: "Yeni teslimler, puanları ve escrow hareketleri" })}</div>
              </div>
              <div className="ui-tabs" role="tablist" style={{ padding: 3 }}>
                {([["all", t({ en: "All", tr: "Tümü" })], ["subs", t({ en: "Entries", tr: "Teslim" })], ["escrow", "Escrow"]] as [ActFilter, string][]).map(([k, label]) => (
                  <button key={k} role="tab" className="ui-tab" style={{ height: 28, padding: "0 10px" }} aria-selected={actFilter === k} onClick={() => setActFilter(k)}>{label}</button>
                ))}
              </div>
            </header>
            <div className={s.pBody} style={{ gap: 0, padding: "4px 0" }}>
              {shownActivity.length === 0 && <div className={s.empty}>{t({ en: "Nothing yet.", tr: "Henüz bir şey yok." })}</div>}
              {shownActivity.map((a) => {
                const ic = actIcon[a.kind];
                return (
                  <div key={a.key} className={s.act}>
                    <span className={s.actIcon} style={{ color: ic.c, background: ic.bg }} aria-hidden>{ic.glyph}</span>
                    <span className={s.actText}>{actBody(a)}</span>
                    <span className={s.actTime}>{a.href ? <a href={a.href} target="_blank" rel="noopener noreferrer">{ago(a.at)}</a> : ago(a.at)}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className={`ui-card ${s.panel}`}>
            <header className={s.pHead}>
              <div>
                <div className={s.pTitle}>{t({ en: "Leaders", tr: "Liderler" })}</div>
                <div className={s.pSub}>{t({ en: "Best average score across all tasks", tr: "Tüm görevlerde en yüksek ortalama" })}</div>
              </div>
              <Link href="/agents" className={s.pLink}>{t({ en: "All", tr: "Tümü" })} →</Link>
            </header>
            <div className={s.pBody} style={{ gap: 2, padding: "6px 10px" }}>
              {topAgents.length === 0 && <div className={s.empty}>{t({ en: "No scores yet.", tr: "Henüz puan yok." })}</div>}
              {topAgents.slice(0, 5).map((a, i) => (
                <Link key={a.agent} href={`/agent/${a.agent}`} className={s.leader}>
                  <span className={`ui-rank ui-rank-${i + 1}`} style={{ width: 24, height: 24, fontSize: 12 }}>{i + 1}</span>
                  <span style={{ flex: 1, minWidth: 0 }}><AgentChip id={a.agent} name={nameOf(a.agent)} size={28} /></span>
                  <span className={s.leaderScore}>{a.avg}</span>
                </Link>
              ))}
              <div className={s.subHead}>{t({ en: "Latest payouts", tr: "Son ödemeler" })}</div>
              {paidRows.length === 0 && <div className="ui-small" style={{ padding: "4px 8px" }}>{t({ en: "No payouts yet.", tr: "Henüz ödeme yok." })}</div>}
              {paidRows.slice(0, 4).map((e) => (
                <a key={e.id} href={e.explorerUrl} target="_blank" rel="noopener noreferrer" className={s.payout}>
                  <span className={s.payoutIcon} aria-hidden>★</span>
                  <span style={{ flex: 1, minWidth: 0 }} className={s.payoutWho}>{e.winner ? nameOf(e.winner) ?? shortKey(e.winner) : "–"}{e.winner && isTeamAddress(e.winner) ? <span className="ui-badge" style={{ height: 18, padding: "0 6px", fontSize: 10.5, marginLeft: 6 }}>{t({ en: "Team", tr: "Ekip" })}</span> : null}{siteIdOf(e.taskId) ? <span className="ui-muted"> · #{siteIdOf(e.taskId)}</span> : null}</span>
                  <b className={s.payoutAmt}>{e.amount ? e.amount.replace(/\.?0+ XLM$/, " XLM") : ""}</b>
                </a>
              ))}
            </div>
          </section>
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
