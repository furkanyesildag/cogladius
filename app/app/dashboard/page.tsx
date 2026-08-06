"use client";

import { useState, useEffect, useRef, useMemo, type CSSProperties } from "react";
import { useWallet } from "@/lib/useWallet";
import ConnectWallet from "@/components/ConnectWallet";
import { useRouter } from "next/navigation";

import PostTaskModal from "@/components/PostTaskModal";
import JudgePanel from "@/components/JudgePanel";
import CourtRoom from "@/components/CourtRoom";
import AgentWorkPanel, { AgentPanelSavedState } from "@/components/AgentWorkPanel";
import { ThemeToggle } from "@/components/ThemeProvider";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useMessages, useLocale } from "@/lib/i18n";

import { Task, AgentState, JudgeState, FeedEntry, TxEntry } from "@/lib/types";
import { AGENT_API_POLL_MS, POLL_INTERVAL_MS, shortenAddress, explorerAddress, explorerTx, usdcToStroops } from "@/lib/constants";
import { fetchUsdcBalance, EXPLORER_TX } from "@/lib/stellar";

// Real registered agents are loaded from /api/agents/list; no demo agents.
const DEFAULT_AGENTS: AgentState[] = [];
const AGENT_COLORS = ["#40e183", "#adc6ff", "#FFD166", "#FF8C42", "#B97DFF", "#7C9EFF"];
const DEFAULT_JUDGES: JudgeState = {
  TeknikHakem: "READY", KullanılabilirlikHakemi: "READY", KapsamHakemi: "READY",
};

function getTaskBadgeClass(status: string): string {
  if (status === "Open")             return "badge badge-open";
  if (status === "UnderReview")      return "badge badge-review";
  if (status === "AwaitingDecision") return "badge badge-awaiting";
  if (status === "Settled")          return "badge badge-settled";
  if (status === "Disputed")         return "badge badge-disputed";
  if (status === "Resolved")         return "badge badge-resolved";
  return "badge badge-stopped";
}

function getTaskCardClass(status: string): string {
  if (status === "Open")             return "task-card task-card-open";
  if (status === "UnderReview")      return "task-card task-card-review";
  if (status === "AwaitingDecision") return "task-card task-card-awaiting";
  if (status === "Settled")          return "task-card task-card-settled";
  if (status === "Disputed")         return "task-card task-card-disputed";
  return "task-card task-card-stopped";
}

type LogFilterKey = "all" | "alpha" | "beta" | "sys" | "net" | "debug";
function logEntryMatchesFilter(entry: FeedEntry, f: LogFilterKey): boolean {
  if (f === "all") return true;
  const ic = (entry.icon || "").toLowerCase();
  const ag = (entry.agent || "").toLowerCase();
  if (f === "alpha") return ic === "alpha" || ag.includes("alpha") || ag.includes("nova");
  if (f === "beta") return ic === "beta" || ag.includes("beta") || ag.includes("vega");
  if (f === "sys") return ["tx", "sys", "judge"].includes(ic) || ag.includes("hakem") || ag === "judge" || ag === "tx";
  if (f === "net") return ic === "net" || ag.includes("network");
  if (f === "debug") return ic === "debug" || ag.includes("debug");
  return true;
}

function Countdown({ deadline }: { deadline: number }) {
  const ended = useMessages().ui.time.ended;
  const [rem, setRem] = useState("");
  const [urgent, setUrgent] = useState(false);
  useEffect(() => {
    const tick = () => {
      const d = deadline - Math.floor(Date.now() / 1000);
      if (d <= 0) { setRem(ended); return; }
      setUrgent(d < 120);
      const h = Math.floor(d / 3600); const m = Math.floor((d % 3600) / 60); const s = d % 60;
      setRem(h > 0 ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${m}:${String(s).padStart(2,"0")}`);
    };
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id);
  }, [deadline, ended]);
  return (
    <span style={{ fontFamily: "var(--font)", fontSize: 10, color: urgent ? "var(--yellow)" : "rgba(var(--text-rgb),0.4)", display: "flex", alignItems: "center", gap: 3 }}>
      <span className="material-symbols-outlined" style={{ fontSize: 11 }}>schedule</span>
      {rem}
    </span>
  );
}

/* ── HUD Map section ──────────────────────────────────────────────────────── */
function HudMap({ agents, tasks, totalX402 }: { agents: AgentState[]; tasks: import("@/lib/types").Task[]; totalX402: number }) {
  const h = useMessages().ui.hud;
  const [barPct, setBarPct] = useState<Record<string, number>>({});
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setBarPct((p) => {
      const o = { ...p };
      for (const a of agents) { if (o[a.name] === undefined) o[a.name] = 15; }
      for (const k of Object.keys(o)) { if (!agents.some((a) => a.name === k)) delete o[k]; }
      return o;
    });
  }, [agents]);

  useEffect(() => {
    const id = setInterval(() => {
      setTick((t) => t + 1);
      setBarPct((prev) => {
        const out: Record<string, number> = { ...prev };
        for (const a of agents) {
          out[a.name] = a.status.startsWith("WORKING") ? 70 : 15;
        }
        return out;
      });
    }, 2000);
    return () => clearInterval(id);
  }, [agents]);

  const workingCount = agents.filter((a) => a.status.startsWith("WORKING")).length;
  const openTasks = tasks.filter((t) => t.status === "Open").length;
  const settledTasks = tasks.filter((t) => t.status === "Settled").length;

  return (
    <div className="hud-surface" style={{ position: "relative" }}>
      {/* Scanlines */}
      <div className="scanline-overlay" style={{ position: "absolute", inset: 0, zIndex: 1 }} />
      {/* Grid dots pattern */}
      <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle, rgba(255,86,37,0.06) 1px, transparent 1px)", backgroundSize: "32px 32px", zIndex: 0 }} />
      {/* Central glow */}
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 300, height: 200, background: "radial-gradient(ellipse, rgba(255,86,37,0.07) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />

      {/* Top stats strip */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, display: "flex", alignItems: "center", gap: 0, zIndex: 3, borderBottom: "1px solid rgba(255,86,37,0.08)" }}>
        {[
          { label: h.network.replace("Net: ", ""), val: "MAINNET", color: "var(--green)" },
          { label: "OPEN", val: String(openTasks), color: "var(--accent)" },
          { label: "SETTLED", val: String(settledTasks), color: "#40E183" },
          { label: "AGENTS", val: `${workingCount}/${agents.length}`, color: agents.length > 0 && workingCount > 0 ? "var(--green)" : "rgba(var(--text-rgb),0.4)" },
          { label: "x402", val: `${totalX402.toFixed(3)} XLM`, color: "var(--accent)" },
        ].map((s, i) => (
          <div key={s.label} style={{ flex: 1, padding: "5px 12px", borderRight: i < 4 ? "1px solid rgba(var(--white-rgb),0.04)" : "none", textAlign: "center" }}>
            <div style={{ fontFamily: "var(--font)", fontSize: 7, color: "rgba(var(--text-rgb),0.28)", letterSpacing: "0.12em", marginBottom: 2 }}>{s.label}</div>
            <div style={{ fontFamily: "var(--font)", fontSize: 11, fontWeight: 800, color: s.color, letterSpacing: "0.04em" }}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Center label */}
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 2, top: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: workingCount > 0 ? "var(--green)" : "rgba(var(--white-rgb),0.2)", animation: workingCount > 0 ? "pulse 1.5s infinite" : "none" }} />
          <span style={{ fontFamily: "var(--font)", fontSize: 8, color: "rgba(var(--text-rgb),0.35)", letterSpacing: "0.18em", textTransform: "uppercase" }}>{h.kicker}</span>
        </div>
        <div style={{ fontFamily: "var(--font)", fontSize: 18, fontWeight: 900, color: "var(--text-primary)", letterSpacing: "0.06em" }}>{h.title}</div>
      </div>

      {/* Agent progress bars */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "10px 14px", background: "linear-gradient(to top, rgba(var(--base-rgb),0.9) 0%, rgba(var(--base-rgb),0.5) 100%)", zIndex: 3, display: "flex", gap: 16 }}>
        {agents.map((agent) => {
          const isWorking = agent.status.startsWith("WORKING");
          const progress = barPct[agent.name] ?? 15;
          const avg = agent.tasksCompleted > 0 ? Math.round(agent.totalScore / agent.tasksCompleted) : 0;
          return (
            <div key={agent.name} style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div className={isWorking ? "pulse-ring" : ""} style={{ width: 7, height: 7, borderRadius: "50%", background: isWorking ? agent.color : "rgba(var(--white-rgb),0.15)", flexShrink: 0, position: "relative", boxShadow: isWorking ? `0 0 8px ${agent.color}` : "none" }} />
                  <span style={{ fontFamily: "var(--font)", fontSize: 10, fontWeight: 700, color: agent.color, letterSpacing: "0.04em" }}>{agent.name.replace("-", "_")}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {avg > 0 && <span style={{ fontFamily: "var(--font)", fontSize: 9, color: avg >= 70 ? "var(--green)" : "#FFD166" }}>◈{avg}</span>}
                  <span style={{ fontFamily: "var(--font)", fontSize: 9, color: isWorking ? agent.color : "rgba(var(--text-rgb),0.3)" }}>
                    {isWorking ? h.done(progress) : h.idle}
                  </span>
                </div>
              </div>
              <div style={{ height: 3, background: "rgba(var(--white-rgb),0.06)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${progress}%`, height: "100%", background: agent.color, transition: "width 1.2s ease", opacity: isWorking ? 1 : 0.3, boxShadow: isWorking ? `0 0 6px ${agent.color}` : "none" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontFamily: "var(--font)", fontSize: 8, color: "rgba(var(--text-rgb),0.2)" }}>
                <span>{agent.pubkey.substring(0,6)}…{agent.pubkey.slice(-3)}</span>
                <span>{agent.x402Spending.toFixed(3)} XLM</span>
              </div>
            </div>
          );
        })}
        {agents.length === 0 && (
          <div style={{ flex: 1, textAlign: "center", fontFamily: "var(--font)", fontSize: 9, color: "rgba(var(--text-rgb),0.2)", letterSpacing: "0.1em", paddingBottom: 4 }}>
            NO ACTIVE AGENTS
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Live feed / terminal ─────────────────────────────────────────────────── */
function LiveTerminal({ entries, agents }: { entries: FeedEntry[]; agents: AgentState[] }) {
  const tf = useMessages().ui.feed;
  const ref = useRef<HTMLDivElement>(null);
  function getTag(icon: string, agent?: string): { label: string; cls: string; color?: string } {
    const a = (agent || icon || "").toLowerCase();
    if (a.includes("alpha") || a.includes("nova")) return { label: "AGENT_01", cls: "feed-tag-alpha", color: agents[0]?.color };
    if (a.includes("beta") || a.includes("vega"))  return { label: "AGENT_02", cls: "feed-tag-beta",  color: agents[1]?.color };
    if (a.includes("hakem") || a.includes("judge")) return { label: "SYSTEM", cls: "feed-tag-tx" };
    if (a === "tx" || icon === "tx") return { label: "SYSTEM", cls: "feed-tag-tx" };
    if (a.includes("network")) return { label: "NETWORK", cls: "feed-tag-net" };
    if (a.includes("debug")) return { label: "DEBUG", cls: "feed-tag-debug" };
    return { label: "SYSTEM", cls: "feed-tag-tx" };
  }
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "10px 0" }} ref={ref}>
      {entries.length === 0 ? (
        <div style={{ padding: "40px 16px", textAlign: "center", fontFamily: "var(--font)", fontSize: 11, color: "rgba(var(--text-rgb),0.25)", lineHeight: 2 }}>
          {tf.emptyLine1}<br />
          <span style={{ fontSize: 10 }}>{tf.emptyLine2}</span>
        </div>
      ) : entries.map((e, i) => {
        const tag = getTag(e.icon, e.agent);
        return (
          <div key={e.id || i} className="terminal-row feed-entry">
            <span suppressHydrationWarning style={{ fontFamily: "var(--font)", fontSize: 10, color: "rgba(var(--text-rgb),0.3)", flexShrink: 0, minWidth: 64 }}>
              [{e.timeStr && e.timeStr !== "--:--:--" ? e.timeStr : new Date(e.time).toLocaleTimeString(undefined, { hour12: false })}]
            </span>
            <span
              className={`feed-tag ${tag.cls}`}
              style={tag.color ? { color: tag.color, background: `${tag.color}1f`, border: `1px solid ${tag.color}55` } : undefined}
            >
              {tag.label}
            </span>
            <span style={{ fontFamily: "var(--font)", fontSize: 11, color: "var(--text-primary)", flex: 1 }}>{e.message}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ── TxFeed column ────────────────────────────────────────────────────────── */
function TxColumn({ txLog, onClose }: { txLog: TxEntry[]; onClose?: () => void }) {
  const pl = useMessages().ui.panels;
  const txe = useMessages().ui.tx;
  function col(type: string): string {
    if (type.includes("settle") || type.includes("reward")) return "var(--green)";
    if (type.includes("dispute") || type.includes("resolve")) return "var(--red)";
    return "var(--accent)";
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header className="kl-panel-header">
        <div className="kl-panel-header__icon" aria-hidden>
          <span className="material-symbols-outlined">account_balance_wallet</span>
        </div>
        <span className="kl-panel-header__title">{pl.txFeed}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div className="pulse-dot" style={{ width: 5, height: 5, flexShrink: 0 }} />
          <span className="kl-panel-header__meta">{pl.liveTicker}</span>
        </div>
        {onClose ? (
          <button
            type="button"
            className="kl-icon-btn-ghost"
            title={pl.close}
            onClick={onClose}
            aria-label={pl.close}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>close</span>
          </button>
        ) : null}
      </header>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {txLog.length === 0 ? (
          <div style={{ padding: "32px 14px", textAlign: "center", fontFamily: "var(--font)", fontSize: 10, color: "rgba(var(--text-rgb),0.25)", lineHeight: 2 }}>
            {txe.emptyLine1}<br />{txe.emptyLine2}
          </div>
        ) : txLog.map((tx, i) => (
          <div key={tx.id || i} className={`tx-feed-row${tx.highlight ? " tx-new" : ""}`}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontFamily: "var(--font)", fontSize: 11, fontWeight: 700, color: col(tx.type) }}>{tx.type}</span>
              <span style={{ fontFamily: "var(--font)", fontSize: 10, color: tx.type.includes("settle") ? "var(--green)" : "var(--accent)" }}>
                {tx.amount || (tx.score !== undefined ? `${tx.score}/100` : "")}
              </span>
            </div>
            <div style={{ fontFamily: "var(--font)", fontSize: 10, color: "rgba(var(--text-rgb),0.4)", marginBottom: 4 }}>
              {tx.winner ? <span style={{ color: "var(--green)" }}>→ {tx.winner.length > 10 ? shortenAddress(tx.winner) : tx.winner}</span>
                : tx.agent ? tx.agent.toLowerCase() : tx.judge ? tx.judge.toLowerCase() : null}
              {tx.taskId ? <span style={{ color: "rgba(var(--text-rgb),0.25)", marginLeft: 6 }}>#{tx.taskId}</span> : null}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "rgba(var(--text-rgb),0.25)" }}>
                {tx.ms ? `${tx.ms}ms` : ""}
              </span>
              <a href={explorerTx(tx.hash)} target="_blank" rel="noopener noreferrer"
                style={{ color: "rgba(var(--text-rgb),0.2)", display: "flex", alignItems: "center", textDecoration: "none", transition: "color 0.12s" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(var(--text-rgb),0.2)")}>
                <span className="material-symbols-outlined" style={{ fontSize: 13 }}>open_in_new</span>
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN DASHBOARD
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
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showPostModal, setShowPostModal] = useState(false);
  const [centerTab, setCenterTab]       = useState<"detail" | "agent" | "court">("detail");
  const [usdcBalance, setUsdcBalance]     = useState<number | null>(null);
  const [courtData, setCourtData]       = useState<{ agentResult: string; disputeReason: string } | null>(null);
  const [agentPanelTaskId, setAgentPanelTaskId] = useState<number | null>(null);
  const [agentPanelStates, setAgentPanelStates] = useState<Record<number, AgentPanelSavedState>>({});
  const [sidebarTab, setSidebarTab]     = useState<"agents" | "tasks" | "logs" | "txfeed">("agents");
  const [termInput, setTermInput]       = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [editingTask, setEditingTask]   = useState<Task | null>(null);

  // ── Panel visibility & width state ──────────────────────────────────────────
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(isMobile);  // sol sidebar icon-only
  const [missionsOpen, setMissionsOpen]         = useState(!isMobile); // ACTIVE_MISSIONS panel
  const [missionsWidth, setMissionsWidth]       = useState(280);       // genişlik (px)
  const [txFeedOpen, setTxFeedOpen]             = useState(!isMobile); // TX_FEED panel
  const [txFeedWidth, setTxFeedWidth]           = useState(260);       // genişlik (px)
  const [logsOpen, setLogsOpen]                 = useState(false);  // LOGS overlay
  const [logFilter, setLogFilter]               = useState<LogFilterKey>("all");

  // Resize drag refs
  const missionsDragRef  = useRef<{ startX: number; startW: number } | null>(null);
  const txFeedDragRef    = useRef<{ startX: number; startW: number } | null>(null);

  function startMissionsDrag(e: React.MouseEvent) {
    missionsDragRef.current = { startX: e.clientX, startW: missionsWidth };
    const onMove = (ev: MouseEvent) => {
      if (!missionsDragRef.current) return;
      const delta = ev.clientX - missionsDragRef.current.startX;
      setMissionsWidth(Math.max(180, Math.min(480, missionsDragRef.current.startW + delta)));
    };
    const onUp = () => { missionsDragRef.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function startTxFeedDrag(e: React.MouseEvent) {
    txFeedDragRef.current = { startX: e.clientX, startW: txFeedWidth };
    const onMove = (ev: MouseEvent) => {
      if (!txFeedDragRef.current) return;
      const delta = txFeedDragRef.current.startX - ev.clientX;
      setTxFeedWidth(Math.max(160, Math.min(440, txFeedDragRef.current.startW + delta)));
    };
    const onUp = () => { txFeedDragRef.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  async function deleteTask(id: number) {
    // Drop it locally first so the UI responds immediately, then delete the
    // record server-side. Without the server call the task simply reappeared on
    // the next poll, which is what made "delete" look broken.
    const previous = tasks;
    setTasks((p) => p.filter((t) => t.id !== id));
    if (selectedTask?.id === id) setSelectedTask(null);
    setDeleteConfirm(null);
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poster: publicKey || "" }),
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem("aa_role")) router.replace("/");
  }, [router]);

  // Cüzdan bağlantısı kesilince landing page'e yönlendir
  useEffect(() => {
    if (!connected && typeof window !== "undefined" && localStorage.getItem("aa_role") === "user") {
      localStorage.removeItem("aa_role");
      router.replace("/");
    }
  }, [connected, router]);

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

  async function handleAgentApprove(agentResult: string, txHash: string) {
    if (!selectedTask) return;
    const now = new Date();
    const tloc = locale === "tr" ? "tr-TR" : "en-US";
    const reward = (selectedTask.rewardUsdc ?? 0).toFixed(4);

    // Release the XLM reward from the Soroban escrow contract → winning agent.
    let finalHash = txHash;
    let explorerUrl = "";
    let winnerStellar: string | undefined;
    try {
      const res = await fetch("/api/stellar/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: selectedTask.id, winnerPubkey: agents[0]?.pubkey }),
      });
      const data = await res.json();
      if (data.success) {
        finalHash = data.hash;
        explorerUrl = data.explorerUrl || EXPLORER_TX(data.hash);
        winnerStellar = data.winnerAddress;
      }
    } catch { /* fall back to the optimistic hash */ }

    setTasks((p) => p.map((t) => t.id === selectedTask.id ? { ...t, status: "Settled", settleTxHash: finalHash, winnerStellarAddress: winnerStellar ?? t.winnerStellarAddress } : t));
    setSelectedTask((p) => p?.id === selectedTask.id ? { ...p, status: "Settled", settleTxHash: finalHash, winnerStellarAddress: winnerStellar ?? p.winnerStellarAddress } : p);
    setFeed((p) => [{ id: Date.now(), time: now.toISOString(), timeStr: now.toLocaleTimeString(tloc, { hour12: false }), message: ui.feedDyn.approved(selectedTask.id, reward), icon: "tx", agent: "tx" }, ...p]);
    setTxLog((p) => [{ id: Date.now(), type: "release_to_winner()", hash: finalHash, taskId: selectedTask.id, amount: `+${reward} XLM`, winner: agents[0]?.name?.toLowerCase() || "nova", time: now.toISOString(), explorerUrl, slot: 0, ms: 0, highlight: true }, ...p]);
  }

  function handleAgentReject(agentResult: string, reason: string) {
    if (!selectedTask) return;
    const now = new Date();
    const tloc = locale === "tr" ? "tr-TR" : "en-US";
    setTasks((p) => p.map((t) => t.id === selectedTask.id ? { ...t, status: "Disputed" } : t));
    setFeed((p) => [{ id: Date.now(), time: now.toISOString(), timeStr: now.toLocaleTimeString(tloc, { hour12: false }), message: ui.feedDyn.court(selectedTask.id), icon: "judge", agent: "judge" }, ...p]);
    setCourtData({ agentResult, disputeReason: reason }); setCenterTab("court");
  }

  const JUDGE_NAMES = ["TeknikHakem", "KullanılabilirlikHakemi", "KapsamHakemi"] as const;
  const JUDGE_LABELS = ui.judgeNames;
  const JUDGE_ICONS: Record<string, string> = { TeknikHakem: "code", KullanılabilirlikHakemi: "accessibility", KapsamHakemi: "rule" };

  const totalX402 = agents.reduce((s, a) => s + a.x402Spending, 0);
  const dash = ui.dashboard;

  const filteredLogFeed = useMemo(
    () => feed.filter((e) => logEntryMatchesFilter(e, logFilter)),
    [feed, logFilter]
  );

  const logChipDefs: { key: LogFilterKey; label: string }[] = [
    { key: "all", label: dash.logFilters.all },
    { key: "alpha", label: dash.logFilters.agent01 },
    { key: "beta", label: dash.logFilters.agent02 },
    { key: "sys", label: dash.logFilters.system },
    { key: "net", label: dash.logFilters.network },
    { key: "debug", label: dash.logFilters.debug },
  ];

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--bg-base)" }}>

      {/* ── TOP NAV ─────────────────────────────────────────────────────── */}
      <header className="kl-topbar kl-topbar--dashboard">
        <span
          className="kl-logo"
          onClick={() => router.push("/")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push("/"); } }}
          role="link"
          tabIndex={0}
          style={{ display: "flex", alignItems: "center" }}
        >
          <img src="/logo.svg" alt="Cogladius" style={{ width: 32, height: 32, objectFit: "contain" }} />
        </span>
        <div className="kl-topbar__stats" aria-label={dash.a11yStatsRegion}>
          <span style={{ color: "var(--accent)", fontWeight: 800 }}>✦ XLM</span>
          <span>{dash.topbar.gas("0.00001")}</span>
          {usdcBalance !== null && (
            <span>
              {dash.topbar.bal}
              {": "}
              <span className="kl-stat-mono" style={{ color: usdcBalance > 1 ? "var(--green)" : "var(--yellow)" }}>{usdcBalance.toFixed(2)} XLM</span>
            </span>
          )}
          <span className="kl-stat-pipe" aria-hidden>|</span>
          <span>
            {dash.topbar.tasks}
            {": "}
            <span className="kl-stat-mono" style={{ color: "var(--text-primary)" }}>{tasks.length}</span>
          </span>
          <span>
            {dash.topbar.agents}
            {": "}
            <span className="kl-stat-mono" style={{ color: "var(--green)" }}>
              {agents.filter((a) => a.status.startsWith("WORKING")).length}/{agents.length}
            </span>
          </span>
          <span>
            {dash.topbar.x402}
            {": "}
            <span className="kl-stat-mono" style={{ color: "var(--accent)" }}>{totalX402.toFixed(4)} XLM</span>
          </span>
        </div>
        <div className="kl-topbar__actions">
          <button
            type="button"
            onClick={() => router.push("/projects")}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--accent-dim)", border: "1px solid var(--accent-border)", borderRadius: 4, cursor: "pointer", fontFamily: "var(--font)", fontSize: 9, color: "var(--accent)", letterSpacing: "0.08em", padding: "5px 11px", transition: "all 0.15s", fontWeight: 700 }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,86,37,0.14)"; e.currentTarget.style.borderColor = "var(--accent)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--accent-dim)"; e.currentTarget.style.borderColor = "var(--accent-border)"; }}>
            <span className="material-symbols-outlined" style={{ fontSize: 12 }}>hub</span>
            NEXUS
          </button>
          {connected && publicKey && (
            <button
              type="button"
              className="kl-wallet-pill"
              onClick={() => router.push(`/agent/${publicKey.toString()}`)}
            >
              {shortenAddress(publicKey.toString())}
            </button>
          )}
          <LanguageSwitcher />
          <ThemeToggle />
          <ConnectWallet />
        </div>
      </header>

      {/* ── BODY: sidebar + content ─────────────────────────────────────── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ── LEFT SIDEBAR (collapsible) ───────────────────────────── */}
        <aside style={{ width: sidebarCollapsed ? 48 : 200, flexShrink: 0, background: "var(--bg-base)", borderRight: "1px solid var(--bg-border)", display: "flex", flexDirection: "column", height: "calc(100vh - 52px)", position: "sticky", top: 52, transition: "width 0.2s", zIndex: 40, overflow: "hidden" }}>
          {/* Collapse toggle */}
          <div style={{ height: 36, display: "flex", alignItems: "center", justifyContent: sidebarCollapsed ? "center" : "flex-end", padding: sidebarCollapsed ? 0 : "0 6px", borderBottom: "1px solid var(--bg-border)", flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setSidebarCollapsed((p) => !p)}
              style={{ width: 26, height: 26, background: "transparent", border: "none", cursor: "pointer", color: "rgba(var(--text-rgb),0.3)", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 2, transition: "color 0.12s" }}
              title={sidebarCollapsed ? dash.sidebarExpand : dash.sidebarCollapse}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(var(--text-rgb),0.3)")}
              aria-label={sidebarCollapsed ? dash.sidebarExpand : dash.sidebarCollapse}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 15 }}>{sidebarCollapsed ? "chevron_right" : "chevron_left"}</span>
            </button>
          </div>

          {/* Wallet card */}
          {!sidebarCollapsed ? (
            <div className="kl-sidebar-profile">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <img src="/logo.svg" alt="" style={{ width: 32, height: 32, objectFit: "contain", flexShrink: 0 }} />
                <div style={{ overflow: "hidden" }}>
                  <div style={{ fontFamily: "var(--font)", fontSize: 11, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "0.04em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {publicKey ? shortenAddress(publicKey.toString(), 5) : "—"}
                  </div>
                  <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--green)", letterSpacing: "0.08em", marginTop: 2, display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 8px rgba(64,225,131,0.5)" }} />
                    {sf.connected.toUpperCase()}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ padding: "10px 0", display: "flex", justifyContent: "center", borderBottom: "1px solid var(--bg-border)" }}>
              <img src="/logo.svg" alt="" style={{ width: 28, height: 28, objectFit: "contain" }} />
            </div>
          )}

          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <nav style={{ flexShrink: 0, paddingTop: 4 }}>
            {[
              { key: "agents", icon: "smart_toy",              label: dash.nav.agents,  tooltip: dash.nav.tipAgents },
              { key: "tasks",  icon: "assignment",             label: dash.nav.tasks,  tooltip: ui.sidebar.taskTooltip },
              { key: "logs",   icon: "terminal",               label: dash.nav.logs,   tooltip: dash.nav.tipLogs },
              { key: "txfeed", icon: "account_balance_wallet", label: dash.nav.txfeed, tooltip: dash.nav.tipTx },
            ].map((item) => {
              const isActive = sidebarTab === item.key;
              const isPanelOn = (item.key === "tasks" && missionsOpen)
                             || (item.key === "logs"   && logsOpen)
                             || (item.key === "txfeed" && txFeedOpen);
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`kl-nav-item ${isActive ? "active" : ""}`}
                  title={item.tooltip}
                  style={{ justifyContent: sidebarCollapsed ? "center" : undefined }}
                  onClick={() => {
                    setSidebarTab(item.key as any);
                    if (item.key === "tasks")  setMissionsOpen((p) => !p || !isActive);
                    if (item.key === "logs")   setLogsOpen((p)    => !p || !isActive);
                    if (item.key === "txfeed") setTxFeedOpen((p)  => !p || !isActive);
                  }}>
                  <span className="material-symbols-outlined">{item.icon}</span>
                  {!sidebarCollapsed && item.label}
                  {!sidebarCollapsed && isPanelOn && (
                    <span style={{ marginLeft: "auto", width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", display: "inline-block", flexShrink: 0 }} />
                  )}
                </button>
              );
            })}
            </nav>

            {sidebarTab === "agents" && (
            <div style={{ padding: "0 0 4px", flex: 1, overflowY: "auto", minHeight: 0, WebkitOverflowScrolling: "touch" }}>
              <div className="kl-sidebar-section-title">{sf.sectionAgents}</div>
              {agents.map((agent) => {
                const isWorking = agent.status.startsWith("WORKING");
                const avg = agent.tasksCompleted > 0 ? Math.round(agent.totalScore / agent.tasksCompleted) : 0;
                return (
                  <div
                    key={agent.name}
                    className="kl-agent-card"
                    onClick={() => router.push(`/agent/${agent.pubkey}`)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push(`/agent/${agent.pubkey}`); } }}
                    role="button"
                    tabIndex={0}
                    style={{
                      borderLeft: `3px solid ${agent.color}`,
                      boxShadow: `inset 0 0 0 1px ${agent.color}18`,
                    }}
                  >
                    <div className="kl-agent-card-head">
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <div
                          className={isWorking ? "pulse-dot pulse-dot-amber" : "pulse-dot"}
                          style={{ width: 7, height: 7, flexShrink: 0, background: isWorking ? agent.color : "rgba(var(--white-rgb),0.15)" }}
                        />
                        <span className="kl-agent-name" style={{ color: agent.color }}>{agent.name.toLowerCase()}</span>
                      </div>
                    </div>
                    <div className="kl-agent-pub" onClick={(e) => e.stopPropagation()}>
                      <a href={explorerAddress(agent.pubkey)} target="_blank" rel="noopener noreferrer">
                        {shortenAddress(agent.pubkey, 4)} ↗
                      </a>
                    </div>
                    <div className="kl-agent-stats">
                      <span>{sf.taskCount(agent.tasksCompleted)}</span>
                      {avg > 0 && <span style={{ color: avg >= 70 ? "var(--green)" : "var(--yellow)", fontWeight: 600 }}>ø{avg}</span>}
                      <span className="kl-agent-stat-usdc">{agent.x402Spending.toFixed(3)} XLM</span>
                    </div>
                    {avg > 0 && (
                      <div className="score-bar-track" title={`~${avg}/100`}>
                        <div className="score-bar-fill" style={{ width: `${Math.min(100, avg)}%`, background: avg >= 70 ? "var(--green)" : "var(--yellow)" }} />
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="kl-sidebar-section-title">{sf.sectionJury}</div>
              {JUDGE_NAMES.map((name) => {
                const isEval = judges[name] === "EVALUATING";
                return (
                  <div key={name} className="kl-judge-row">
                    <span className="material-symbols-outlined" style={{ fontSize: 15, color: isEval ? "var(--blue)" : "var(--text-muted)", flexShrink: 0 }}>{JUDGE_ICONS[name]}</span>
                    <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "rgba(var(--text-rgb),0.6)", flex: 1, fontWeight: 500 }}>{JUDGE_LABELS[name]}</span>
                    <span className={`kl-judge-pill ${isEval ? "kl-judge-pill-busy" : "kl-judge-pill-ready"}`}>
                      {isEval ? sf.evaluating : sf.ready}
                    </span>
                  </div>
                );
              })}

              <div className="kl-sidebar-section-title">{sf.x402Section}</div>
              <div className="kl-x402-table">
                {agents.map((a) => (
                  <div key={a.name} className="kl-x402-row">
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "rgba(var(--text-rgb),0.5)", textTransform: "lowercase" }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: a.color, flexShrink: 0, boxShadow: `0 0 6px ${a.color}99` }} aria-hidden />
                      {a.name.replace(/^agent-/i, "")}
                    </span>
                    <span style={{ color: "var(--accent)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{a.x402Spending.toFixed(4)} XLM</span>
                  </div>
                ))}
              </div>
              <div className="kl-x402-total">
                <span style={{ color: "rgba(var(--text-rgb),0.4)", textTransform: "uppercase", letterSpacing: "0.1em", fontSize: 8 }}>{sf.total}</span>
                <span>{totalX402.toFixed(4)} XLM</span>
              </div>
            </div>
            )}
          </div>

          {/* Bottom actions */}
          <div style={{ marginTop: "auto", flexShrink: 0 }}>
            <div className="kl-sidebar-footer-row">
              <a href="https://openclaw.ai" target="_blank" rel="noopener noreferrer"
                style={{ fontFamily: "var(--font)", fontSize: 9, color: "rgba(var(--text-rgb),0.3)", textDecoration: "none", letterSpacing: "0.06em", display: "inline-flex", alignItems: "center", gap: 4 }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(var(--text-rgb),0.3)")}>
                <span className="material-symbols-outlined" style={{ fontSize: 12 }}>open_in_new</span>
                openclaw.ai
              </a>
              <button
                type="button"
                onClick={() => router.push("/agents")}
                style={{ fontFamily: "var(--font)", fontSize: 9, color: "rgba(var(--text-rgb),0.3)", background: "transparent", border: "none", cursor: "pointer", letterSpacing: "0.06em", display: "inline-flex", alignItems: "center", gap: 4, marginLeft: "auto" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(var(--text-rgb),0.3)")}>
                <span className="material-symbols-outlined" style={{ fontSize: 12 }}>group</span>
                {sf.registry.toUpperCase()}
              </button>
            </div>
            <button
              type="button"
              className="kl-deploy-btn"
              onClick={() => setShowPostModal(true)}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>add_task</span>
              {sf.postTask.toUpperCase()}
            </button>
          </div>
        </aside>

        {/* ── COL 2: ACTIVE_MISSIONS (collapsible + resizable) ─────────── */}
        {missionsOpen && (
          <section className="kl-missions-panel" style={{ width: missionsWidth, flexShrink: 0, borderRight: "1px solid var(--bg-border)", display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-surface)", position: "relative" }}>
            <header className="kl-panel-header">
              <div className="kl-panel-header__icon" aria-hidden>
                <span className="material-symbols-outlined">assignment</span>
              </div>
              <span className="kl-panel-header__title">{pl.missions}</span>
              <span className="kl-panel-header__badge" title={`${tasks.length}`}>{tasks.length}</span>
              <button
                type="button"
                className="kl-btn-inline"
                style={{ background: "var(--accent)", color: "var(--bg-base)" }}
                onClick={() => setShowPostModal(true)}
                title={pl.publish}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 10 }}>add</span>
                {pl.publish}
              </button>
              <button
                type="button"
                className="kl-icon-btn-ghost"
                title={pl.close}
                aria-label={pl.close}
                onClick={() => setMissionsOpen(false)}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 15 }}>close</span>
              </button>
            </header>

            {/* Task list */}
            <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
              {tasks.length === 0 ? (
                <div style={{ padding: "40px 12px", textAlign: "center" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 28, color: "rgba(var(--text-rgb),0.1)", display: "block", marginBottom: 8 }}>assignment</span>
                  <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "rgba(var(--text-rgb),0.2)", letterSpacing: "0.06em" }}>{pl.emptyMissions}</div>
                  <button type="button" className="btn-primary" style={{ marginTop: 12, fontSize: 9, padding: "5px 12px" }} onClick={() => setShowPostModal(true)}>{ui.sidebar.firstPost}</button>
                </div>
              ) : tasks.map((task) => {
                const isStellarTask = true;
                const taskCurr = "XLM";
                const rew = (task.rewardUsdc ?? task.reward / 1e7).toFixed(4);
                const isSelected = selectedTask?.id === task.id;
                const isUrgent = task.status === "Disputed";
                const badgeKey = task.status === "Open" ? "open" : task.status === "UnderReview" ? "review" : task.status === "AwaitingDecision" ? "awaiting" : task.status === "Settled" ? "settled" : task.status === "Disputed" ? "disputed" : "stopped";
                const statusColor: Record<string, string> = { Open: "var(--green)", UnderReview: "#FFD166", AwaitingDecision: "var(--blue)", Settled: "var(--green)", Disputed: "var(--red)", Resolved: "var(--blue)", Stopped: "rgba(var(--text-rgb),0.15)" };
                const taskTypeIcon: Record<string, string> = { question: "help_outline", research: "lab_research", code: "code", data: "analytics", web: "public", custom: "tune" };
                const borderColor = statusColor[task.status] ?? "rgba(var(--white-rgb),0.08)";
                return (
                  <div key={task.id} style={{ position: "relative" }}>
                    <div
                      className={getTaskCardClass(task.status)}
                      onClick={() => { setSelectedTask(task); setCenterTab("detail"); }}
                      style={{ padding: "10px 10px 10px 12px", marginBottom: 6, background: isSelected ? "var(--bg-surface-high)" : "var(--bg-surface-low)", cursor: "pointer", transition: "background 0.12s, box-shadow 0.12s", borderRadius: "0 6px 6px 0", borderLeft: `2px solid ${borderColor}`, boxShadow: isSelected ? `inset 0 0 0 1px ${borderColor}22` : "none" }}
                      onMouseEnter={(e) => { if (!isSelected) { e.currentTarget.style.background = "var(--bg-surface-high)"; e.currentTarget.style.boxShadow = `inset 0 0 0 1px ${borderColor}15`; } }}
                      onMouseLeave={(e) => { if (!isSelected) { e.currentTarget.style.background = "var(--bg-surface-low)"; e.currentTarget.style.boxShadow = "none"; } }}>
                      {/* Row 1: badge + task type + id + actions */}
                      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 7 }}>
                        <span className={isUrgent ? "badge badge-urgent" : `badge badge-${badgeKey}`}>
                          {isUrgent ? (ui.status as Record<string, string>).Urgent : (ui.status as Record<string, string>)[task.status] || task.status}
                        </span>
                        {task.taskType && (
                          <span title={task.taskType} style={{ display: "inline-flex", alignItems: "center", background: "var(--bg-base)", border: "1px solid var(--bg-border)", borderRadius: 3, padding: "1px 5px" }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 10, color: "rgba(var(--text-rgb),0.4)" }}>{taskTypeIcon[task.taskType] ?? "tune"}</span>
                          </span>
                        )}
                        <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "rgba(var(--text-rgb),0.22)", marginLeft: "auto" }}>#{task.id}</span>
                        {/* Delete button */}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setDeleteConfirm(deleteConfirm === task.id ? null : task.id); }}
                          style={{ width: 20, height: 20, background: "transparent", border: "none", cursor: "pointer", color: "rgba(var(--text-rgb),0.15)", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 2, transition: "color 0.12s" }}
                          title={ui.sidebar.removeTitle}
                          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--red)")}
                          onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(var(--text-rgb),0.15)")}>
                          <span className="material-symbols-outlined" style={{ fontSize: 13 }}>delete</span>
                        </button>
                      </div>
                      {/* Description */}
                      <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: isSelected ? "var(--text-primary)" : "var(--text-secondary)", fontWeight: 500, marginBottom: 9, lineHeight: 1.55, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>
                        {task.description.substring(0, 80)}{task.description.length > 80 ? "…" : ""}
                      </div>
                      {/* Row 3 */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontFamily: "var(--font)", fontSize: 11, color: "var(--accent)", display: "flex", alignItems: "center", gap: 3, fontWeight: 800 }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 11 }}>{isStellarTask ? "star" : "currency_bitcoin"}</span>
                          {rew} {taskCurr}
                        </span>
                        <Countdown deadline={task.deadline} />
                      </div>
                    </div>
                    {/* Delete confirm inline */}
                    {deleteConfirm === task.id && (
                      <div style={{ background: "var(--bg-surface-high)", border: "1px solid rgba(255,77,77,0.3)", borderRadius: 4, padding: "8px 10px", marginBottom: 6, marginTop: -4 }}
                        onClick={(e) => e.stopPropagation()}>
                        <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "rgba(var(--text-rgb),0.6)", marginBottom: 7 }}>{ui.sidebar.removeConfirm}</div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            type="button"
                            onClick={() => deleteTask(task.id)}
                            style={{ flex: 1, background: "rgba(255,77,77,0.15)", border: "1px solid rgba(255,77,77,0.4)", color: "var(--red)", fontFamily: "var(--font)", fontSize: 8, padding: "4px", cursor: "pointer", borderRadius: 2, letterSpacing: "0.06em", fontWeight: 700 }}
                          >
                            {dash.remove}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteConfirm(null)}
                            style={{ flex: 1, background: "transparent", border: "1px solid var(--bg-border)", color: "rgba(var(--text-rgb),0.4)", fontFamily: "var(--font)", fontSize: 8, padding: "4px", cursor: "pointer", borderRadius: 2, letterSpacing: "0.06em" }}
                          >
                            {dash.cancel}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Resize handle (sağ kenar) */}
            <button
              type="button"
              className="kl-resize-handle"
              style={{ right: 0, left: "auto" }}
              onMouseDown={startMissionsDrag}
              title={dash.resizeHandle}
              aria-label={dash.resizeHandle}
            />
          </section>
        )}

        {/* missions kapalıysa küçük açma şeridi */}
        {!missionsOpen && (
          <div
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setMissionsOpen(true); setSidebarTab("tasks"); } }}
            className="kl-panel-strip"
            onClick={() => { setMissionsOpen(true); setSidebarTab("tasks"); }}
            title={ui.sidebar.taskListHint}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 12, color: "var(--accent)" }}>assignment</span>
            <span className="kl-panel-strip__label">{pl.stripMissions}</span>
            <span className="material-symbols-outlined" style={{ fontSize: 10, color: "rgba(var(--text-rgb),0.25)" }}>chevron_right</span>
          </div>
        )}

        {/* ── COL 3: CENTER PANEL (flex 1) ────────────────────────────── */}
        <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-base)", position: "relative" }}>
          {/* LOGS overlay panel */}
          {logsOpen && (
            <div style={{ position: "absolute", inset: 0, zIndex: 30, background: "rgba(var(--base-rgb),0.95)", display: "flex", flexDirection: "column" }}>
              <header className="kl-panel-header">
                <div className="kl-panel-header__icon" aria-hidden>
                  <span className="material-symbols-outlined">terminal</span>
                </div>
                <span className="kl-panel-header__title">{pl.logs}</span>
                <span className="kl-panel-header__meta">{pl.logsKicker}</span>
                <button
                  type="button"
                  className="kl-icon-btn-ghost"
                  title={pl.close}
                  aria-label={pl.close}
                  onClick={() => setLogsOpen(false)}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 15 }}>close</span>
                </button>
              </header>
              <div className="kl-chips-row" role="toolbar" aria-label={pl.logs}>
                {logChipDefs.map((c) => (
                  <button
                    type="button"
                    key={c.key}
                    className={`kl-chip${logFilter === c.key ? " is-active" : ""}`}
                    onClick={() => setLogFilter(c.key)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
                {feed.length === 0 ? (
                  <div style={{ padding: "40px", textAlign: "center", fontFamily: "var(--font)", fontSize: 10, color: "rgba(var(--text-rgb),0.2)" }}>{dash.logsWaiting}</div>
                ) : filteredLogFeed.length === 0 ? (
                  <div style={{ padding: "32px 14px", textAlign: "center", fontFamily: "var(--font)", fontSize: 10, color: "rgba(var(--text-rgb),0.22)" }}>{dash.logFilterEmpty}</div>
                ) : filteredLogFeed.map((entry, i) => {
                  const baseTag: Record<string, { label: string; color: string }> = {
                    alpha: { label: "AGENT_01", color: agents[0]?.color ?? "#40e183" },
                    beta:  { label: "AGENT_02", color: agents[1]?.color ?? "#adc6ff" },
                    tx:    { label: "SYSTEM",   color: "var(--accent)" },
                    net:   { label: "NETWORK",  color: "var(--yellow)" },
                    debug: { label: "DEBUG",    color: "rgba(var(--text-rgb),0.35)" },
                    sys:   { label: "SYSTEM",   color: "rgba(var(--text-rgb),0.5)" },
                    judge: { label: "JURY",     color: "var(--blue)" },
                  };
                  const tag = baseTag[entry.icon] || { label: "SYS", color: "rgba(var(--text-rgb),0.3)" };
                  const tagChipStyle: CSSProperties = tag.color.startsWith("#")
                    ? { color: tag.color, background: `${tag.color}2a`, border: `1px solid ${tag.color}55` }
                    : { color: tag.color, background: "var(--bg-surface-high)", border: "1px solid var(--bg-border-bright)" };
                  return (
                    <div key={entry.id || i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "5px 14px", borderBottom: "1px solid rgba(var(--white-rgb),0.02)" }}>
                      <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "rgba(var(--text-rgb),0.2)", flexShrink: 0, marginTop: 1, minWidth: 56 }}>[{entry.timeStr}]</span>
                      <span
                        style={{
                          fontFamily: "var(--font)",
                          fontSize: 8,
                          fontWeight: 700,
                          padding: "1px 6px",
                          borderRadius: 2,
                          flexShrink: 0,
                          letterSpacing: "0.05em",
                          marginTop: 1,
                          ...tagChipStyle,
                        }}
                      >
                        {tag.label}
                      </span>
                      <span style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "rgba(var(--text-rgb),0.65)", lineHeight: 1.5 }}>{entry.message}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {!selectedTask ? (
            /* HUD + Live Feed */
            <div className="kl-center-feed">
              <HudMap agents={agents} tasks={tasks} totalX402={totalX402} />
              <div className="kl-feed-column-hdr">
                <div className="kl-feed-column-hdr__icon" aria-hidden>
                  <span className="material-symbols-outlined">grid_view</span>
                </div>
                <div>
                  <div className="kl-feed-column-hdr__kicker">{dash.liveFeedKicker}</div>
                  <div className="kl-feed-column-hdr__title">{dash.liveFeedTitle}</div>
                </div>
              </div>
              <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
                <LiveTerminal entries={feed} agents={agents} />
              </div>
              <div className="kl-terminal-bar">
                <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                  <span style={{ position: "absolute", left: 12, color: "var(--accent)", fontWeight: 700, fontSize: 14, pointerEvents: "none" }}>❯</span>
                  <input
                    type="text"
                    className="kl-terminal-input"
                    value={termInput}
                    onChange={(e) => setTermInput(e.target.value)}
                    placeholder={dash.terminalPlaceholder}
                    onKeyDown={(e) => { if (e.key === "Enter") setTermInput(""); }}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label={dash.terminalPlaceholder}
                  />
                </div>
              </div>
            </div>
          ) : (
            /* Task Detail Panel */
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {/* Task header */}
              <div className="kl-panel-task">
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "rgba(var(--text-rgb),0.3)" }}>#{selectedTask.id}</span>
                  <span className={getTaskBadgeClass(selectedTask.status)}>{(ui.status as Record<string, string>)[selectedTask.status]}</span>
                  <span style={{ fontFamily: "var(--font)", fontSize: 14, color: "var(--accent)", fontWeight: 800, marginLeft: "auto" }}>
                    {(selectedTask.rewardUsdc ?? selectedTask.reward / 1e7).toFixed(4)}
                    <span style={{ fontSize: 9, fontWeight: 400, color: "var(--text-muted)", marginLeft: 3 }}>{"XLM"}</span>
                  </span>
                  <button
                    type="button"
                    className="kl-icon-btn-ghost"
                    title={pl.close}
                    aria-label={pl.close}
                    onClick={() => { setSelectedTask(null); setCenterTab("detail"); }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 15 }}>close</span>
                  </button>
                </div>
                <p style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--text-primary)", lineHeight: 1.6, marginBottom: 6 }}>{selectedTask.description}</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 2 }}>
                  <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "rgba(var(--text-rgb),0.3)", marginRight: 4, paddingTop: 2, textTransform: "uppercase", letterSpacing: "0.1em" }}>{dash.criteria}</span>
                  {selectedTask.criteria.split(",").map((c) => c.trim()).filter(Boolean).map((chip) => (
                    <span key={chip} style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--accent)", background: "var(--accent-dim)", border: "1px solid var(--accent-border)", padding: "1px 7px", borderRadius: 2, letterSpacing: "0.03em" }}>{chip}</span>
                  ))}
                </div>

                {/* Tab bar */}
                <div style={{ display: "flex", alignItems: "center", marginTop: 10, borderTop: "1px solid var(--bg-border)", paddingTop: 8, flexWrap: "wrap", gap: 4 }}>
                  {(["detail","agent","court"] as const).map((tab) => {
                    const lbl = tab === "detail" ? dash.taskTabs.detail : tab === "agent" ? dash.taskTabs.agent : dash.taskTabs.court;
                    const ico = tab === "detail" ? "info" : tab === "agent" ? "smart_toy" : "gavel";
                    return (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setCenterTab(tab)}
                        style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: "var(--font)", fontSize: 9, fontWeight: 700, background: "none", border: "none", cursor: "pointer", padding: "5px 12px", letterSpacing: "0.08em", textTransform: "uppercase", color: centerTab === tab ? "var(--accent)" : "rgba(var(--text-rgb),0.3)", borderBottom: centerTab === tab ? "2px solid var(--accent)" : "2px solid transparent", transition: "color 0.12s" }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 11 }}>{ico}</span>
                        {lbl}
                      </button>
                    );
                  })}
                  <div style={{ flex: 1 }} />
                  {selectedTask.status === "Open" && agentPanelTaskId !== selectedTask.id && (
                    <button type="button" onClick={() => handleAssignTask(selectedTask)} className="btn-green" style={{ fontSize: 9, padding: "4px 12px" }}>{ui.taskDetail.assign}</button>
                  )}
                  {selectedTask.status === "AwaitingDecision" && (
                    <button type="button" onClick={() => setCenterTab("agent")} className="btn-green" style={{ fontSize: 9, padding: "4px 12px" }}>{dash.decisionFlow}</button>
                  )}
                  {(selectedTask.status === "Disputed" || selectedTask.status === "Resolved") && (
                    <button type="button" onClick={() => setCenterTab("court")} className="btn-danger" style={{ fontSize: 9, padding: "4px 12px" }}>{ui.taskDetail.court}</button>
                  )}
                </div>
              </div>

              {/* Tab content */}
              <div style={{ flex: 1, overflow: "hidden" }}>
                <div style={{ display: centerTab === "detail" ? "flex" : "none", flexDirection: "column", height: "100%", overflowY: "auto", padding: 14, gap: 12 }}>
                  {(() => {
                    const ps = agentPanelStates[selectedTask.id]?.judgeScores ?? [];
                    const dv = ps.map((js, i) => ({ judgeId: i + 1, judgeName: js.name, agent: agents[0]?.pubkey || "", score: js.score, reasoning: js.comment }));
                    const verdicts = dv.length > 0 ? dv : (selectedTask.verdicts ?? []);
                    const isEval = selectedTask.status === "UnderReview" && verdicts.length < 3;
                    return <JudgePanel verdicts={verdicts} taskId={selectedTask.id} isEvaluating={isEval} />;
                  })()}
                  {selectedTask.submissions.length > 0 && (
                    <div style={{ background: "var(--bg-surface-low)", border: "1px solid var(--bg-border)", borderRadius: 6, overflow: "hidden" }}>
                      <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--bg-border)", fontFamily: "var(--font)", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                        {dash.submissions(selectedTask.submissions.length)}
                      </div>
                      {selectedTask.submissions.map((sub, i) => (
                        <div key={i} style={{ padding: "8px 12px", borderBottom: "1px solid var(--bg-border)", fontFamily: "var(--font)", fontSize: 10 }}>
                          <div style={{ display: "flex", gap: 10, color: "var(--accent)", marginBottom: 3 }}>
                            <span>{shortenAddress(sub.agent)}</span>
                            <span style={{ color: "rgba(var(--text-rgb),0.3)" }}>{dash.seconds(sub.timeTakenSeconds)}</span>
                          </div>
                          <div style={{ color: "rgba(var(--text-rgb),0.25)" }}>{dash.hashLabel}: {sub.resultHash.substring(0, 20)}…</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedTask.submissions.length === 0 && (
                    <div style={{ padding: "32px", textAlign: "center", fontFamily: "var(--font)", fontSize: 11, color: "rgba(var(--text-rgb),0.25)" }}>
                      {selectedTask.status === "Open" ? ui.taskDetail.noSubmissions : ui.taskDetail.taskStopped}
                    </div>
                  )}
                </div>

                <div style={{ display: centerTab === "agent" ? "flex" : "none", flexDirection: "column", height: "100%", overflow: "hidden" }}>
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
                      onSaveState={(s) => setAgentPanelStates((p) => ({ ...p, [selectedTask.id]: s }))}
                    />
                  ) : (
                    <div style={{ padding: 32, textAlign: "center", fontFamily: "var(--font)", fontSize: 11, color: "rgba(var(--text-rgb),0.25)" }}>
                      {ui.taskDetail.assignHint}
                    </div>
                  )}
                </div>

                <div style={{ display: centerTab === "court" ? "flex" : "none", flexDirection: "column", height: "100%", overflow: "hidden" }}>
                  <CourtRoom
                    key={`court-${selectedTask.id}`}
                    task={selectedTask}
                    onClose={() => setCenterTab("detail")}
                    prefillAgentResult={courtData?.agentResult ?? agentPanelStates[selectedTask.id]?.agentResult}
                    prefillDisputeReason={courtData?.disputeReason}
                    onVerdict={() => {
                      // Agent Court is an off-chain AI roleplay (on-chain resolution
                      // is a deferred deliverable) — record the ruling in the feed,
                      // never a fabricated on-chain transaction.
                      const now = new Date(); const taskId = selectedTask.id;
                      const tloc = locale === "tr" ? "tr-TR" : "en-US";
                      setTasks((p) => p.map((t) => t.id === taskId ? { ...t, status: "Resolved" } : t));
                      setSelectedTask((p) => p?.id === taskId ? { ...p, status: "Resolved" } : p);
                      setFeed((p) => [{ id: Date.now(), time: now.toISOString(), timeStr: now.toLocaleTimeString(tloc, { hour12: false }), message: ui.feedDyn.court(taskId), icon: "judge", agent: "judge" }, ...p]);
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </main>

        {/* TX_FEED kapalıysa küçük açma şeridi */}
        {!txFeedOpen && (
          <div
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setTxFeedOpen(true); setSidebarTab("txfeed"); } }}
            className="kl-panel-strip"
            style={{ borderLeft: "1px solid var(--bg-border)" }}
            onClick={() => { setTxFeedOpen(true); setSidebarTab("txfeed"); }}
            title={dash.openTxStrip}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 12, color: "var(--accent)" }}>account_balance_wallet</span>
            <span className="kl-panel-strip__label">{pl.stripTx}</span>
            <span className="material-symbols-outlined" style={{ fontSize: 10, color: "rgba(var(--text-rgb),0.25)" }}>chevron_left</span>
          </div>
        )}

        {/* ── COL 4: TX FEED (collapsible + resizable) ─────────────────── */}
        {txFeedOpen && (
          <aside className="kl-txfeed-panel" style={{ width: txFeedWidth, flexShrink: 0, borderLeft: "1px solid var(--bg-border)", display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-surface)", position: "relative" }}>
            {/* Resize handle (sol kenar) */}
            <button
              type="button"
              className="kl-resize-handle"
              style={{ left: 0, right: "auto" }}
              onMouseDown={startTxFeedDrag}
              title={dash.resizeHandle}
              aria-label={dash.resizeHandle}
            />
            <TxColumn txLog={txLog} onClose={() => setTxFeedOpen(false)} />
          </aside>
        )}
      </div>

      {/* ── STATUS BAR ─────────────────────────────────────────────────── */}
      <div className="kl-statusbar" role="contentinfo">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, rowGap: 4 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--green)", display: "inline-block" }} />
            {dash.statusBar.latency("42ms")}
          </span>
          <span>{dash.statusBar.nodes("1,422")}</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, rowGap: 4, justifyContent: "flex-end" }}>
          <span>{dash.statusBar.version("0.8.4-ALPHA")}</span>
          <span style={{ color: "var(--accent)" }}>{dash.statusBar.systemLoad("12.4%")}</span>
          <span>{dash.statusBar.build("CGL_3321")}</span>
        </div>
      </div>

      {showPostModal && <PostTaskModal onClose={() => setShowPostModal(false)} onTaskPosted={handleTaskPosted} />}
    </div>
  );
}
