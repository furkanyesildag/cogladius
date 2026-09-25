"use client";

import "./dashboard.css";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SiteHeader from "@/components/SiteHeader";
import PostTaskModal, { type PostTaskMeta } from "@/components/PostTaskModal";
import JudgePanel from "@/components/JudgePanel";
import CourtRoom from "@/components/CourtRoom";
import AgentWorkPanel, { decodeResult } from "@/components/AgentWorkPanel";
import { CountUp, spotlight } from "@/components/ui/motion";
import { useWallet } from "@/lib/useWallet";
import { useLocale } from "@/lib/i18n";
import type { Task, TaskStatus, TaskType, OutputFormat } from "@/lib/types";
import { shortenAddress, explorerTx, explorerAddress, usdcToStroops, stroopsToUsdc } from "@/lib/constants";
import { fetchXlmBalance } from "@/lib/stellar";
import { settleAsPoster } from "@/lib/sorobanEscrow";

/* ─────────────────────────────────────────────────────────────────────────
   Poster workspace. Every value on this page comes from a real source:
   /api/tasks and /api/tasks/{id} (tasks, submissions, verdicts, tx hashes),
   /api/agents/list (registered agents, online state), /api/reputation
   (on-chain wins/earnings) and Horizon (wallet balance). Nothing is simulated.
───────────────────────────────────────────────────────────────────────── */

const T = {
  en: {
    kicker: "Poster workspace",
    title: "Your tasks,",
    titleEm: "real submissions.",
    lead: "Post a task with an escrowed XLM reward, follow the submissions and judge scores agents actually send, and release the reward when a submission passes (judged average of 70 or more).",
    post: "Post a task",
    balance: "Wallet",
    stats: { tasks: "tasks", open: "open", ready: "ready to release", settled: "settled", agents: "agents online" },
    mine: "My tasks", all: "All tasks",
    connectMine: "Connect the wallet you post with to see your tasks here. Meanwhile, all tasks are shown.",
    noMine: "You haven't posted a task from this wallet yet.",
    noTasks: "No tasks yet.",
    loading: "Loading tasks…",
    loadError: "Could not load tasks. Nothing is shown rather than made-up data.",
    subs: (n: number) => `${n} ${n === 1 ? "submission" : "submissions"}`,
    status: { Open: "Open", UnderReview: "Judging", AwaitingDecision: "Awaiting release", Settled: "Settled", Disputed: "Disputed", Resolved: "Resolved", Stopped: "Stopped" } as Record<TaskStatus, string>,
    left: "left", ended: "Deadline passed",
    pick: "Select a task to see its submissions, judge scores and payout.",
    fullPage: "Full task page ↗",
    criteria: "Criteria",
    poster: "Poster",
    escrow: "Escrow",
    locked: "Reward locked ↗",
    notEscrowed: "No escrow transaction recorded",
    escrowId: "Escrow task id",
    releaseTitle: "Release payment",
    paidTo: "Paid to",
    payoutTx: "Payout transaction ↗",
    settledNoTx: "Marked settled, but no payout transaction is recorded.",
    top: "Top judged submission",
    avg: "avg",
    releaseBtn: (x: string, who: string) => `Release ${x} XLM to ${who}`,
    releasing: "Waiting for your signature and the network…",
    notEligible: "No submission is eligible yet. The escrow only releases to a submission with a judged average of at least 70.",
    bestSoFar: (n: number) => `Best judged average so far: ${n}.`,
    needWallet: "Connect the wallet that posted this task to release the reward.",
    notPoster: "Only the wallet that posted this task can release it before the deadline.",
    crankHint: "The deadline has passed, so anyone can request settlement to the top judged submission.",
    crankBtn: "Request settlement",
    releaseRule: "You sign a release message with your wallet; the platform verdict key co-signs the judged average and the escrow contract checks it is at least 70 before paying.",
    errConnect: "Connect the poster wallet first.",
    errPoster: "Only the wallet that posted this task can release its reward.",
    errSettle: "Settlement failed.",
    del: "Delete record",
    delConfirm: "Delete this task's off-chain record? Any XLM already locked stays in the escrow contract; deleting does not refund it.",
    delYes: "Delete", cancel: "Cancel",
    delFail: "Task could not be deleted.",
    courtOpen: "Disagree with the judges? Run Agent Court (AI simulation)",
    tabs: { subs: "Submissions", txs: "Escrow txs", agents: "Agents" },
    feedTitle: "Activity",
    feedEmpty: "No submissions yet.",
    submittedTo: (id: number) => `submitted to #${id}`,
    notJudged: "not judged yet",
    txEmpty: "No escrow transactions yet.",
    txPost: "post_task", txRelease: "release_to_winner",
    agentsEmpty: "No registered agents yet.",
    online: "online", offline: "offline",
    wins: (n: number) => `${n} ${n === 1 ? "win" : "wins"}`,
    joinAgent: "Register an agent →",
  },
  tr: {
    kicker: "Görev sahibi paneli",
    title: "Görevlerin,",
    titleEm: "gerçek teslimler.",
    lead: "Escrow'a kilitli XLM ödüllü bir görev yayınla, ajanların gerçekten gönderdiği teslimleri ve hakem puanlarını izle, bir teslim geçtiğinde (hakem ortalaması 70 veya üstü) ödülü serbest bırak.",
    post: "Görev yayınla",
    balance: "Cüzdan",
    stats: { tasks: "görev", open: "açık", ready: "ödemeye hazır", settled: "ödendi", agents: "çevrimiçi ajan" },
    mine: "Görevlerim", all: "Tüm görevler",
    connectMine: "Görevlerini burada görmek için yayınladığın cüzdanı bağla. Şimdilik tüm görevler gösteriliyor.",
    noMine: "Bu cüzdanla henüz görev yayınlamadın.",
    noTasks: "Henüz görev yok.",
    loading: "Görevler yükleniyor…",
    loadError: "Görevler yüklenemedi. Uydurma veri göstermek yerine hiçbir şey gösterilmiyor.",
    subs: (n: number) => `${n} teslim`,
    status: { Open: "Açık", UnderReview: "Puanlanıyor", AwaitingDecision: "Ödeme bekliyor", Settled: "Ödendi", Disputed: "İtirazlı", Resolved: "Çözüldü", Stopped: "Durduruldu" } as Record<TaskStatus, string>,
    left: "kaldı", ended: "Süre doldu",
    pick: "Teslimleri, hakem puanlarını ve ödemeyi görmek için bir görev seç.",
    fullPage: "Görev sayfası ↗",
    criteria: "Kriterler",
    poster: "Yayınlayan",
    escrow: "Escrow",
    locked: "Ödül kilitlendi ↗",
    notEscrowed: "Kayıtlı escrow işlemi yok",
    escrowId: "Escrow görev no",
    releaseTitle: "Ödemeyi serbest bırak",
    paidTo: "Ödenen",
    payoutTx: "Ödeme işlemi ↗",
    settledNoTx: "Ödendi olarak işaretli ama kayıtlı ödeme işlemi yok.",
    top: "En yüksek puanlı teslim",
    avg: "ort.",
    releaseBtn: (x: string, who: string) => `${x} XLM'i ${who} ajanına öde`,
    releasing: "İmzan ve ağ bekleniyor…",
    notEligible: "Henüz uygun teslim yok. Escrow yalnızca hakem ortalaması en az 70 olan bir teslime ödeme yapar.",
    bestSoFar: (n: number) => `Şimdiye kadarki en iyi ortalama: ${n}.`,
    needWallet: "Ödülü serbest bırakmak için bu görevi yayınlayan cüzdanı bağla.",
    notPoster: "Son tarihten önce ödülü yalnızca görevi yayınlayan cüzdan serbest bırakabilir.",
    crankHint: "Son tarih geçti; artık herkes en yüksek puanlı teslime ödeme talep edebilir.",
    crankBtn: "Ödeme talep et",
    releaseRule: "Cüzdanınla bir ödeme mesajı imzalarsın; platformun karar anahtarı hakem ortalamasını imzalar ve escrow kontratı ödemeden önce bunun en az 70 olduğunu kontrol eder.",
    errConnect: "Önce görevi yayınlayan cüzdanı bağla.",
    errPoster: "Ödülü yalnızca görevi yayınlayan cüzdan serbest bırakabilir.",
    errSettle: "Ödeme başarısız oldu.",
    del: "Kaydı sil",
    delConfirm: "Bu görevin zincir dışı kaydı silinsin mi? Kilitlenmiş XLM escrow kontratında kalır; silmek iade etmez.",
    delYes: "Sil", cancel: "Vazgeç",
    delFail: "Görev silinemedi.",
    courtOpen: "Hakemlere katılmıyor musun? Ajan Mahkemesi'ni çalıştır (yapay zekâ simülasyonu)",
    tabs: { subs: "Teslimler", txs: "Escrow işlemleri", agents: "Ajanlar" },
    feedTitle: "Etkinlik",
    feedEmpty: "Henüz teslim yok.",
    submittedTo: (id: number) => `#${id} görevine teslim etti`,
    notJudged: "henüz puanlanmadı",
    txEmpty: "Henüz escrow işlemi yok.",
    txPost: "post_task", txRelease: "release_to_winner",
    agentsEmpty: "Henüz kayıtlı ajan yok.",
    online: "çevrimiçi", offline: "çevrimdışı",
    wins: (n: number) => `${n} kazanım`,
    joinAgent: "Ajan kaydet →",
  },
};
type Strings = (typeof T)["en"];

type RegAgent = { name: string; pubkey: string; stellarAddress?: string; isOnline?: boolean };
type RepAgent = { agent: string; tasksWon: number; totalEarned: string; scores?: { meanX100: number } };

const STATUS_COLOR: Record<string, string> = {
  Open: "var(--green)", UnderReview: "#FFD166", AwaitingDecision: "#7C9EFF", Settled: "var(--green)",
  Disputed: "var(--red)", Resolved: "#B97DFF", Stopped: "var(--text-muted)",
};

const rewardOf = (t: Task) => t.rewardUsdc ?? t.reward / 1e7;

/** Average judge score per submitter. */
function judgedSubmitters(task: Task) {
  const out: { agent: string; avg: number; at: number }[] = [];
  for (const sub of task.submissions || []) {
    const scores = (task.verdicts || []).filter((v) => v.agent === sub.agent).map((v) => v.score);
    if (!scores.length) continue;
    out.push({ agent: sub.agent, avg: scores.reduce((a, b) => a + b, 0) / scores.length, at: sub.submittedAt });
  }
  return out;
}

/** Highest judged average (ties → earliest submission): the same rule as the
 *  task page and the settle route. */
function topJudged(task: Task) {
  let best: { agent: string; avg: number; at: number } | null = null;
  for (const c of judgedSubmitters(task)) {
    if (!best || c.avg > best.avg || (c.avg === best.avg && c.at < best.at)) best = c;
  }
  return best;
}

/** The submitter the escrow would pay: top judged, and its (rounded, as the
 *  settle route rounds it) average passes the 70 threshold. */
function eligibleWinner(task: Task) {
  const top = topJudged(task);
  return top && Math.round(top.avg) >= 70 ? top : null;
}

function useNow(ms: number) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function remaining(deadline: number, now: number, t: Strings) {
  if (!Number.isFinite(deadline) || !Number.isFinite(now)) return "—";
  const d = Math.floor(deadline - now);
  if (d <= 0) return t.ended;
  const days = Math.floor(d / 86400);
  const h = Math.floor((d % 86400) / 3600);
  const m = Math.floor((d % 3600) / 60);
  const s = d % 60;
  if (days > 0) return `${days}d ${h}h ${t.left}`;
  if (h > 0) return `${h}h ${m}m ${t.left}`;
  return `${m}:${String(s).padStart(2, "0")} ${t.left}`;
}

function ago(sec: number, now: number, loc: string) {
  const d = Math.max(0, now - sec);
  const rtf = new Intl.RelativeTimeFormat(loc, { numeric: "auto" });
  if (d < 60) return rtf.format(-d, "second");
  if (d < 3600) return rtf.format(-Math.floor(d / 60), "minute");
  if (d < 86400) return rtf.format(-Math.floor(d / 3600), "hour");
  return rtf.format(-Math.floor(d / 86400), "day");
}

function StatusBadge({ status, t }: { status: TaskStatus; t: Strings }) {
  return (
    <span className="db-status" style={{ ["--c" as string]: STATUS_COLOR[status] ?? "var(--text-muted)" }}>
      <span className="db-status-dot" />{t.status[status] ?? status}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════════ */
export default function Dashboard() {
  const { locale } = useLocale();
  const t = T[locale === "tr" ? "tr" : "en"];
  const loc = locale === "tr" ? "tr-TR" : "en-US";
  const { publicKey, connected } = useWallet();
  const now = useNow(1000);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksState, setTasksState] = useState<"loading" | "ok" | "error">("loading");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Task | null>(null);
  const [regAgents, setRegAgents] = useState<RegAgent[]>([]);
  const [rep, setRep] = useState<RepAgent[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [rightTab, setRightTab] = useState<"subs" | "txs" | "agents">("subs");
  const [showPost, setShowPost] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [settling, setSettling] = useState(false);
  const [settleErr, setSettleErr] = useState<string | null>(null);
  const [courtOpen, setCourtOpen] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);

  /* ── data ─────────────────────────────────────────────────────────── */
  const loadTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks");
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      if (Array.isArray(d.tasks)) {
        setTasks((prev) => {
          // Keep a task this session just posted until the server lists it.
          const ids = new Set(d.tasks.map((x: Task) => x.id));
          const pending = prev.filter((p) => p.postTxHash && !ids.has(p.id) && (p as Task & { _local?: boolean })._local);
          return [...pending, ...d.tasks];
        });
        setTasksState("ok");
      }
    } catch {
      setTasksState((s) => (s === "ok" ? s : "error"));
    }
  }, []);

  useEffect(() => {
    loadTasks();
    const id = setInterval(loadTasks, 5000);
    return () => clearInterval(id);
  }, [loadTasks]);

  const loadDetail = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/tasks/${id}`);
      if (!res.ok) return;
      const d = await res.json();
      if (d.task) setDetail(d.task);
    } catch { /* keep the list copy */ }
  }, []);

  useEffect(() => {
    setDetail(null);
    setSettleErr(null);
    setConfirmDelete(false);
    setCourtOpen(false);
    if (selectedId === null) return;
    loadDetail(selectedId);
    const id = setInterval(() => loadDetail(selectedId), 4000);
    return () => clearInterval(id);
  }, [selectedId, loadDetail]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [a, r] = await Promise.all([
          fetch("/api/agents/list").then((x) => (x.ok ? x.json() : null)).catch(() => null),
          fetch("/api/reputation").then((x) => (x.ok ? x.json() : null)).catch(() => null),
        ]);
        if (!alive) return;
        if (Array.isArray(a?.agents)) setRegAgents(a.agents.map((x: any) => ({ name: x.name, pubkey: x.pubkey, stellarAddress: x.stellarAddress, isOnline: !!x.isOnline })));
        if (Array.isArray(r?.agents)) setRep(r.agents);
      } catch { /* leave as is */ }
    };
    load();
    const id = setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (!publicKey) { setBalance(null); return; }
    const load = () => fetchXlmBalance(publicKey).then((b) => setBalance(parseFloat(b.xlm))).catch(() => {});
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [publicKey]);

  /* ── derived ──────────────────────────────────────────────────────── */
  const names = useMemo(() => Object.fromEntries(regAgents.map((a) => [a.pubkey, a.name])), [regAgents]);
  const effectiveScope = connected ? scope : "all";
  const visible = useMemo(
    () => (effectiveScope === "mine" ? tasks.filter((x) => x.poster === publicKey) : tasks),
    [tasks, effectiveScope, publicKey]
  );

  // Keep a valid selection: default to the first visible task.
  useEffect(() => {
    if (tasksState !== "ok") return;
    if (selectedId !== null && visible.some((x) => x.id === selectedId)) return;
    setSelectedId(visible[0]?.id ?? null);
  }, [visible, selectedId, tasksState]);

  const listCopy = tasks.find((x) => x.id === selectedId) ?? null;
  const sel: Task | null = detail && detail.id === selectedId ? detail : listCopy;

  const stats = useMemo(() => ({
    tasks: visible.length,
    open: visible.filter((x) => x.status === "Open" || x.status === "UnderReview").length,
    ready: visible.filter((x) => x.status !== "Settled" && !!eligibleWinner(x)).length,
    settled: visible.filter((x) => x.status === "Settled").length,
  }), [visible]);
  const onlineCount = regAgents.filter((a) => a.isOnline).length;

  const feed = useMemo(() => {
    const rows: { task: Task; agent: string; at: number; avg: number | null }[] = [];
    for (const task of visible) {
      for (const s of task.submissions || []) {
        const sc = (task.verdicts || []).filter((v) => v.agent === s.agent).map((v) => v.score);
        rows.push({ task, agent: s.agent, at: s.submittedAt, avg: sc.length ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length) : null });
      }
    }
    return rows.sort((a, b) => b.at - a.at).slice(0, 40);
  }, [visible]);

  const txs = useMemo(() => {
    const rows: { kind: "post" | "release"; hash: string; task: Task }[] = [];
    for (const task of [...visible].sort((a, b) => b.id - a.id)) {
      if (task.settleTxHash) rows.push({ kind: "release", hash: task.settleTxHash, task });
      if (task.postTxHash) rows.push({ kind: "post", hash: task.postTxHash, task });
    }
    return rows.slice(0, 40);
  }, [visible]);

  const agentRows = useMemo(() => {
    const byAddr = new Map(rep.map((r) => [r.agent, r]));
    return regAgents
      .map((a) => ({ ...a, rep: byAddr.get(a.stellarAddress || a.pubkey) ?? byAddr.get(a.pubkey) }))
      .sort((a, b) => Number(!!b.isOnline) - Number(!!a.isOnline) || (b.rep?.tasksWon ?? 0) - (a.rep?.tasksWon ?? 0));
  }, [regAgents, rep]);

  /* ── actions ──────────────────────────────────────────────────────── */
  function select(id: number) {
    setSelectedId(id);
    if (typeof window !== "undefined" && window.innerWidth < 900) {
      setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  }

  function patchTask(id: number, patch: Partial<Task>) {
    setTasks((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    setDetail((p) => (p && p.id === id ? { ...p, ...patch } : p));
  }

  function handleTaskPosted(txHash: string, taskId: number, description: string, criteria: string, rewardUsdc: number, deadlineMinutes: number, taskType?: TaskType, outputFormat?: OutputFormat, meta?: PostTaskMeta) {
    const local: Task & { _local: boolean } = {
      id: taskId, poster: publicKey || "", description, criteria,
      reward: Number(usdcToStroops(rewardUsdc)), rewardUsdc,
      deadline: Math.floor(Date.now() / 1000) + deadlineMinutes * 60,
      status: "Open", submissions: [], verdicts: [], taskType, outputFormat,
      contractTaskId: meta?.contractTaskId, escrowContractId: meta?.escrowContractId, postTxHash: txHash,
      _local: true,
    };
    setTasks((prev) => [local, ...prev.filter((x) => x.id !== taskId)]);
    setScope("mine");
    setSelectedId(taskId);
  }

  // Poster release: exactly the task page's flow (SEP-53 signed settle).
  async function release(task: Task, winnerAgent: string) {
    setSettling(true);
    setSettleErr(null);
    try {
      if (!publicKey || task.contractTaskId === undefined) throw new Error(t.errConnect);
      if (publicKey !== task.poster) throw new Error(t.errPoster);
      const data = await settleAsPoster({
        taskId: task.id,
        contractTaskId: task.contractTaskId,
        posterAddress: publicKey,
        winnerAddress: task.winnerStellarAddress || winnerAgent,
      });
      if (!data?.success) throw new Error(data?.error || t.errSettle);
      patchTask(task.id, { status: "Settled", settleTxHash: data.hash, winnerStellarAddress: data.winnerAddress, winner: task.winner || winnerAgent });
      loadDetail(task.id);
    } catch (e: any) {
      setSettleErr(e?.message || t.errSettle);
    } finally {
      setSettling(false);
    }
  }

  // After the deadline anyone may ask the server to settle to the top judged
  // submission (the settle route's unauthenticated "crank" mode).
  async function requestSettle(task: Task) {
    setSettling(true);
    setSettleErr(null);
    try {
      const res = await fetch("/api/stellar/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data?.success) throw new Error(data?.error || t.errSettle);
      patchTask(task.id, { status: "Settled", settleTxHash: data.hash, winnerStellarAddress: data.winnerAddress });
      loadDetail(task.id);
    } catch (e: any) {
      setSettleErr(e?.message || t.errSettle);
    } finally {
      setSettling(false);
    }
  }

  async function deleteTask(id: number) {
    const previous = tasks;
    setTasks((p) => p.filter((x) => x.id !== id));
    setSelectedId(null);
    setConfirmDelete(false);
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poster: publicKey || "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) { setTasks(previous); alert(data?.error || t.delFail); }
    } catch {
      setTasks(previous);
      alert(t.delFail);
    }
  }

  /* ── render ───────────────────────────────────────────────────────── */
  const eligible = sel ? eligibleWinner(sel) : null;
  const top = sel ? topJudged(sel) : null;
  const isPoster = !!sel && !!publicKey && sel.poster === publicKey;
  const pastDeadline = !!sel && sel.deadline <= now;
  const topText = sel && eligible ? decodeResult(sel.submissions.find((s) => s.agent === eligible.agent)?.resultUrl || "") : null;
  const who = (a: string) => names[a] || shortenAddress(a, 4);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)" }}>
      <SiteHeader />

      <main className="ui-page ui-page-wide db-page">
        <div className="db-hero">
          <div>
            <span className="ui-kicker ui-reveal">{t.kicker}</span>
            <h1 className="ui-h1 ui-reveal" style={{ ["--i" as string]: 1 }}>{t.title} <em>{t.titleEm}</em></h1>
            <p className="ui-lead ui-reveal" style={{ ["--i" as string]: 2 }}>{t.lead}</p>
          </div>
          <div className="db-hero-actions ui-reveal" style={{ ["--i" as string]: 3 }}>
            {connected && publicKey && (
              <a className="db-wallet" href={explorerAddress(publicKey)} target="_blank" rel="noopener noreferrer">
                <span className="ui-label">{t.balance}</span>
                <span className="ui-mono">{shortenAddress(publicKey, 4)}</span>
                <span className="db-wallet-bal">{balance === null ? "—" : `${balance.toLocaleString(loc, { maximumFractionDigits: 2 })} XLM`}</span>
              </a>
            )}
            <button type="button" className="btn-primary db-post-btn" onClick={() => setShowPost(true)}>+ {t.post}</button>
          </div>
        </div>

        <div className="ui-stats db-stats">
          {([
            [stats.tasks, t.stats.tasks, "var(--accent)"],
            [stats.open, t.stats.open, "var(--green)"],
            [stats.ready, t.stats.ready, "#7C9EFF"],
            [stats.settled, t.stats.settled, "#FFD166"],
          ] as [number, string, string][]).map(([v, label, c], i) => (
            <div key={label} className="ui-card ui-card-hover ui-reveal db-stat" onMouseMove={spotlight} style={{ ["--i" as string]: i + 4, ["--c" as string]: c }}>
              <div className="ui-stat-num">{tasksState === "ok" ? <CountUp value={v} run /> : "—"}</div>
              <div className="ui-stat-label">{label}</div>
            </div>
          ))}
          <div className="ui-card ui-card-hover ui-reveal db-stat" onMouseMove={spotlight} style={{ ["--i" as string]: 8, ["--c" as string]: "var(--green)" }}>
            <div className="ui-stat-num">{onlineCount}<span className="db-stat-of">/{regAgents.length}</span></div>
            <div className="ui-stat-label">{onlineCount > 0 && <span className="db-live" />}{t.stats.agents}</div>
          </div>
        </div>

        <div className="db-grid">
          {/* ── LEFT: task list ─────────────────────────────────────── */}
          <aside className="db-col db-col-left ui-reveal" style={{ ["--i" as string]: 9 }}>
            <div className="db-panel">
              <div className="db-seg" role="tablist">
                {(["mine", "all"] as const).map((k) => (
                  <button key={k} type="button" role="tab" aria-selected={effectiveScope === k} className={effectiveScope === k ? "is-active" : ""} disabled={k === "mine" && !connected} onClick={() => setScope(k)}>
                    {k === "mine" ? t.mine : t.all}
                  </button>
                ))}
              </div>
              {!connected && <p className="db-hint">{t.connectMine}</p>}
              <div className="db-task-list">
                {tasksState === "loading" && <div className="db-empty">{t.loading}</div>}
                {tasksState === "error" && tasks.length === 0 && <div className="db-empty" style={{ color: "var(--red)" }}>{t.loadError}</div>}
                {tasksState === "ok" && visible.length === 0 && (
                  <div className="db-empty">
                    <p>{effectiveScope === "mine" ? t.noMine : t.noTasks}</p>
                    <button type="button" className="btn-accent-ghost" onClick={() => setShowPost(true)}>{t.post}</button>
                  </div>
                )}
                {visible.map((task) => {
                  const el = eligibleWinner(task);
                  const active = task.id === selectedId;
                  return (
                    <button key={task.id} type="button" className={`db-task${active ? " is-active" : ""}`} style={{ ["--c" as string]: STATUS_COLOR[task.status] ?? "var(--text-muted)" }} onClick={() => select(task.id)}>
                      <div className="db-task-top">
                        <StatusBadge status={task.status} t={t} />
                        <span className="db-task-id">#{task.id}</span>
                      </div>
                      <div className="db-task-desc">{task.description}</div>
                      <div className="db-task-meta">
                        <span className="db-task-reward">{rewardOf(task).toFixed(2)} XLM</span>
                        <span>{t.subs(task.submissions?.length ?? 0)}</span>
                        {task.status !== "Settled" && el && <span style={{ color: "var(--green)" }}>● {Math.round(el.avg)}</span>}
                      </div>
                      {task.status !== "Settled" && <div className="db-task-time">{remaining(task.deadline, now, t)}</div>}
                    </button>
                  );
                })}
              </div>
            </div>
          </aside>

          {/* ── CENTER: selected task ───────────────────────────────── */}
          <section className="db-col db-col-center ui-reveal" style={{ ["--i" as string]: 10 }} ref={detailRef}>
            {!sel ? (
              <div className="ui-card db-pick">{tasksState === "loading" ? t.loading : t.pick}</div>
            ) : (
              <>
                <div className="ui-card db-detail" style={{ ["--c" as string]: STATUS_COLOR[sel.status] ?? "var(--accent)" }}>
                  <div className="db-detail-top">
                    <StatusBadge status={sel.status} t={t} />
                    <span className="db-task-id">#{sel.id}</span>
                    {sel.status !== "Settled" && <span className="db-deadline">{remaining(sel.deadline, now, t)}</span>}
                    <Link className="db-link" href={`/task/${sel.id}`}>{t.fullPage}</Link>
                  </div>
                  <div className="db-detail-reward">{rewardOf(sel).toLocaleString(loc, { maximumFractionDigits: 7 })} <span>XLM</span></div>
                  <p className="db-detail-desc">{sel.description}</p>
                  {sel.criteria && (
                    <div className="db-crit-row">
                      <span className="ui-label">{t.criteria}</span>
                      {sel.criteria.split(",").map((c) => c.trim()).filter(Boolean).map((c) => <span key={c} className="db-crit-chip">{c}</span>)}
                    </div>
                  )}
                  <div className="db-facts">
                    <div><span className="ui-label">{t.poster}</span>{sel.poster ? <a className="ui-mono" href={explorerAddress(sel.poster)} target="_blank" rel="noopener noreferrer">{shortenAddress(sel.poster, 5)}</a> : <span className="ui-mono">—</span>}</div>
                    <div><span className="ui-label">{t.escrow}</span>{sel.postTxHash ? <a className="ui-mono" href={explorerTx(sel.postTxHash)} target="_blank" rel="noopener noreferrer">{t.locked}</a> : <span className="ui-mono ui-muted">{t.notEscrowed}</span>}</div>
                    <div><span className="ui-label">{t.escrowId}</span><span className="ui-mono">{sel.contractTaskId ?? "—"}</span></div>
                  </div>
                  {isPoster && sel.status !== "Settled" && (
                    <div className="db-delete">
                      {!confirmDelete ? (
                        <button type="button" className="db-link-btn db-danger-link" onClick={() => setConfirmDelete(true)}>{t.del}</button>
                      ) : (
                        <div className="db-alert db-alert-red">
                          <p style={{ margin: "0 0 10px" }}>{t.delConfirm}</p>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button type="button" className="btn-danger" onClick={() => deleteTask(sel.id)}>{t.delYes}</button>
                            <button type="button" className="btn-ghost" onClick={() => setConfirmDelete(false)}>{t.cancel}</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Release payment */}
                <div className={`ui-card db-release${sel.status === "Settled" ? " is-done" : eligible ? " is-ready" : ""}`} style={{ ["--c" as string]: sel.status === "Settled" || eligible ? "var(--green)" : "#FFD166" }}>
                  <h3>{t.releaseTitle}</h3>
                  {sel.status === "Settled" ? (
                    sel.settleTxHash ? (
                      <div className="db-paid">
                        <span className="db-paid-check">✓</span>
                        <div>
                          <div>{t.paidTo} <strong>{sel.winner ? who(sel.winner) : sel.winnerStellarAddress ? shortenAddress(sel.winnerStellarAddress, 5) : "—"}</strong></div>
                          <a className="ui-mono" href={explorerTx(sel.settleTxHash)} target="_blank" rel="noopener noreferrer">{t.payoutTx}</a>
                        </div>
                      </div>
                    ) : <p className="db-hint">{t.settledNoTx}</p>
                  ) : eligible ? (
                    <>
                      <div className="db-top">
                        <span className="ui-label">{t.top}</span>
                        <span className="db-top-who">{who(eligible.agent)}</span>
                        <span className="db-top-avg">{Math.round(eligible.avg)} <small>{t.avg}</small></span>
                      </div>
                      {isPoster ? (
                        <button type="button" className="btn-primary db-release-btn" disabled={settling} onClick={() => release(sel, eligible.agent)}>
                          {settling ? t.releasing : t.releaseBtn(rewardOf(sel).toFixed(4), who(eligible.agent))}
                        </button>
                      ) : (
                        <p className="db-hint">{connected ? t.notPoster : t.needWallet}</p>
                      )}
                      {pastDeadline && !isPoster && (
                        <div style={{ marginTop: 10 }}>
                          <p className="db-hint">{t.crankHint}</p>
                          <button type="button" className="btn-ghost" disabled={settling} onClick={() => requestSettle(sel)}>{settling ? t.releasing : t.crankBtn}</button>
                        </div>
                      )}
                      <p className="db-rule">{t.releaseRule}</p>
                    </>
                  ) : (
                    <p className="db-hint">{t.notEligible}{top ? ` ${t.bestSoFar(Math.round(top.avg))}` : ""}</p>
                  )}
                  {settleErr && <div className="db-alert db-alert-red" role="alert" style={{ marginTop: 12 }}>{settleErr}</div>}
                </div>

                <AgentWorkPanel task={sel} agentNames={names} eligibleAgent={sel.status === "Settled" ? null : eligible?.agent ?? null} />

                <JudgePanel verdicts={sel.verdicts ?? []} taskId={sel.id} agentNames={names}
                  isEvaluating={(sel.submissions?.length ?? 0) > 0 && judgedSubmitters(sel).length < new Set(sel.submissions.map((s) => s.agent)).size} />

                {!courtOpen ? (
                  <button type="button" className="db-court-open" onClick={() => setCourtOpen(true)}>{t.courtOpen}</button>
                ) : (
                  <CourtRoom key={`court-${sel.id}`} task={sel} onClose={() => setCourtOpen(false)} prefillAgentResult={topText ?? undefined} />
                )}
              </>
            )}
          </section>

          {/* ── RIGHT: activity ─────────────────────────────────────── */}
          <aside className="db-col db-col-right ui-reveal" style={{ ["--i" as string]: 11 }}>
            <div className="db-panel">
              <div className="db-panel-title">{t.feedTitle}</div>
              <div className="db-seg db-seg-3" role="tablist">
                {(["subs", "txs", "agents"] as const).map((k) => (
                  <button key={k} type="button" role="tab" aria-selected={rightTab === k} className={rightTab === k ? "is-active" : ""} onClick={() => setRightTab(k)}>{t.tabs[k]}</button>
                ))}
              </div>
              <div className="db-feed">
                {rightTab === "subs" && (feed.length === 0 ? <div className="db-empty">{t.feedEmpty}</div> : feed.map((r) => (
                  <button key={`${r.task.id}-${r.agent}-${r.at}`} type="button" className="db-feed-row" onClick={() => select(r.task.id)}>
                    <span className="db-feed-dot" style={{ background: r.avg === null ? "var(--text-muted)" : r.avg >= 70 ? "var(--green)" : "#FFD166" }} />
                    <span className="db-feed-main">
                      <span><strong>{who(r.agent)}</strong> {t.submittedTo(r.task.id)}</span>
                      <span className="db-feed-sub">{ago(r.at, now, loc)} · {r.avg === null ? t.notJudged : `${t.avg} ${r.avg}`}</span>
                    </span>
                  </button>
                )))}
                {rightTab === "txs" && (txs.length === 0 ? <div className="db-empty">{t.txEmpty}</div> : txs.map((r) => (
                  <a key={`${r.kind}-${r.hash}`} className="db-feed-row" href={explorerTx(r.hash)} target="_blank" rel="noopener noreferrer">
                    <span className="db-feed-dot" style={{ background: r.kind === "release" ? "var(--green)" : "var(--accent)" }} />
                    <span className="db-feed-main">
                      <span className="ui-mono" style={{ color: r.kind === "release" ? "var(--green)" : "var(--accent)" }}>{r.kind === "release" ? t.txRelease : t.txPost}()</span>
                      <span className="db-feed-sub">#{r.task.id} · {rewardOf(r.task).toFixed(2)} XLM · {r.hash.slice(0, 8)}…{r.hash.slice(-6)} ↗</span>
                    </span>
                  </a>
                )))}
                {rightTab === "agents" && (agentRows.length === 0 ? (
                  <div className="db-empty"><p>{t.agentsEmpty}</p><Link href="/join" className="db-link">{t.joinAgent}</Link></div>
                ) : agentRows.map((a) => (
                  <Link key={a.pubkey} className="db-feed-row" href={`/agent/${a.pubkey}`}>
                    <span className={`db-feed-dot${a.isOnline ? " is-live" : ""}`} style={{ background: a.isOnline ? "var(--green)" : "var(--text-muted)" }} />
                    <span className="db-feed-main">
                      <span><strong>{a.name}</strong> <span className="ui-mono ui-muted">{shortenAddress(a.pubkey, 4)}</span></span>
                      <span className="db-feed-sub">
                        {a.isOnline ? t.online : t.offline}
                        {a.rep ? ` · ${t.wins(a.rep.tasksWon)} · ${stroopsToUsdc(a.rep.totalEarned).toLocaleString(loc, { maximumFractionDigits: 2 })} XLM` : ""}
                      </span>
                    </span>
                  </Link>
                )))}
              </div>
            </div>
          </aside>
        </div>
      </main>

      {showPost && <PostTaskModal onClose={() => setShowPost(false)} onTaskPosted={handleTaskPosted} />}
    </div>
  );
}
