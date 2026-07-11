"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import ConnectWallet from "@/components/ConnectWallet";
import { useWallet } from "@/lib/useWallet";
import { getMockTasks } from "@/lib/sampleTasks";
import { Task } from "@/lib/types";
import { shortenAddress } from "@/lib/constants";
import JudgePanel from "@/components/JudgePanel";
import DisputePanel from "@/components/DisputePanel";
import { ThemeToggle } from "@/components/ThemeProvider";
import { useMessages } from "@/lib/i18n";
import {
  EXPLORER_TX as STELLAR_TX,
  EXPLORER_ACCOUNT as STELLAR_ACCOUNT,
  shortAddress,
} from "@/lib/stellar";

const LIFECYCLE_KEYS = ["open", "review", "decision", "final", "settled"] as const;

function stepIndex(status: string): number {
  if (status === "Open")             return 0;
  if (status === "UnderReview")      return 1;
  if (status === "AwaitingDecision") return 2;
  if (status === "Settled")          return 4;
  if (status === "Disputed")         return 3;
  if (status === "Resolved")         return 4;
  return 0;
}

function Countdown({ deadline }: { deadline: number }) {
  const ended = useMessages().ui.time.ended;
  const [rem, setRem] = useState("");
  useEffect(() => {
    const tick = () => {
      const d = deadline - Math.floor(Date.now() / 1000);
      if (d <= 0) { setRem(ended); return; }
      const h = Math.floor(d / 3600); const m = Math.floor((d % 3600) / 60); const s = d % 60;
      setRem(h > 0 ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${m}:${String(s).padStart(2,"0")}`);
    };
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id);
  }, [deadline, ended]);
  return <span style={{ color: "rgba(var(--text-rgb),0.4)" }}>{rem}</span>;
}

/* ── Info chip ───────────────────────────────────────────────────────────── */
function InfoChip({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ background: "var(--bg-surface-high)", border: "1px solid var(--bg-border)", padding: "10px 14px", borderRadius: 4, minWidth: 100 }}>
      <div style={{ fontFamily: "var(--font)", fontSize: 8, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 5 }}>{label}</div>
      <div style={{ fontFamily: "var(--font)", fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>{value}</div>
    </div>
  );
}

/* ── Timeline ────────────────────────────────────────────────────────────── */
function Timeline({ status }: { status: string }) {
  const ta = useMessages().ui.taskArenaPage;
  const lifecycleSteps = LIFECYCLE_KEYS.map((key, i) => ({
    key,
    label: ta.lifecycle[i] ?? "",
  }));
  const currentIdx = stepIndex(status);
  const isDisputed = status === "Disputed";
  return (
    <div style={{ background: "var(--bg-surface-low)", border: "1px solid var(--bg-border)", borderRadius: 8, padding: "20px 24px" }}>
      <div style={{ fontFamily: "var(--font)", fontSize: 9, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 18 }}>
        {ta.timelineTitle}
      </div>
      <div style={{ position: "relative" }}>
        {/* Connecting line */}
        <div style={{ position: "absolute", top: 14, left: 14, right: 14, height: 2, background: "var(--bg-surface-top)", zIndex: 0 }} />
        <div style={{ position: "absolute", top: 14, left: 14, height: 2, zIndex: 1,
          width: `${(currentIdx / (lifecycleSteps.length - 1)) * (100 - 10)}%`,
          background: isDisputed ? "var(--accent)" : "var(--accent)", transition: "width 0.5s ease" }} />
        {/* Steps */}
        <div style={{ display: "flex", justifyContent: "space-between", position: "relative", zIndex: 2 }}>
          {lifecycleSteps.map((step, i) => {
            const isDone   = i < currentIdx;
            const isActive = i === currentIdx;
            const dotClass = isDone ? "timeline-dot timeline-dot-done" : isActive ? "timeline-dot timeline-dot-active" : "timeline-dot timeline-dot-pending";
            return (
              <div key={step.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                <div className={dotClass}>
                  {isDone ? (
                    <span className="material-symbols-outlined" style={{ fontSize: 12, fill: "1" }}>check</span>
                  ) : (
                    <span style={{ fontFamily: "var(--font)", fontSize: 10, fontWeight: 700 }}>{i + 1}</span>
                  )}
                </div>
                <span style={{ fontFamily: "var(--font)", fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", color: isActive ? "var(--accent)" : isDone ? "rgba(var(--text-rgb),0.5)" : "rgba(var(--text-rgb),0.2)", fontWeight: isActive ? 700 : 400 }}>
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Finalist Agents table ───────────────────────────────────────────────── */
function FinalistTable({ task }: { task: Task }) {
  const router = useRouter();
  const ta = useMessages().ui.taskArenaPage;
  const finalists = task.submissions.length > 0 ? task.submissions.map((s, i) => ({
    name: s.agent.length > 12 ? `Agent_${s.agent.slice(-4)}` : s.agent,
    pubkey: s.agent,
    latency: `${s.timeTakenSeconds * 1000 / 10 + 142}ms`,
    hashrate: s.resultHash.substring(0, 10) + "...",
    status: i === 0 ? ta.statusLeader : ta.statusCandidate,
    isLeader: i === 0,
  })) : [
    { name: "NeonRacer_v4",  pubkey: "7DQy8XZKCbsJuXP3m52Au8PeKLpaa64WKATFWbCYkuxo", latency: "142ms", hashrate: "0x882...a3f", status: ta.statusLeader, isLeader: true },
    { name: "SolStreamer_X",  pubkey: "8TKy9R4MnVtTBrFHzAGiKChbXr7jPj3k3NKedxNtLLpL", latency: "168ms", hashrate: "0x441...bc1", status: ta.statusCandidate,  isLeader: false },
    { name: "GhostIndexer",  pubkey: "9UJy0SBKxMsZ7VmWPuQnMEdj8CmrQkv4oKJfFCpVBbPP", latency: "215ms", hashrate: "0x992...22e", status: ta.statusCandidate,  isLeader: false },
  ];
  return (
    <div style={{ background: "var(--bg-surface-low)", border: "1px solid var(--bg-border)", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--bg-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontFamily: "var(--font)", fontSize: 11, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{ta.finalistTitle}</span>
        <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--accent)", letterSpacing: "0.06em" }}>{ta.liveComparison}</span>
      </div>
      {/* Header */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 100px 80px", padding: "8px 18px", borderBottom: "1px solid var(--bg-border)", fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        <span>{ta.colSignature}</span><span>{ta.colLatency}</span><span>{ta.colHashrate}</span><span>{ta.colStatus}</span>
      </div>
      {finalists.map((f) => (
        <div key={f.name}
          onClick={() => router.push(`/agent/${f.pubkey}`)}
          style={{ display: "grid", gridTemplateColumns: "1fr 80px 100px 80px", padding: "12px 18px", borderBottom: "1px solid var(--bg-border)", cursor: "pointer", transition: "background 0.1s" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-surface-high)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
          <span style={{ fontFamily: "var(--font)", fontSize: 11, fontWeight: 700, color: f.isLeader ? "var(--green)" : "var(--text-primary)" }}>{f.name}</span>
          <span style={{ fontFamily: "var(--font)", fontSize: 11, color: f.latency === "142ms" ? "var(--green)" : "var(--yellow)" }}>{f.latency}</span>
          <span style={{ fontFamily: "var(--font)", fontSize: 10, color: "rgba(var(--text-rgb),0.4)" }}>{f.hashrate}</span>
          <span>
            <span style={{ background: f.isLeader ? "rgba(64,225,131,0.15)" : "var(--bg-surface-high)", color: f.isLeader ? "var(--green)" : "rgba(var(--text-rgb),0.4)", fontFamily: "var(--font)", fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 2, border: f.isLeader ? "1px solid rgba(64,225,131,0.3)" : "none" }}>
              {f.status}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PAGE
═══════════════════════════════════════════════════════════════════════════ */
export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { publicKey } = useWallet();
  const ui = useMessages().ui;
  const ta = ui.taskArenaPage;
  const statusLabels = ui.status as Record<string, string>;
  const [task, setTask] = useState<Task | null>(null);
  const [showDisputePanel, setShowDisputePanel] = useState(false);
  const [copied, setCopied]  = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"agents" | "tasks" | "logs" | "txfeed">("agents");
  const [settling, setSettling] = useState(false);
  const [settleErr, setSettleErr] = useState<string | null>(null);

  async function settleStellar() {
    if (!task) return;
    setSettling(true);
    setSettleErr(null);
    try {
      const res = await fetch("/api/stellar/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id, winnerPubkey: task.winner }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Settlement failed");
      setTask((p) => p ? { ...p, status: "Settled", settleTxHash: data.hash, winnerStellarAddress: data.winnerAddress, winner: p.winner || data.winnerAddress } : p);
    } catch (e: any) {
      setSettleErr(e?.message || "Settlement failed");
    } finally {
      setSettling(false);
    }
  }

  useEffect(() => {
    const taskId = Number(params?.id);
    const tasks = getMockTasks();
    const found = tasks.find((t) => t.id === taskId);
    setTask(found || tasks[0] || null);
  }, [params?.id]);

  useEffect(() => {
    if (!task) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/tasks");
        if (!res.ok) return;
        const d = await res.json();
        const updated = d.tasks?.find((t: Task) => t.id === task.id);
        if (updated) setTask(updated);
      } catch (_) {}
    }, 3000);
    return () => clearInterval(id);
  }, [task?.id]);

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); });
  }

  if (!task) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-base)", fontFamily: "var(--font)", color: "rgba(var(--text-rgb),0.3)" }}>
        {ta.loading}
      </div>
    );
  }

  const isStellarTask = true;
  const curr = "XLM";
  const rewardNum = task.rewardUsdc ?? task.reward / 1e7;
  const reward = rewardNum.toFixed(4);
  const stakeSol = (rewardNum * 0.2).toFixed(2);
  const participants = Math.max(task.submissions.length, 8);
  const isDisputed = task.status === "Disputed" || task.status === "Resolved";
  const currentStep = stepIndex(task.status);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--bg-base)" }}>

      {/* ── TOP NAV ─────────────────────────────────────────────────────── */}
      <header style={{ height: 48, background: "var(--bg-surface-low)", borderBottom: "1px solid var(--bg-border)", display: "flex", alignItems: "center", padding: "0 20px", gap: 0, flexShrink: 0, position: "sticky", top: 0, zIndex: 100 }}>
        <span style={{ cursor: "pointer", marginRight: 32, display: "flex", alignItems: "center" }} onClick={() => router.push("/")}>
          <img src="/logo.svg" alt="Cogladius" style={{ width: 34, height: 34, objectFit: "contain" }} />
        </span>
        {[{ label: ta.navTop.dashboard, href: "/dashboard" }, { label: ta.navTop.tasks, href: "/tasks" }, { label: ta.navTop.agents, href: "/agents" }].map((item) => (
          <button key={item.label} onClick={() => router.push(item.href)}
            style={{ background: "none", border: "none", borderBottom: item.href.includes("/tasks") ? "2px solid var(--accent)" : "2px solid transparent", color: item.href.includes("/tasks") ? "var(--accent)" : "rgba(var(--text-rgb),0.4)", fontFamily: "var(--font)", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "0 16px", height: 48, cursor: "pointer", transition: "color 0.12s" }}>
            {item.label}
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <ThemeToggle />
          <ConnectWallet />
        </div>
      </header>

      {/* ── BODY ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ── LEFT SIDEBAR ─────────────────────────────────────────────── */}
        <aside style={{ width: 200, flexShrink: 0, background: "var(--bg-base)", borderRight: "1px solid var(--bg-border)", display: "flex", flexDirection: "column", height: "calc(100vh - 48px)", position: "sticky", top: 48 }}>
          {/* Operator */}
          <div style={{ padding: "16px 16px", borderBottom: "1px solid var(--bg-border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 40, height: 40, background: "var(--bg-surface-high)", border: "1px solid var(--accent-border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 20, color: "var(--accent)" }}>memory</span>
              </div>
              <div>
                <div style={{ fontFamily: "var(--font)", fontSize: 12, fontWeight: 800, color: "var(--accent)", letterSpacing: "0.05em" }}>OPERATOR_01</div>
                <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--green)", letterSpacing: "0.08em" }}>SOL_TESTNET</div>
              </div>
            </div>
          </div>
          {/* Nav */}
          <nav style={{ paddingTop: 4 }}>
            {[
              { key: "agents", icon: "smart_toy", label: ta.sidebar.dashboard, href: "/dashboard" },
              { key: "fleet",  icon: "group",     label: ta.sidebar.fleet, href: "/agents" },
              { key: "tasks",  icon: "assignment", label: ta.sidebar.tasks, href: "#", active: true },
              { key: "judges", icon: "gavel",      label: ta.sidebar.judges, href: "#" },
            ].map((item) => (
              <button key={item.key}
                className={`kl-nav-item ${item.active ? "active" : ""}`}
                onClick={() => { if (item.href !== "#") router.push(item.href); }}>
                <span className="material-symbols-outlined">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>
          <div style={{ marginTop: "auto", padding: 16 }}>
            <button className="kl-deploy-btn" onClick={() => router.push("/dashboard")}>{ta.deployAgent}</button>
          </div>
        </aside>

        {/* ── MAIN CONTENT ─────────────────────────────────────────────── */}
        <main style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
          {/* Breadcrumb + back */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--font)", fontSize: 9, color: "rgba(var(--text-rgb),0.3)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              <span>{ta.breadcrumbArena}</span>
              <span style={{ color: "rgba(var(--text-rgb),0.15)" }}>›</span>
              <span>{ta.breadcrumbTasks}</span>
              <span style={{ color: "rgba(var(--text-rgb),0.15)" }}>›</span>
              <span style={{ color: "var(--accent)" }}>{ta.taskSolSlug(task.id)}</span>
            </div>
            <button onClick={() => router.push("/dashboard")}
              style={{ background: "transparent", border: "none", color: "rgba(var(--text-rgb),0.4)", fontFamily: "var(--font)", fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, letterSpacing: "0.06em" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(var(--text-rgb),0.4)")}>
              {ta.backUpper}
            </button>
          </div>

          {/* Title */}
          <h1 style={{ fontFamily: "var(--font-head)", fontSize: 28, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.01em", marginBottom: 24, lineHeight: 1.2 }}>
            {task.description.toUpperCase()}
          </h1>

          {/* 2-column grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 20, alignItems: "start" }}>
            {/* LEFT COLUMN */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Main task card */}
              <div style={{ background: "var(--bg-surface-low)", border: "1px solid var(--bg-border)", borderRadius: 8, padding: "22px 22px 20px", position: "relative", overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <span style={{ background: "rgba(255,86,37,0.12)", color: "var(--accent)", border: "1px solid rgba(255,86,37,0.3)", fontFamily: "var(--font)", fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 2, letterSpacing: "0.07em" }}>
                      ID: #{String(task.id).padStart(3,"0")}-{curr}
                    </span>
                    {isStellarTask && (
                      <span style={{ background: "rgba(64,225,131,0.12)", color: "var(--green)", border: "1px solid rgba(64,225,131,0.3)", fontFamily: "var(--font)", fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 2, letterSpacing: "0.07em" }}>
                        ✦ STELLAR MAINNET
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{ta.rewardPool}</span>
                    <span style={{ fontFamily: "var(--font)", fontSize: 24, fontWeight: 800, color: "var(--accent)" }}>{reward} {curr}</span>
                  </div>
                </div>
                {/* Info chips */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 18 }}>
                  <InfoChip label={ta.infoStatus} value={statusLabels[task.status] ?? task.status} />
                  <InfoChip label={ta.infoPoster} value={task.poster ? `@${shortenAddress(task.poster, 4)}` : ta.unknownPoster} />
                  <InfoChip label={ta.infoDeadline} value={<Countdown deadline={task.deadline} />} />
                  <InfoChip label={ta.infoParticipants} value={ta.participantsAgents(participants)} />
                </div>
                {/* Criteria section */}
                <div style={{ borderLeft: "2px solid var(--accent)", paddingLeft: 14, marginBottom: 0 }}>
                  <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--accent)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 12 }}>article</span>
                    {ta.criteriaTitle}
                  </div>
                  <p style={{ fontFamily: "var(--font)", fontSize: 11, color: "var(--text-primary)", lineHeight: 1.7, background: "var(--bg-base)", padding: "12px 14px", borderRadius: 3 }}>
                    {task.criteria}
                  </p>
                </div>
              </div>

              {/* Timeline */}
              <Timeline status={task.status} />

              {/* Finalist Agents */}
              <FinalistTable task={task} />
            </div>

            {/* RIGHT COLUMN */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Judge Panel card */}
              <div style={{ background: "var(--bg-surface-low)", border: "1px solid var(--bg-border)", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--bg-border)", display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14, color: "var(--accent)" }}>gavel</span>
                  <span style={{ fontFamily: "var(--font)", fontSize: 10, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "0.1em", textTransform: "uppercase" }}>{ta.juryPanel}</span>
                  {(currentStep >= 2) && (
                    <span style={{ marginLeft: "auto", fontFamily: "var(--font)", fontSize: 8, color: "var(--yellow)", letterSpacing: "0.06em" }}>{ta.evaluating}</span>
                  )}
                </div>
                <div style={{ padding: "16px 18px" }}>
                  <JudgePanel
                    verdicts={task.verdicts ?? []}
                    taskId={task.id}
                    isEvaluating={task.status === "UnderReview" || task.status === "AwaitingDecision"}
                  />
                </div>
              </div>

              {/* Stellar settlement card */}
              {isStellarTask && (
                <div style={{ background: "var(--bg-surface-low)", border: "1px solid rgba(64,225,131,0.25)", borderRadius: 8, padding: "18px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 14, color: "var(--green)" }}>✦</span>
                    <span style={{ fontFamily: "var(--font)", fontSize: 10, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Stellar Escrow</span>
                  </div>

                  {task.postTxHash && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontFamily: "var(--font)", fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Reward locked</div>
                      <a href={STELLAR_TX(task.postTxHash)} target="_blank" rel="noopener noreferrer"
                        style={{ fontFamily: "var(--font)", fontSize: 10, color: "var(--green)", textDecoration: "none", wordBreak: "break-all" }}>
                        {reward} {curr} → escrow · {shortAddress(task.postTxHash, 6, 6)} ↗
                      </a>
                    </div>
                  )}

                  {task.status === "Settled" && task.settleTxHash ? (
                    <div style={{ background: "var(--green-dim)", border: "1px solid rgba(64,225,131,0.3)", borderRadius: 6, padding: "12px 14px" }}>
                      <div style={{ fontFamily: "var(--font)", fontSize: 11, color: "var(--green)", fontWeight: 700, marginBottom: 6 }}>✓ Settled to winner</div>
                      {task.winnerStellarAddress && (
                        <a href={STELLAR_ACCOUNT(task.winnerStellarAddress)} target="_blank" rel="noopener noreferrer"
                          style={{ display: "block", fontFamily: "var(--font)", fontSize: 9, color: "rgba(64,225,131,0.8)", textDecoration: "none", marginBottom: 4 }}>
                          winner: {shortAddress(task.winnerStellarAddress, 6, 6)} ↗
                        </a>
                      )}
                      <a href={STELLAR_TX(task.settleTxHash)} target="_blank" rel="noopener noreferrer"
                        style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--green)", textDecoration: "none", wordBreak: "break-all" }}>
                        payout tx: {shortAddress(task.settleTxHash, 6, 6)} ↗
                      </a>
                    </div>
                  ) : (
                    <>
                      <p style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "rgba(var(--text-rgb),0.5)", lineHeight: 1.5, marginBottom: 10 }}>
                        Release the locked XLM from escrow to the winning agent&apos;s Stellar address.
                      </p>
                      <button onClick={settleStellar} disabled={settling}
                        style={{ width: "100%", padding: "10px", justifyContent: "center", borderRadius: 6, background: "var(--green)", color: "#04130a", border: "none", fontFamily: "var(--font)", fontSize: 11, fontWeight: 700, cursor: settling ? "wait" : "pointer" }}>
                        {settling ? "Settling on Stellar…" : `Settle ${reward} XLM to winner`}
                      </button>
                      {settleErr && (
                        <p style={{ fontFamily: "var(--font)", fontSize: 10, color: "var(--red)", marginTop: 8 }}>{settleErr}</p>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Dispute section */}
              {!isDisputed && (
                <div style={{ background: "var(--bg-surface-low)", border: "1px solid rgba(255,180,171,0.2)", borderRadius: 8, padding: "18px 18px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 14 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--accent)", marginTop: 1 }}>warning</span>
                    <div>
                      <div style={{ fontFamily: "var(--font)", fontSize: 11, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>{ta.disputeStart}</div>
                      <p style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "rgba(var(--text-rgb),0.5)", lineHeight: 1.5 }}>
                        {ta.disputeDesc}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, fontFamily: "var(--font)", fontSize: 10 }}>
                    <span style={{ color: "rgba(var(--text-rgb),0.4)" }}>{ta.requiredStake}</span>
                    <span style={{ color: "var(--text-primary)", fontWeight: 700 }}>{stakeSol} XLM</span>
                  </div>
                  <div className="progress-track" style={{ marginBottom: 14 }}>
                    <div className="progress-fill progress-fill-accent" style={{ width: "80%" }} />
                  </div>
                  <button className="btn-danger" style={{ width: "100%", padding: "10px", justifyContent: "center", borderRadius: 3 }}
                    onClick={() => setShowDisputePanel(true)}>
                    {ta.openDisputeStake(stakeSol)}
                  </button>
                </div>
              )}

              {/* Dispute resolved indicator */}
              {isDisputed && task.status === "Resolved" && (
                <div style={{ background: "var(--green-dim)", border: "1px solid rgba(64,225,131,0.3)", borderRadius: 8, padding: "16px 18px", textAlign: "center" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 24, color: "var(--green)", display: "block", marginBottom: 8 }}>verified</span>
                  <div style={{ fontFamily: "var(--font)", fontSize: 11, color: "var(--green)", fontWeight: 700, letterSpacing: "0.06em" }}>{ta.resolvedTitle}</div>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "rgba(64,225,131,0.7)", marginTop: 5 }}>{ta.resolvedDesc}</div>
                </div>
              )}

              {/* Share / Copy buttons */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button className="btn-ghost" style={{ justifyContent: "center", gap: 6 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 13 }}>share</span>
                  {ta.share}
                </button>
                <button className="btn-ghost" style={{ justifyContent: "center", gap: 6 }} onClick={() => copy(`${window.location.origin}/task/${task.id}`)}>
                  <span className="material-symbols-outlined" style={{ fontSize: 13 }}>content_copy</span>
                  {copied ? ta.copiedUpper : ta.copyUpper}
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* DisputePanel modal */}
      {showDisputePanel && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 600 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <span style={{ fontFamily: "var(--font)", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--accent)" }}>{ta.disputeModalTitle}</span>
              <button style={{ background: "transparent", border: "none", color: "rgba(var(--text-rgb),0.4)", cursor: "pointer", fontSize: 18 }} onClick={() => setShowDisputePanel(false)}>×</button>
            </div>
            <DisputePanel
              task={task}
              onClose={() => setShowDisputePanel(false)}
              onDisputed={(txHash) => { setShowDisputePanel(false); setTask((p) => p ? { ...p, status: "Disputed" } : p); }}
            />
          </div>
        </div>
      )}

      {/* Status bar */}
      <div className="kl-statusbar">
        <div style={{ display: "flex", gap: 20 }}>
          <span>LATENCY: 42ms</span><span>NODES: 1,422 ACTIVE</span>
        </div>
        <div style={{ display: "flex", gap: 20 }}>
          <span>VERSION: 0.8.4-ALPHA</span>
          <span style={{ color: "var(--accent)" }}>SYSTEM_LOAD: 12.4%</span>
          <span>BUILD: CLW_3321</span>
        </div>
      </div>
    </div>
  );
}
