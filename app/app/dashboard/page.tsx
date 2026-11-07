"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWallet } from "@/lib/useWallet";
import ConnectWallet from "@/components/ConnectWallet";
import PageShell from "@/components/site/PageShell";
import PostTaskModal from "@/components/PostTaskModal";
import JudgePanel from "@/components/JudgePanel";
import CourtRoom from "@/components/CourtRoom";
import AgentWorkPanel, { AgentPanelSavedState } from "@/components/AgentWorkPanel";
import { useMessages, useLocale } from "@/lib/i18n";
import { useT } from "@/lib/ui/copy";

import { Task, AgentState, JudgeState, FeedEntry, TxEntry } from "@/lib/types";
import { AGENT_API_POLL_MS, POLL_INTERVAL_MS, shortenAddress, explorerTx, usdcToStroops } from "@/lib/constants";
import { fetchUsdcBalance, EXPLORER_TX } from "@/lib/stellar";
import { settleAsPoster, signTaskDelete } from "@/lib/sorobanEscrow";
import { activityFromTasks, displayStatus, isAcceptingSubmissions, isEnded, sortForPool, txFromEscrowEvents } from "@/lib/dashboardData";
import s from "./dashboard.module.css";

// Real registered agents are loaded from /api/agents/list; no demo agents.
const DEFAULT_AGENTS: AgentState[] = [];
const AGENT_COLORS = ["#3dd68c", "#8ab4ff", "#f5b83d", "#ff8a5c", "#b98cff", "#5fd4c8"];
const DEFAULT_JUDGES: JudgeState = {
  TeknikHakem: "READY", KullanılabilirlikHakemi: "READY", KapsamHakemi: "READY",
};

/** Submitter with the best average judge score, or undefined if nobody was judged. */
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

type LogFilterKey = "all" | "net" | "sys";
function logEntryMatchesFilter(entry: FeedEntry, f: LogFilterKey): boolean {
  if (f === "all") return true;
  const ic = (entry.icon || "").toLowerCase();
  const ag = (entry.agent || "").toLowerCase();
  if (f === "sys") return ["tx", "sys", "judge"].includes(ic) || ag.includes("hakem") || ag === "judge" || ag === "tx";
  if (f === "net") return ic === "net" || ag.includes("network") || ic === "alpha" || ic === "beta";
  return true;
}

/** Badge class and label key for a task status in the new UI kit. */
function statusBadge(status: string): string {
  if (status === "Open") return "ui-badge ui-badge-live ui-badge-dot";
  if (status === "UnderReview") return "ui-badge ui-badge-gold";
  if (status === "AwaitingDecision") return "ui-badge ui-badge-blue";
  if (status === "Settled" || status === "Resolved") return "ui-badge ui-badge-gold";
  if (status === "Disputed") return "ui-badge ui-badge-red";
  return "ui-badge";
}

const STATUS_LABEL: Record<string, { en: string; tr: string }> = {
  Open: { en: "Live", tr: "Canlı" },
  UnderReview: { en: "Under review", tr: "İnceleniyor" },
  AwaitingDecision: { en: "Awaiting decision", tr: "Karar bekliyor" },
  Settled: { en: "Paid", tr: "Ödendi" },
  Disputed: { en: "In dispute", tr: "İtirazda" },
  Resolved: { en: "Resolved", tr: "Çözüldü" },
  Stopped: { en: "Stopped", tr: "Durduruldu" },
  Refunded: { en: "Refunded", tr: "İade edildi" },
  Expired: { en: "Ended", tr: "Bitti" },
};

function Countdown({ deadline }: { deadline: number }) {
  const { locale } = useLocale();
  const ended = locale === "tr" ? "Bitti" : "Ended";
  const [rem, setRem] = useState("");
  const [urgent, setUrgent] = useState(false);
  useEffect(() => {
    const tick = () => {
      const d = deadline - Math.floor(Date.now() / 1000);
      if (d <= 0) { setRem(ended); setUrgent(false); return; }
      setUrgent(d < 3600);
      const days = Math.floor(d / 86400);
      const h = Math.floor((d % 86400) / 3600); const m = Math.floor((d % 3600) / 60); const sec = d % 60;
      setRem(days > 0 ? `${days}d ${h}h` : h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(sec).padStart(2, "0")}s`);
    };
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id);
  }, [deadline, ended]);
  return <span className="ui-mono ui-num" style={{ fontSize: 12, color: urgent ? "var(--yellow)" : "var(--text-muted)" }}>{rem}</span>;
}

function txColor(type: string): string {
  if (type.includes("release") || type.includes("settle") || type.includes("reward")) return "var(--green)";
  if (type.includes("dispute") || type.includes("resolve") || type.includes("refund")) return "var(--red)";
  return "var(--accent)";
}

/* ═══════════════════════════════════════════════════════════════════════════
   DASHBOARD
═══════════════════════════════════════════════════════════════════════════ */
export default function Dashboard() {
  const ui = useMessages().ui;
  const pl = ui.panels;
  const sf = ui.sidebarFleet;
  const { locale } = useLocale();
  const { publicKey, connected } = useWallet();
  const router = useRouter();

  const [tasks, setTasks]               = useState<Task[]>([]);
  const [agents, setAgents]             = useState<AgentState[]>(DEFAULT_AGENTS);
  const [judges, setJudges]             = useState<JudgeState>(DEFAULT_JUDGES);
  const [feed, setFeed]                 = useState<FeedEntry[]>([]);
  const [txLog, setTxLog]               = useState<TxEntry[]>([]);
  const [escrowTx, setEscrowTx]         = useState<TxEntry[]>([]);
  const [agentTotal, setAgentTotal]     = useState(0);
  const [showEnded, setShowEnded]       = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showPostModal, setShowPostModal] = useState(false);
  const [centerTab, setCenterTab]       = useState<"detail" | "agent" | "court">("detail");
  const [usdcBalance, setUsdcBalance]     = useState<number | null>(null);
  const [courtData, setCourtData]       = useState<{ agentResult: string; disputeReason: string } | null>(null);
  const [agentPanelTaskId, setAgentPanelTaskId] = useState<number | null>(null);
  const [agentPanelStates, setAgentPanelStates] = useState<Record<number, AgentPanelSavedState>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [editingTask, setEditingTask]   = useState<Task | null>(null);

  const [logFilter, setLogFilter]       = useState<LogFilterKey>("all");
  const [mobileTab, setMobileTab]       = useState<"tasks" | "live" | "tx">("live");

  async function deleteTask(id: number) {
    // Drop it locally first so the UI responds immediately, then delete the
    // record server-side. Without the server call the task simply reappeared on
    // the next poll, which is what made "delete" look broken.
    const previous = tasks;
    const target = tasks.find((t) => t.id === id);
    setTasks((p) => p.filter((t) => t.id !== id));
    if (selectedTask?.id === id) setSelectedTask(null);
    setDeleteConfirm(null);
    try {
      // A gated task (Gladiator-only or a League entry mark) needs the poster's signature.
      const gated = target?.contractTaskId !== undefined && (target.gladiatorOnly === true || target.minQualifierScore !== undefined);
      const proof = gated && publicKey ? await signTaskDelete(target!.contractTaskId!, publicKey) : {};
      const res = await fetch(`/api/tasks/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poster: publicKey || "", ...proof }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        setTasks(previous); // server refused: put it back rather than lie
        alert(data?.error || "Task could not be deleted.");
      }
    } catch {
      setTasks(previous);
      alert("Task could not be deleted.");
    }
  }

  // Load real registered agents from the registry (no demo data). The feed
  // stays empty until real platform events (task posted / settled) occur.
  useEffect(() => {
    let cancelled = false;
    const loadAgents = async () => {
      try {
        // Registered agents and the built-in demo agents are merged here, in one
        // place, so the list is deterministic. Doing the merge in two separate
        // pollers is what previously made it flip-flop between the two sets.
        const [regRes, stateRes] = await Promise.all([
          fetch("/api/agents/list"),
          fetch("/api/state").catch(() => null),
        ]);
        if (!regRes.ok) return;
        const data = await regRes.json();
        if (cancelled || !Array.isArray(data.agents)) return;
        if (Number.isFinite(Number(data.count))) setAgentTotal(Number(data.count));

        const registered: AgentState[] = data.agents.map((a: any) => ({
          name: a.name,
          pubkey: a.pubkey,
          status: a.isOnline ? "SCANNING" : "IDLE",
          tasksCompleted: a.stats?.tasksCompleted ?? 0,
          totalScore: a.stats?.totalScore ?? 0,
          x402Spending: a.stats?.x402Spent ?? 0,
          currentTaskId: null,
          color: "",
        }));

        // Demo agents keep the fleet populated while real adoption is early.
        let demo: AgentState[] = [];
        if (stateRes?.ok) {
          const s = await stateRes.json().catch(() => null);
          if (Array.isArray(s?.agents)) {
            const known = new Set(registered.map((a) => a.pubkey));
            demo = s.agents
              .filter((a: any) => a?.pubkey && !known.has(a.pubkey))
              .map((a: any) => ({ ...a, color: "" } as AgentState));
          }
        }

        if (cancelled) return;
        setAgents(
          [...registered, ...demo].map((a, i) => ({
            ...a,
            color: AGENT_COLORS[i % AGENT_COLORS.length],
          }))
        );
      } catch { /* registry empty / offline */ }
    };
    loadAgents();
    const id = setInterval(loadAgents, 15000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);


  // The dashboard is a public live view: it never redirects. Posting needs a connected wallet.


  // API polls
  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch("/api/state"); if (!res.ok) return;
        const data = await res.json();
        // Agents come solely from /api/agents/list (the real registry). Do not
        // let the /api/state simulator overwrite them, or the list flip-flops
        // between real agents and demo agents on every poll.
        if (data.judges) setJudges(data.judges);
        if (data.feed?.length) setFeed((prev) => {
          const ne = data.feed.filter((e: FeedEntry) => !prev.some((p) => p.id === e.id));
          return ne.length ? [...ne, ...prev].slice(0, 120) : prev;
        });
        if (data.txLog?.length) setTxLog((prev) => {
          const nt = data.txLog.filter((t: TxEntry) => !prev.some((p) => p.id === t.id));
          return nt.length ? [...nt, ...prev].slice(0, 60) : prev;
        });
      } catch (_) {}
    }
    poll(); const id = setInterval(poll, AGENT_API_POLL_MS); return () => clearInterval(id);
  }, []);

  // The TX column shows the escrow's own on-chain events, newest first.
  useEffect(() => {
    let cancelled = false;
    async function loadEscrow() {
      try {
        const res = await fetch("/api/reputation/events");
        if (!res.ok) return;
        const d = await res.json();
        if (!Array.isArray(d.events)) return;
        const rows = await txFromEscrowEvents(d.events);
        if (!cancelled) setEscrowTx(rows);
      } catch (_) {}
    }
    loadEscrow();
    const id = setInterval(loadEscrow, 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    async function pollTasks() {
      try {
        const res = await fetch("/api/tasks");
        if (res.ok) {
          const d = await res.json();
          if (d.tasks?.length) setTasks(d.tasks);
        }
      } catch (_) {}
    }
    pollTasks();
    const id = setInterval(pollTasks, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!publicKey) { setUsdcBalance(null); return; }
    const bal = async () => {
      try {
        const { usdc } = await fetchUsdcBalance(publicKey);
        setUsdcBalance(parseFloat(usdc));
      } catch (_) {}
    };
    bal(); const id = setInterval(bal, 12000); return () => clearInterval(id);
  }, [publicKey]);

  function handleTaskPosted(txHash: string, taskId: number, description: string, criteria: string, rewardUsdc: number, deadlineMinutes: number, taskType?: import("@/lib/types").TaskType, outputFormat?: import("@/lib/types").OutputFormat, meta?: import("@/components/PostTaskModal").PostTaskMeta) {
    const now = new Date();
    const tloc = locale === "tr" ? "tr-TR" : "en-US";
    const explorerUrl = EXPLORER_TX(txHash);
    setTasks((prev) => [{ id: taskId, poster: publicKey?.toString() || "Demo", description, criteria, reward: Number(usdcToStroops(rewardUsdc)), rewardUsdc, deadline: Math.floor(Date.now() / 1000) + deadlineMinutes * 60, status: "Open", submissions: [], verdicts: [], taskType, outputFormat, contractTaskId: meta?.contractTaskId, escrowContractId: meta?.escrowContractId, postTxHash: txHash }, ...prev]);
    setFeed((prev) => [{ id: Date.now(), time: now.toISOString(), timeStr: now.toLocaleTimeString(tloc, { hour12: false }), message: ui.feedDyn.taskPosted(taskId, rewardUsdc.toFixed(4)), icon: "tx", agent: "tx" }, ...prev]);
    setTxLog((prev) => [{ id: Date.now(), type: "post_task()", hash: txHash, taskId, amount: `${rewardUsdc.toFixed(4)} XLM`, time: now.toISOString(), explorerUrl, slot: 0, ms: 0, highlight: true }, ...prev]);
    setShowPostModal(false);
  }

  function handleAssignTask(task: Task) {
    const now = new Date();
    const tloc = locale === "tr" ? "tr-TR" : "en-US";
    setTasks((p) => p.map((tk) => tk.id === task.id ? { ...tk, status: "UnderReview" } : tk));
    setSelectedTask((p) => p?.id === task.id ? { ...p, status: "UnderReview" } : p);
    setAgentPanelTaskId(task.id); setCenterTab("agent");
    setFeed((p) => [{ id: Date.now(), time: now.toISOString(), timeStr: now.toLocaleTimeString(tloc, { hour12: false }), message: ui.feedDyn.assigned(task.id), icon: "alpha", agent: "Nova" }, ...p]);
  }

  function handleJudgesComplete(taskId: number) {
    setTasks((p) => p.map((t) => t.id === taskId ? { ...t, status: "AwaitingDecision" } : t));
    setSelectedTask((p) => p?.id === taskId ? { ...p, status: "AwaitingDecision" } : p);
  }

  async function handleAgentApprove(_agentResult: string, _txHash: string) {
    if (!selectedTask) return;
    const now = new Date();
    const tloc = locale === "tr" ? "tr-TR" : "en-US";
    const reward = (selectedTask.rewardUsdc ?? 0).toFixed(4);
    const stamp = { id: Date.now(), time: now.toISOString(), timeStr: now.toLocaleTimeString(tloc, { hour12: false }) };

    // Release the XLM reward from the Soroban escrow contract to the best
    // judged submitter: the settle route pays only an agent that submitted and
    // was judged, and the contract re-checks the score.
    const winner = bestJudgedSubmitter(selectedTask);
    let data: any = null;
    let error = "";
    try {
      if (!publicKey || selectedTask.contractTaskId === undefined) {
        throw new Error("poster wallet and escrowed task are required");
      }
      if (!winner) throw new Error("no judged submission to pay");
      // The poster authorizes the release with a SEP-53 signature.
      data = await settleAsPoster({
        taskId: selectedTask.id,
        contractTaskId: selectedTask.contractTaskId,
        posterAddress: publicKey.toString(),
        winnerAddress: winner,
      });
      if (!data?.success) error = data?.error || "settlement failed";
    } catch (e: any) {
      error = e?.message || "settlement failed";
    }
    if (error) {
      // Nothing moved on chain, so nothing is shown as settled.
      setFeed((p) => [{ ...stamp, message: ui.feedDyn.settleFailed(selectedTask.id, error), icon: "tx", agent: "tx" }, ...p]);
      return;
    }

    const finalHash: string = data.hash;
    const explorerUrl: string = data.explorerUrl || EXPLORER_TX(data.hash);
    const winnerStellar: string | undefined = data.winnerAddress;
    const winnerName = agents.find((a) => a.pubkey === winner)?.name || shortenAddress(winnerStellar ?? winner ?? "");
    setTasks((p) => p.map((t) => t.id === selectedTask.id ? { ...t, status: "Settled", settleTxHash: finalHash, winnerStellarAddress: winnerStellar ?? t.winnerStellarAddress } : t));
    setSelectedTask((p) => p?.id === selectedTask.id ? { ...p, status: "Settled", settleTxHash: finalHash, winnerStellarAddress: winnerStellar ?? p.winnerStellarAddress } : p);
    setFeed((p) => [{ ...stamp, message: ui.feedDyn.approved(selectedTask.id, reward), icon: "tx", agent: "tx" }, ...p]);
    setTxLog((p) => [{ id: Date.now(), type: "release_to_winner()", hash: finalHash, taskId: selectedTask.id, amount: `+${reward} XLM`, winner: winnerName.toLowerCase(), time: now.toISOString(), explorerUrl, slot: 0, ms: 0, highlight: true }, ...p]);
  }

  function handleAgentReject(agentResult: string, reason: string) {
    if (!selectedTask) return;
    const now = new Date();
    const tloc = locale === "tr" ? "tr-TR" : "en-US";
    setTasks((p) => p.map((t) => t.id === selectedTask.id ? { ...t, status: "Disputed" } : t));
    setFeed((p) => [{ id: Date.now(), time: now.toISOString(), timeStr: now.toLocaleTimeString(tloc, { hour12: false }), message: ui.feedDyn.court(selectedTask.id), icon: "judge", agent: "judge" }, ...p]);
    setCourtData({ agentResult, disputeReason: reason }); setCenterTab("court");
  }


  const t = useT();
  const dash = ui.dashboard;
  const JUDGE_NAMES = ["TeknikHakem", "KullanılabilirlikHakemi", "KapsamHakemi"] as const;
  const JUDGE_LABELS = ui.judgeNames;

  const openCount = tasks.filter(isAcceptingSubmissions).length;
  const settledCount = tasks.filter((x) => x.status === "Settled" || x.status === "Resolved").length;
  const endedCount = tasks.filter(isEnded).length;
  const poolTasks = sortForPool(tasks).filter((x) => showEnded || !isEnded(x));

  const activity = feed.length ? feed : activityFromTasks(tasks);
  const shownActivity = useMemo(() => activity.filter((e) => logEntryMatchesFilter(e, logFilter)), [activity, logFilter]);

  // Agents competing right now first (they may be missing from the paged registry list).
  const activeKeys = useMemo(
    () => new Set(tasks.filter(isAcceptingSubmissions).flatMap((x) => [...(x.submissions ?? []).map((sub) => sub.agent), ...(x.claims ?? []).map((c) => c.agent)])),
    [tasks]
  );
  const activeAgents = useMemo(() => {
    const known = new Map(agents.map((a) => [a.pubkey, a]));
    return Array.from(activeKeys).map((k, i) => known.get(k) ?? ({
      name: `${k.slice(0, 4)}…${k.slice(-4)}`, pubkey: k, status: "WORKING", tasksCompleted: 0, totalScore: 0, x402Spending: 0, currentTaskId: null,
      color: AGENT_COLORS[i % AGENT_COLORS.length],
    } as AgentState));
  }, [agents, activeKeys]);

  const txRows = [...txLog, ...escrowTx.filter((e) => !txLog.some((x) => x.hash === e.hash))].map((e) => {
    const site = tasks.find((x) => x.contractTaskId !== undefined && x.contractTaskId === e.taskId);
    return site ? { ...e, taskId: site.id } : e.taskId !== undefined && e.taskId > 1e6 ? { ...e, taskId: undefined } : e;
  });

  const openPost = () => { if (connected) setShowPostModal(true); };

  /* ── Columns ─────────────────────────────────────────────────────────── */
  const tasksColumn = (
    <section className={`ui-card ${s.col}`} aria-label={t({ en: "Task pool", tr: "Görev havuzu" })}>
      <header className={s.colHead}>
        <div>
          <div className="ui-h3" style={{ fontSize: 16 }}>{t({ en: "Task pool", tr: "Görev havuzu" })}</div>
          <div className="ui-small">{t({ en: `${openCount} live, ${tasks.length} total`, tr: `${openCount} canlı, toplam ${tasks.length}` })}</div>
        </div>
        {connected && (
          <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={openPost}>+ {t({ en: "Post", tr: "Görev aç" })}</button>
        )}
      </header>
      <div className={s.colBody}>
        {tasks.length === 0 ? (
          <div className="ui-empty">{pl.emptyMissions}</div>
        ) : poolTasks.map((task) => {
          const rew = (task.rewardUsdc ?? task.reward / 1e7);
          const isSelected = selectedTask?.id === task.id;
          const shownStatus = displayStatus(task);
          const isPoster = !!publicKey && task.poster === publicKey.toString();
          return (
            <div key={task.id}>
              <div
                role="button"
                tabIndex={0}
                className={`${s.taskRow}${isSelected ? ` ${s.taskRowOn}` : ""}`}
                onClick={() => { setSelectedTask(task); setCenterTab("detail"); setMobileTab("live"); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedTask(task); setCenterTab("detail"); setMobileTab("live"); } }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span className={statusBadge(shownStatus)}>{t(STATUS_LABEL[shownStatus] ?? { en: shownStatus, tr: shownStatus })}</span>
                  <span className="ui-mono ui-muted" style={{ fontSize: 12 }}>#{task.id}</span>
                  {isPoster && (
                    <button
                      type="button"
                      className={s.iconGhost}
                      onClick={(e) => { e.stopPropagation(); setDeleteConfirm(deleteConfirm === task.id ? null : task.id); }}
                      title={ui.sidebar.removeTitle}
                      aria-label={ui.sidebar.removeTitle}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
                    </button>
                  )}
                </div>
                <div className={s.taskText}>{task.description}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
                  <span className="ui-num" style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: 14 }}>{rew.toLocaleString("en-US", { maximumFractionDigits: 4 })} XLM</span>
                  <Countdown deadline={task.deadline} />
                </div>
              </div>
              {deleteConfirm === task.id && (
                <div className={s.confirm} onClick={(e) => e.stopPropagation()}>
                  <div className="ui-small" style={{ marginBottom: 10 }}>{ui.sidebar.removeConfirm}</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" className="ui-btn ui-btn-sm" style={{ flex: 1, background: "var(--red-dim)", color: "var(--red)" }} onClick={() => deleteTask(task.id)}>{dash.remove}</button>
                    <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" style={{ flex: 1 }} onClick={() => setDeleteConfirm(null)}>{dash.cancel}</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {endedCount > 0 && (
          <button type="button" className={s.endedToggle} onClick={() => setShowEnded((v) => !v)}>
            {showEnded ? t({ en: "Hide ended tasks", tr: "Biten görevleri gizle" }) : t({ en: `Show ${endedCount} ended tasks`, tr: `Biten ${endedCount} görevi göster` })}
          </button>
        )}
      </div>
    </section>
  );

  const liveColumn = !selectedTask ? (
    <section className={`ui-card ${s.col}`} aria-label={t({ en: "Live activity", tr: "Canlı akış" })}>
      <header className={s.colHead}>
        <div>
          <div className="ui-h3" style={{ fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
            <span className="ui-badge ui-badge-live ui-badge-dot ui-pulse" style={{ height: 20, padding: "0 8px", fontSize: 11 }}>{t({ en: "Live", tr: "Canlı" })}</span>
            {t({ en: "Activity", tr: "Akış" })}
          </div>
          <div className="ui-small">{t({ en: "Submissions, judge scores and escrow events", tr: "Teslimler, hakem puanları ve escrow hareketleri" })}</div>
        </div>
        <div className="ui-tabs" role="tablist">
          {([["all", t({ en: "All", tr: "Tümü" })], ["net", t({ en: "Agents", tr: "Agent'lar" })], ["sys", t({ en: "System", tr: "Sistem" })]] as [LogFilterKey, string][]).map(([k, label]) => (
            <button key={k} type="button" role="tab" className="ui-tab" aria-selected={logFilter === k} onClick={() => setLogFilter(k)} style={{ height: 28, padding: "0 10px", fontSize: 12 }}>{label}</button>
          ))}
        </div>
      </header>

      {/* Agents in play + judges */}
      <div className={s.strip}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="ui-small" style={{ marginBottom: 8 }}>{t({ en: "Agents in live tasks", tr: "Canlı görevlerdeki agent'lar" })}</div>
          {activeAgents.length === 0 ? (
            <div className="ui-small">{t({ en: "No agent is working on a live task right now.", tr: "Şu an canlı görevlerde çalışan agent yok." })}</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {activeAgents.slice(0, 10).map((a, i) => (
                <Link key={a.pubkey} href={`/agent/${a.pubkey}`} className={s.agentPill}>
                  <span className={s.agentDot} style={{ background: a.color || AGENT_COLORS[i % AGENT_COLORS.length] }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>{a.name}</span>
                </Link>
              ))}
              {activeAgents.length > 10 && <span className="ui-small" style={{ alignSelf: "center" }}>+{activeAgents.length - 10}</span>}
            </div>
          )}
        </div>
        <div className={s.judges}>
          <div className="ui-small" style={{ marginBottom: 8 }}>{t({ en: "Judge panel", tr: "Hakem paneli" })}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {JUDGE_NAMES.map((name) => {
              const busy = judges[name] === "EVALUATING";
              return (
                <div key={name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                  <span style={{ color: "var(--text-secondary)" }}>{JUDGE_LABELS[name]}</span>
                  <span className={busy ? "ui-badge ui-badge-blue ui-badge-dot ui-pulse" : "ui-badge ui-badge-live"} style={{ height: 20, fontSize: 11, padding: "0 8px" }}>
                    {busy ? sf.evaluating : sf.ready}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className={s.colBody} style={{ padding: 0 }}>
        {shownActivity.length === 0 ? (
          <div className="ui-empty">{activity.length === 0 ? t({ en: "Waiting for the first submission or escrow event.", tr: "Henüz teslim ya da escrow hareketi yok." }) : dash.logFilterEmpty}</div>
        ) : shownActivity.map((e, i) => (
          <div key={e.id || i} className={s.feedRow}>
            <span suppressHydrationWarning className="ui-mono ui-muted" style={{ fontSize: 12, flexShrink: 0, minWidth: 64 }}>
              {e.timeStr && e.timeStr !== "--:--:--" ? e.timeStr : new Date(e.time).toLocaleTimeString(undefined, { hour12: false })}
            </span>
            <span className={e.icon === "tx" ? "ui-badge ui-badge-accent" : e.icon === "judge" ? "ui-badge ui-badge-blue" : "ui-badge"} style={{ height: 20, fontSize: 11, padding: "0 8px", flexShrink: 0 }}>
              {e.icon === "tx" ? t({ en: "Escrow", tr: "Escrow" }) : e.icon === "judge" ? t({ en: "Judges", tr: "Hakem" }) : t({ en: "Agent", tr: "Agent" })}
            </span>
            <span style={{ fontSize: 13.5, color: "var(--text-primary)", lineHeight: 1.5, minWidth: 0, wordBreak: "break-word" }}>{e.message}</span>
          </div>
        ))}
      </div>
    </section>
  ) : (
    <section className={`ui-card ${s.col}`} aria-label={t({ en: "Task detail", tr: "Görev detayı" })}>
      <header className={s.detailHead}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className={statusBadge(displayStatus(selectedTask))}>{t(STATUS_LABEL[displayStatus(selectedTask)] ?? { en: selectedTask.status, tr: selectedTask.status })}</span>
          <span className="ui-mono ui-muted" style={{ fontSize: 12 }}>#{selectedTask.id}</span>
          <span className="ui-num" style={{ marginLeft: "auto", fontWeight: 700, fontSize: 18, color: "var(--text-primary)" }}>
            {(selectedTask.rewardUsdc ?? selectedTask.reward / 1e7).toLocaleString("en-US", { maximumFractionDigits: 4 })} <span className="ui-muted" style={{ fontSize: 13, fontWeight: 500 }}>XLM</span>
          </span>
          <button type="button" className="ui-icon-btn" style={{ width: 32, height: 32 }} title={pl.close} aria-label={pl.close} onClick={() => { setSelectedTask(null); setCenterTab("detail"); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <p className={s.detailText}>{selectedTask.description}</p>
        {selectedTask.criteria && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12, alignItems: "center" }}>
            <span className="ui-small" style={{ marginRight: 2 }}>{t({ en: "Criteria", tr: "Kriterler" })}</span>
            {selectedTask.criteria.split(/[;,]/).map((c) => c.trim()).filter(Boolean).slice(0, 8).map((chip) => (
              <span key={chip} className="ui-badge" style={{ height: "auto", padding: "3px 10px", whiteSpace: "normal", fontWeight: 500 }}>{chip}</span>
            ))}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          <div className="ui-tabs" role="tablist">
            {(["detail", "agent", "court"] as const).map((tab) => (
              <button key={tab} type="button" role="tab" className="ui-tab" aria-selected={centerTab === tab} onClick={() => setCenterTab(tab)}>
                {tab === "detail" ? t({ en: "Scores", tr: "Puanlar" }) : tab === "agent" ? t({ en: "Agent run", tr: "Agent çalışması" }) : t({ en: "Dispute court", tr: "İtiraz mahkemesi" })}
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <Link href={`/task/${selectedTask.id}`} className="ui-btn ui-btn-ghost ui-btn-sm">{t({ en: "Open task page", tr: "Görev sayfası" })} →</Link>
          {selectedTask.status === "Open" && agentPanelTaskId !== selectedTask.id && (
            <button type="button" onClick={() => handleAssignTask(selectedTask)} className="ui-btn ui-btn-secondary ui-btn-sm">{ui.taskDetail.assign}</button>
          )}
          {selectedTask.status === "AwaitingDecision" && (
            <button type="button" onClick={() => setCenterTab("agent")} className="ui-btn ui-btn-primary ui-btn-sm">{dash.decisionFlow}</button>
          )}
          {(selectedTask.status === "Disputed" || selectedTask.status === "Resolved") && (
            <button type="button" onClick={() => setCenterTab("court")} className="ui-btn ui-btn-sm" style={{ background: "var(--red-dim)", color: "var(--red)" }}>{ui.taskDetail.court}</button>
          )}
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ display: centerTab === "detail" ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0, overflowY: "auto", padding: 16, gap: 14 }}>
          {(() => {
            const ps = agentPanelStates[selectedTask.id]?.judgeScores ?? [];
            const dv = ps.map((js, i) => ({ judgeId: i + 1, judgeName: js.name, agent: agents[0]?.pubkey || "", score: js.score, reasoning: js.comment }));
            const verdicts = dv.length > 0 ? dv : (selectedTask.verdicts ?? []);
            const isEval = selectedTask.status === "UnderReview" && verdicts.length < 3;
            return <JudgePanel verdicts={verdicts} taskId={selectedTask.id} isEvaluating={isEval} />;
          })()}
          {selectedTask.submissions.length > 0 ? (
            <div className="ui-card" style={{ boxShadow: "none", background: "var(--bg-surface-low)", overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--bg-border)", fontWeight: 600, fontSize: 14, color: "var(--text-primary)" }}>
                {dash.submissions(selectedTask.submissions.length)}
              </div>
              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead><tr><th>{t({ en: "Agent", tr: "Agent" })}</th><th>{t({ en: "Time", tr: "Süre" })}</th><th>{t({ en: "Result hash", tr: "Cevap hash'i" })}</th></tr></thead>
                  <tbody>
                    {selectedTask.submissions.map((sub, i) => (
                      <tr key={i}>
                        <td><Link href={`/agent/${sub.agent}`} className="ui-mono" style={{ color: "var(--text-primary)", textDecoration: "none" }}>{shortenAddress(sub.agent)}</Link></td>
                        <td className="ui-num">{dash.seconds(sub.timeTakenSeconds)}</td>
                        <td className="ui-mono ui-muted" style={{ fontSize: 12 }}>{sub.resultHash.substring(0, 16)}…</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="ui-empty">{selectedTask.status === "Open" ? ui.taskDetail.noSubmissions : ui.taskDetail.taskStopped}</div>
          )}
        </div>

        <div style={{ display: centerTab === "agent" ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
          {agentPanelTaskId === selectedTask.id || selectedTask.status === "UnderReview" || selectedTask.status === "AwaitingDecision" ? (
            <AgentWorkPanel
              key={`panel-${agentPanelTaskId ?? selectedTask.id}`}
              task={selectedTask}
              agentA={{ name: agents[0]?.name?.toLowerCase() || "nova", pubkey: agents[0]?.pubkey || "" }}
              agentB={{ name: agents[1]?.name?.toLowerCase() || "vega", pubkey: agents[1]?.pubkey || "" }}
              onClose={() => setCenterTab("detail")}
              onApprove={handleAgentApprove}
              onReject={handleAgentReject}
              onJudgesComplete={() => handleJudgesComplete(selectedTask.id)}
              savedState={agentPanelStates[selectedTask.id] ?? null}
              onSaveState={(st) => setAgentPanelStates((p) => ({ ...p, [selectedTask.id]: st }))}
            />
          ) : (
            <div className="ui-empty">{ui.taskDetail.assignHint}</div>
          )}
        </div>

        <div style={{ display: centerTab === "court" ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
          <CourtRoom
            key={`court-${selectedTask.id}`}
            task={selectedTask}
            onClose={() => setCenterTab("detail")}
            prefillAgentResult={courtData?.agentResult ?? agentPanelStates[selectedTask.id]?.agentResult}
            prefillDisputeReason={courtData?.disputeReason}
            onVerdict={() => {
              // Agent Court is an off-chain AI roleplay (on-chain resolution
              // is a deferred deliverable): record the ruling in the feed,
              // never a fabricated on-chain transaction.
              const now = new Date(); const taskId = selectedTask.id;
              const tloc = locale === "tr" ? "tr-TR" : "en-US";
              setTasks((p) => p.map((x) => x.id === taskId ? { ...x, status: "Resolved" } : x));
              setSelectedTask((p) => p?.id === taskId ? { ...p, status: "Resolved" } : p);
              setFeed((p) => [{ id: Date.now(), time: now.toISOString(), timeStr: now.toLocaleTimeString(tloc, { hour12: false }), message: ui.feedDyn.court(taskId), icon: "judge", agent: "judge" }, ...p]);
            }}
          />
        </div>
      </div>
    </section>
  );

  const txColumn = (
    <section className={`ui-card ${s.col}`} aria-label={t({ en: "Escrow transactions", tr: "Escrow işlemleri" })}>
      <header className={s.colHead}>
        <div>
          <div className="ui-h3" style={{ fontSize: 16 }}>{t({ en: "Escrow transactions", tr: "Escrow işlemleri" })}</div>
          <div className="ui-small">{t({ en: "Read from the contract's own events", tr: "Doğrudan kontratın olaylarından" })}</div>
        </div>
      </header>
      <div className={s.colBody} style={{ padding: 0 }}>
        {txRows.length === 0 ? (
          <div className="ui-empty">{ui.tx.emptyLine1}</div>
        ) : txRows.map((tx, i) => (
          <a key={tx.id || i} href={explorerTx(tx.hash)} target="_blank" rel="noopener noreferrer" className={`${s.txRow}${tx.highlight ? ` ${s.txNew}` : ""}`}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span className="ui-mono" style={{ fontSize: 13, fontWeight: 600, color: txColor(tx.type) }}>{tx.type}</span>
              <span className="ui-num" style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{tx.amount || (tx.score !== undefined ? `${tx.score}/100` : "")}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 6 }}>
              <span className="ui-small" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {tx.winner ? <span style={{ color: "var(--green)" }}>→ {tx.winner.length > 10 ? shortenAddress(tx.winner) : tx.winner}</span>
                  : tx.agent ? tx.agent : tx.judge ? tx.judge : null}
                {tx.taskId ? <span style={{ marginLeft: 8 }}>{t({ en: "task", tr: "görev" })} #{tx.taskId}</span> : null}
              </span>
              <span className="ui-mono ui-muted" style={{ fontSize: 11, flexShrink: 0 }}>{tx.hash ? `${tx.hash.slice(0, 6)}… ↗` : ""}</span>
            </div>
          </a>
        ))}
      </div>
    </section>
  );

  return (
    <PageShell footer={false}>
      <div className={s.wrap}>
        {/* Page head */}
        <div className={s.head}>
          <div>
            <h1 className="ui-page-title" style={{ fontSize: "clamp(26px, 3vw, 34px)" }}>{t({ en: "Dashboard", tr: "Panel" })}</h1>
            <p className="ui-small" style={{ marginTop: 6, fontSize: 14 }}>
              {t({ en: "The live task pool, judging and escrow activity on Stellar mainnet.", tr: "Stellar mainnet'teki canlı görevler, puanlar ve escrow hareketleri tek ekranda." })}
            </p>
          </div>
          <div className={s.headActions}>
            {connected && publicKey ? (
              <>
                {usdcBalance !== null && (
                  <span className="ui-badge" style={{ height: 32, padding: "0 12px", fontSize: 13 }}>
                    {t({ en: "Balance", tr: "Bakiye" })} <b className="ui-num" style={{ color: "var(--text-primary)" }}>{usdcBalance.toFixed(2)} XLM</b>
                  </span>
                )}
                <button type="button" className="ui-btn ui-btn-secondary" onClick={() => router.push(`/agent/${publicKey.toString()}`)}>{t({ en: "My profile", tr: "Profilim" })}</button>
                <button type="button" className="ui-btn ui-btn-ghost" onClick={() => router.push("/projects")}>{t({ en: "NEXUS projects", tr: "NEXUS projeleri" })}</button>
                <button type="button" className="ui-btn ui-btn-primary" onClick={openPost}>{sf.postTask}</button>
              </>
            ) : (
              <button type="button" className="ui-btn ui-btn-ghost" onClick={() => router.push("/projects")}>{t({ en: "NEXUS projects", tr: "NEXUS projeleri" })}</button>
            )}
          </div>
        </div>

        {!connected && (
          <div className={`ui-card ${s.connect}`}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
              <span className={s.connectIcon} aria-hidden>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M16 12.5h2M3 10h18" /></svg>
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 15 }}>{t({ en: "Connect a wallet to post a task", tr: "Görev açmak için cüzdanını bağla" })}</div>
                <div className="ui-small" style={{ marginTop: 2 }}>
                  {t({ en: "Everything below is public. Posting locks your XLM reward in the Soroban escrow and needs a Stellar wallet such as Freighter.", tr: "Buradaki her şey herkese açık. Görev açmak için Freighter gibi bir Stellar cüzdanı gerekir; açtığın görevin XLM ödülü Soroban escrow'una kilitlenir." })}
                </div>
              </div>
            </div>
            <ConnectWallet />
          </div>
        )}

        {/* Stats */}
        <div className={s.stats}>
          {[
            { v: openCount.toLocaleString("en-US"), l: t({ en: "Live tasks", tr: "Canlı görev" }) },
            { v: settledCount.toLocaleString("en-US"), l: t({ en: "Paid out", tr: "Ödenen" }) },
            { v: agentTotal ? agentTotal.toLocaleString("en-US") : "…", l: t({ en: "Registered agents", tr: "Kayıtlı agent" }) },
            { v: `${tasks.filter(isAcceptingSubmissions).reduce((sum, x) => sum + (x.rewardUsdc ?? x.reward / 1e7), 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} XLM`, l: t({ en: "Locked in live tasks", tr: "Canlı görevlerde kilitli" }) },
          ].map((st) => (
            <div key={st.l} className={`ui-card ${s.stat}`}>
              <div className="ui-stat-value" style={{ fontSize: 24 }}>{st.v}</div>
              <div className="ui-stat-label">{st.l}</div>
            </div>
          ))}
        </div>

        {/* Mobile switcher */}
        <div className={s.mobileTabs}>
          <div className="ui-tabs" role="tablist" style={{ width: "100%", justifyContent: "space-between" }}>
            {([["tasks", t({ en: "Tasks", tr: "Görevler" })], ["live", selectedTask ? t({ en: "Detail", tr: "Detay" }) : t({ en: "Activity", tr: "Akış" })], ["tx", t({ en: "Escrow", tr: "Escrow" })]] as ["tasks" | "live" | "tx", string][]).map(([k, label]) => (
              <button key={k} type="button" role="tab" className="ui-tab" aria-selected={mobileTab === k} onClick={() => setMobileTab(k)} style={{ flex: 1 }}>{label}</button>
            ))}
          </div>
        </div>

        <div className={s.grid}>
          <div className={s.area} data-show={mobileTab === "tasks"}>{tasksColumn}</div>
          <div className={s.area} data-show={mobileTab === "live"}>{liveColumn}</div>
          <div className={s.area} data-show={mobileTab === "tx"}>{txColumn}</div>
        </div>
      </div>

      {showPostModal && connected && <PostTaskModal onClose={() => setShowPostModal(false)} onTaskPosted={handleTaskPosted} />}
    </PageShell>
  );
}
