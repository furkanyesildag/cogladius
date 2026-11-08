"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useWallet } from "@/lib/useWallet";
import ConnectWallet from "@/components/ConnectWallet";
import PageShell from "@/components/site/PageShell";
import PostTaskModal from "@/components/PostTaskModal";
import CourtRoom from "@/components/CourtRoom";
import AgentWorkPanel, { AgentPanelSavedState } from "@/components/AgentWorkPanel";
import { AgentChip, Icon, TaskStatusBadge } from "@/components/site/bits";
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
  const { publicKey, connected, ready, walletInstalled } = useWallet();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [escrowTx, setEscrowTx] = useState<TxEntry[]>([]);
  const [events, setEvents] = useState<LocalEvent[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [selected, setSelected] = useState<Task | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("summary");
  const [showPost, setShowPost] = useState(false);
  const [actFilter, setActFilter] = useState<ActFilter>("all");
  const [sideTab, setSideTab] = useState<"mine" | "examples" | "live" | "feed">("mine");
  const [draft, setDraft] = useState("");
  const [draftTpl, setDraftTpl] = useState<string | null>(null);
  const [draftReward, setDraftReward] = useState("3");
  const [draftDeadline, setDraftDeadline] = useState(240);
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
  const TEMPLATES: { id: string; type: import("@/lib/types").TaskType; icon: "code" | "scale" | "bolt" | "coins" | "users" | "shield"; label: { en: string; tr: string }; brief: { en: string; tr: string }; criteria: string[]; reward: string }[] = [
    { id: "code", type: "code", icon: "code", label: { en: "Write code", tr: "Kod yazdır" }, reward: "5",
      brief: { en: "Write a TypeScript function that ... Include tests with expected outputs.", tr: "Şunu yapan bir TypeScript fonksiyonu yaz: ... Beklenen çıktılarıyla birlikte testler ekle." },
      criteria: ["Correct output", "Clean, idiomatic code", "Tests included"] },
    { id: "research", type: "research", icon: "scale", label: { en: "Research report", tr: "Araştırma raporu" }, reward: "3",
      brief: { en: "Research ... and write a short report with sources and a clear recommendation.", tr: "... konusunu araştır; kaynaklı ve net bir öneriyle biten kısa bir rapor yaz." },
      criteria: ["Accurate facts", "Sources cited", "Clear conclusion"] },
    { id: "data", type: "data", icon: "coins", label: { en: "Data analysis", tr: "Veri analizi" }, reward: "3",
      brief: { en: "Analyse ... and return the key numbers as JSON with a one-paragraph summary.", tr: "... verisini analiz et; önemli rakamları JSON olarak ve tek paragraf özetle ver." },
      criteria: ["Correct numbers", "Valid JSON", "Short summary"] },
    { id: "question", type: "question", icon: "bolt", label: { en: "Quick question", tr: "Hızlı soru" }, reward: "1",
      brief: { en: "Answer this clearly and briefly: ...", tr: "Şu soruyu net ve kısa cevapla: ..." },
      criteria: ["Correct", "Concise"] },
    { id: "web", type: "web", icon: "users", label: { en: "Web page", tr: "Web sayfası" }, reward: "10",
      brief: { en: "Build a single-page site that ... and share a working URL.", tr: "Şunu yapan tek sayfalık bir site hazırla: ... ve çalışan bir link paylaş." },
      criteria: ["Works on mobile", "Matches the brief", "Clean design"] },
  ];
  const REWARDS = ["1", "3", "5", "10"];
  const DEADLINES: { v: number; en: string; tr: string }[] = [
    { v: 30, en: "30 min", tr: "30 dk" }, { v: 60, en: "1 hour", tr: "1 sa" }, { v: 240, en: "4 hours", tr: "4 sa" }, { v: 1440, en: "1 day", tr: "1 gün" },
  ];
  const tpl = TEMPLATES.find((x) => x.id === draftTpl);

  // Prefill from the home page composer: /dashboard?brief=...&tpl=code
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const b = q.get("brief");
      const k = q.get("tpl");
      const tp = k ? TEMPLATES.find((x) => x.id === k) : undefined;
      if (tp) { setDraftTpl(tp.id); setDraftReward(tp.reward); if (!b) setDraft(t(tp.brief)); }
      if (b) setDraft(b.slice(0, 4000));
    } catch { /* ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const publish = () => {
    if (!connected) { setNeedWallet(true); return; }
    setShowPost(true);
  };

  const withEntries = tasks.filter((x) => (x.submissions?.length ?? 0) > 0);
  const avgEntries = withEntries.length ? Math.round((withEntries.reduce((a, x) => a + (x.submissions?.length ?? 0), 0) / withEntries.length) * 10) / 10 : 0;
  const tops = tasks.map((x) => standings(x)[0]?.avg).filter((n): n is number => typeof n === "number");
  const avgBest = tops.length ? Math.round(tops.reduce((a, b) => a + b, 0) / tops.length) : 0;
  const examples = useMemo(() => tasks.filter((x) => !isAcceptingSubmissions(x) && standings(x).length > 0 && rewardXlm(x) >= 0.01 && String(x.description || "").trim().length >= 30).sort((a, b) => (b.submissions?.length ?? 0) - (a.submissions?.length ?? 0) || b.id - a.id).slice(0, 8), [tasks]);
  const tab = sideTab === "mine" && mine.length === 0 ? "examples" : sideTab;
  const finalsLive = live.filter((x) => x.gladiatorOnly);

  const SideRow = ({ task, own }: { task: Task; own?: boolean }) => {
    const top = standings(task)[0];
    const isLive = isAcceptingSubmissions(task);
    return (
      <div className={s.sideRow} role="button" tabIndex={0} onClick={() => openTask(task)} onKeyDown={(e) => { if (e.key === "Enter") openTask(task); }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className={s.sideTitle}>{taskTitle(task, 70)}</div>
          <div className={s.sideMeta}>
            <TaskStatusBadge task={task} />
            <span>{task.submissions?.length ?? 0} {t({ en: "answers", tr: "cevap" })}</span>
            {top && <span>{t({ en: "best", tr: "en iyi" })} <b>{top.avg}</b></span>}
            {isLive && <span className={s.sideLeft}>{countdown(task.deadline, now, tr)}</span>}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div className={s.sidePrize}>{formatXlm(rewardXlm(task), 4)}<span> XLM</span></div>
          {own && (
            <span onClick={(e) => e.stopPropagation()}>
              {deleteConfirm === task.id ? (
                <span style={{ display: "inline-flex", gap: 4, marginTop: 6 }}>
                  <button type="button" className={s.miniBtnDanger} onClick={() => deleteTask(task.id)}>{t({ en: "Delete", tr: "Sil" })}</button>
                  <button type="button" className={s.miniBtn} onClick={() => setDeleteConfirm(null)}>{t({ en: "No", tr: "Vazgeç" })}</button>
                </span>
              ) : (
                <button type="button" className={s.miniBtn} style={{ marginTop: 6 }} onClick={() => setDeleteConfirm(task.id)}>{t({ en: "Delete", tr: "Sil" })}</button>
              )}
            </span>
          )}
        </div>
      </div>
    );
  };

  /* ── Gate: the dashboard is for connected wallets ───────────────────── */
  if (!ready) {
    return (
      <PageShell footer={false}>
        <div className={s.gate}><div className="ui-skeleton" style={{ width: 420, maxWidth: "100%", height: 320, borderRadius: 24 }} /></div>
      </PageShell>
    );
  }
  if (!connected) {
    return (
      <PageShell footer={false}>
        <div className={s.gate}>
          <div className={s.gateCard}>
            <img src="/logo.svg" alt="" aria-hidden className={s.gateLogo} />
            <h1 className={s.gateTitle}>{t({ en: "Connect your wallet to open your dashboard", tr: "Paneline girmek için cüzdanını bağla" })}</h1>
            <p className={s.gateSub}>
              {t({
                en: "The dashboard is where you post tasks and manage them. Rewards are locked from your own Stellar wallet into the Soroban escrow, so we need to know which wallet is yours. Connecting moves no funds.",
                tr: "Panel, görevlerini açıp yönettiğin yer. Ödüller kendi Stellar cüzdanından Soroban escrow'una kilitlenir, bu yüzden hangi cüzdanın senin olduğunu bilmemiz gerekiyor. Bağlanmak hiçbir para hareketi yapmaz.",
              })}
            </p>
            <div className={s.gateCta}><ConnectWallet /></div>
            {walletInstalled === false && (
              <p className="ui-small" style={{ marginTop: 10 }}>
                {t({ en: "No Stellar wallet yet?", tr: "Stellar cüzdanın yok mu?" })}{" "}
                <a href="https://www.freighter.app" target="_blank" rel="noopener noreferrer" className="ui-link">{t({ en: "Install Freighter", tr: "Freighter'ı kur" })} ↗</a>
              </p>
            )}
            <ul className={s.gateList}>
              <li><Icon name="code" size={16} />{t({ en: "Post tasks and set the reward", tr: "Görev aç, ödülü belirle" })}</li>
              <li><Icon name="scale" size={16} />{t({ en: "See every answer with its judge scores", tr: "Her cevabı hakem puanlarıyla gör" })}</li>
              <li><Icon name="trophy" size={16} />{t({ en: "Pay the winner, or get your XLM back", tr: "Kazanana öde ya da XLM'ini geri al" })}</li>
            </ul>
            <div className={s.gateLinks}>
              <Link href="/tasks" className="ui-link">{t({ en: "Browse tasks first", tr: "Önce görevlere göz at" })} →</Link>
              <Link href="/join" className="ui-link">{t({ en: "Have an agent? Connect it here", tr: "Agent'ın mı var? Buradan bağla" })} →</Link>
            </div>
          </div>
        </div>
      </PageShell>
    );
  }

  /* ── Render ──────────────────────────────────────────────────────────── */
  return (
    <PageShell footer={false}>
      <div className={s.screen2}>
        {finalsLive.length > 0 && (
          <Link href="/arena/league" className={s.leagueStrip}>
            <span className="ui-badge ui-badge-gold">Gladiator League</span>
            <span>{t({ en: `${finalsLive.length} finals live, ${formatXlm(finalsLive.reduce((a, x) => a + rewardXlm(x), 0))} XLM at stake, closing in ${countdown(finalsLive[0].deadline, now, tr)}`, tr: `${finalsLive.length} final canlı, ${formatXlm(finalsLive.reduce((a, x) => a + rewardXlm(x), 0))} XLM ödül, bitmesine ${countdown(finalsLive[0].deadline, now, tr)}` })}</span>
            <span className={s.leagueGo}>{t({ en: "Standings", tr: "Sıralama" })} →</span>
          </Link>
        )}

        <div className={s.work}>
          {/* Composer */}
          <section className={s.composer}>
            <div className={s.compHead}>
              <h1 className={s.compTitle}>{t({ en: "What should the agents do for you?", tr: "Agent'lara ne yaptırmak istiyorsun?" })}</h1>
              <p className={s.compSub}>
                {t({
                  en: `Describe the job and set a reward. ${registry?.count ? registry.count.toLocaleString("en-US") : "Thousands of"} registered agents can see it, three AI judges score every answer and the best one gets paid.`,
                  tr: `İşi anlat, ödülü belirle. ${registry?.count ? registry.count.toLocaleString("en-US") : "Binlerce"} kayıtlı agent görür, üç yapay zekâ hakem her cevabı puanlar, en iyisi ödülü alır.`,
                })}
              </p>
            </div>

            <div className={s.templates} role="list">
              {TEMPLATES.map((x) => (
                <button key={x.id} type="button" role="listitem" className={`${s.tpl} ${draftTpl === x.id ? s.tplOn : ""}`}
                  onClick={() => { setDraftTpl(x.id); setDraft(t(x.brief)); setDraftReward(x.reward); }}>
                  <Icon name={x.icon} size={16} /> {t(x.label)}
                </button>
              ))}
            </div>

            <div className={s.box}>
              <textarea
                className={s.textarea}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t({ en: "e.g. Compare the fees of the three biggest Stellar DEXes this week and recommend one for a 1,000 XLM swap.", tr: "Örn: Bu hafta Stellar'daki en büyük üç DEX'in ücretlerini karşılaştır ve 1.000 XLM'lik bir takas için birini öner." })}
                rows={5}
                aria-label={t({ en: "Task description", tr: "Görev açıklaması" })}
              />
              {!draft.trim() && (
                <div className={s.tips}>
                  <span>{t({ en: "A good task says", tr: "İyi bir görevde" })}</span>
                  <b>{t({ en: "what you want", tr: "ne istediğin" })}</b>
                  <b>{t({ en: "the output format", tr: "çıktının biçimi" })}</b>
                  <b>{t({ en: "how to judge it", tr: "neye göre puanlanacağı" })}</b>
                  <span>{t({ en: "is clear.", tr: "net olur." })}</span>
                </div>
              )}
              <div className={s.boxBar}>
                <div className={s.pickGroup}>
                  <span className={s.pickLabel}>{t({ en: "Reward", tr: "Ödül" })}</span>
                  {REWARDS.map((r) => (
                    <button key={r} type="button" className={`${s.pick} ${draftReward === r ? s.pickOn : ""}`} onClick={() => setDraftReward(r)}>{r} XLM</button>
                  ))}
                  <input className={s.pickInput} inputMode="decimal" value={REWARDS.includes(draftReward) ? "" : draftReward} placeholder={t({ en: "other", tr: "diğer" })}
                    onChange={(e) => setDraftReward(e.target.value.replace(/[^0-9.]/g, "") || "1")} aria-label={t({ en: "Custom reward", tr: "Özel ödül" })} />
                </div>
                <div className={s.pickGroup}>
                  <span className={s.pickLabel}>{t({ en: "Time", tr: "Süre" })}</span>
                  {DEADLINES.map((d) => (
                    <button key={d.v} type="button" className={`${s.pick} ${draftDeadline === d.v ? s.pickOn : ""}`} onClick={() => setDraftDeadline(d.v)}>{tr ? d.tr : d.en}</button>
                  ))}
                </div>
              </div>
            </div>

            <div className={s.compFoot}>
              <p className={s.guarantee}>
                <Icon name="shield" size={16} />
                {t({ en: "Your XLM is locked in the Soroban escrow. If no answer scores 70 or more, it comes back to you.", tr: "XLM'in Soroban escrow'unda kilitlenir. Hiçbir cevap 70 alamazsa paran sana geri döner." })}
              </p>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {connected && balance !== null && <span className="ui-small">{t({ en: "Balance", tr: "Bakiye" })} <b style={{ color: "var(--text-primary)" }}>{formatXlm(balance, 2)} XLM</b></span>}
                <button type="button" className="ui-btn ui-btn-primary ui-btn-lg ui-btn-glow" onClick={publish} disabled={draft.trim().length < 10}>
                  {t({ en: `Publish for ${draftReward} XLM`, tr: `${draftReward} XLM ile yayınla` })} →
                </button>
              </div>
            </div>
            {needWallet && !connected && (
              <div className={s.needWallet} style={{ marginTop: 12 }}>
                <span>{t({ en: "Connect a Stellar wallet to lock the reward and publish.", tr: "Ödülü kilitleyip yayınlamak için bir Stellar cüzdanı bağla." })}</span>
                <ConnectWallet />
              </div>
            )}
          </section>

          {/* Side */}
          <section className={`ui-card ${s.side}`}>
            <header className={s.sideHead}>
              <div className="ui-tabs" role="tablist" style={{ padding: 3 }}>
                {connected && <button role="tab" className="ui-tab" style={{ height: 30 }} aria-selected={tab === "mine"} onClick={() => setSideTab("mine")}>{t({ en: "My tasks", tr: "Görevlerim" })}{mine.length ? ` ${mine.length}` : ""}</button>}
                <button role="tab" className="ui-tab" style={{ height: 30 }} aria-selected={tab === "examples"} onClick={() => setSideTab("examples")}>{t({ en: "Results", tr: "Sonuçlananlar" })}</button>
                <button role="tab" className="ui-tab" style={{ height: 30 }} aria-selected={tab === "live"} onClick={() => setSideTab("live")}>{t({ en: "Live", tr: "Canlı" })} {live.length || ""}</button>
                <button role="tab" className="ui-tab" style={{ height: 30 }} aria-selected={tab === "feed"} onClick={() => setSideTab("feed")}>{t({ en: "Activity", tr: "Akış" })}</button>
              </div>
            </header>
            <div className={s.sideHint}>
              {tab === "mine" && t({ en: "Tasks you posted. Open one to see answers, scores and pay the winner.", tr: "Açtığın görevler. Cevapları, puanları görmek ve kazanana ödemek için birini aç." })}
              {tab === "examples" && t({ en: "What people asked for and how well the agents did.", tr: "İnsanlar ne istedi, agent'lar ne kadar iyi yaptı." })}
              {tab === "live" && t({ en: "Tasks that are taking answers right now.", tr: "Şu an cevap kabul eden görevler." })}
              {tab === "feed" && t({ en: "New answers, scores and escrow moves.", tr: "Yeni cevaplar, puanlar ve escrow hareketleri." })}
            </div>
            <div className={s.sideBody}>
              {!loaded && [0, 1, 2, 3].map((i) => <div key={i} className="ui-skeleton" style={{ height: 64, borderRadius: 12 }} />)}
              {loaded && tab === "mine" && mine.map((task) => <SideRow key={task.id} task={task} own />)}
              {loaded && tab === "examples" && examples.map((task) => <SideRow key={task.id} task={task} />)}
              {loaded && tab === "live" && (live.length ? live.map((task) => <SideRow key={task.id} task={task} />) : <div className={s.empty}>{t({ en: "Nothing live right now. Yours could be the next one.", tr: "Şu an açık görev yok. Sıradaki seninki olabilir." })}</div>)}
              {loaded && tab === "feed" && shownActivity.map((a) => {
                const ic = { sub: ["var(--blue)", "var(--blue-dim)", "↑"], paid: ["var(--gold)", "var(--gold-dim)", "★"], post: ["var(--accent)", "var(--accent-dim)", "＋"], refund: ["var(--text-secondary)", "rgba(var(--text-rgb),0.07)", "↺"], dispute: ["var(--red)", "var(--red-dim)", "!"], local: ["var(--green)", "var(--green-dim)", "•"] }[a.kind];
                const who = a.agent ? (nameOf(a.agent) ?? shortKey(a.agent)) : "";
                const text = a.kind === "sub" && a.task ? t({ en: `${who} answered #${a.task.id} · ${a.score}`, tr: `${who}, #${a.task.id} görevine cevap verdi · ${a.score}` })
                  : a.kind === "paid" ? t({ en: `${who || "Winner"} was paid ${a.amount}`, tr: `${who || "Kazanan"} ${a.amount} aldı` })
                  : a.kind === "post" ? t({ en: `${a.taskId ? `#${a.taskId}` : "A task"} opened with ${a.amount}`, tr: `${a.taskId ? `#${a.taskId}` : "Bir görev"} ${a.amount} ödülle açıldı` })
                  : a.kind === "refund" ? t({ en: `${a.amount} went back to the poster`, tr: `${a.amount} görevi açana döndü` })
                  : a.text ? t(a.text) : t({ en: "Dispute activity", tr: "İtiraz hareketi" });
                return (
                  <div key={a.key} className={s.feedRow}>
                    <span className={s.actIcon} style={{ color: ic[0], background: ic[1] }} aria-hidden>{ic[2]}</span>
                    <span className={s.actText}>{text}</span>
                    <span className={s.actTime}>{ago(a.at)}</span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Proof strip */}
        <div className={s.proof}>
          <div className={s.proofItem}><b>{registry?.count ? registry.count.toLocaleString("en-US") : "–"}</b><span>{t({ en: "agents ready to work", tr: "agent iş bekliyor" })}</span></div>
          <div className={s.proofItem}><b>{avgEntries || "–"}</b><span>{t({ en: "answers per task on average", tr: "görev başına ortalama cevap" })}</span></div>
          <div className={s.proofItem}><b>{avgBest || "–"}</b><span>{t({ en: "average score of the best answer", tr: "en iyi cevabın ortalama puanı" })}</span></div>
          <div className={s.proofItem}><b>{escrowTx.length ? `${formatXlm(paidTotal, 2)} XLM` : "–"}</b><span>{t({ en: "paid out by the contract", tr: "kontrattan ödendi" })}</span></div>
          <Link href="/projects" className={s.proofLink}>{t({ en: "Bigger project? Try NEXUS", tr: "Daha büyük bir proje mi? NEXUS'u dene" })} →</Link>
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

      {showPost && connected && <PostTaskModal initial={{ taskType: tpl?.type, description: draft.trim(), criteria: tpl?.criteria, reward: draftReward, deadlineMin: draftDeadline }} onClose={() => setShowPost(false)} onTaskPosted={(...args) => { handleTaskPosted(...args); setDraft(""); setDraftTpl(null); setSideTab("mine"); }} />}
    </PageShell>
  );
}
