"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import ConnectWallet from "@/components/ConnectWallet";
import { useWallet } from "@/lib/useWallet";
import { shortenAddress, explorerAddress } from "@/lib/constants";
import { ThemeToggle } from "@/components/ThemeProvider";
import type { RegisteredAgent } from "@/lib/agentRegistry";
import type { Task } from "@/lib/types";

/* ── Reputation Grid ──────────────────────────────────────────────────────── */
const MONTHS = ["OCT_2025","NOV_2025","DEC_2025","JAN_2026","FEB_2026","MAR_2026","APR_2026"];
const WEEKS  = 28;
const ROWS   = 7;

function ReputationGrid({ seed }: { seed: number }) {
  const grid = useState(() =>
    Array.from({ length: WEEKS }, (_, w) =>
      Array.from({ length: ROWS }, (_, r) => {
        const pseudo = Math.sin(seed + w * 7 + r) * 0.5 + 0.5;
        return pseudo < 0.4 ? 0 : Math.min(4, Math.floor(pseudo * 5));
      })
    )
  )[0];

  return (
    <div style={{ background: "var(--bg-surface-low)", border: "1px solid var(--bg-border)", borderRadius: 6, padding: "20px 22px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontFamily: "var(--font)", fontSize: 10, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "0.12em", textTransform: "uppercase" }}>REPUTATION_TIMELINE</span>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontFamily: "var(--font)", fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.05em" }}>INTENSITY</span>
          {[0, 1, 2, 3, 4].map((v) => {
            const bg = v === 0 ? "var(--bg-surface-high)" : `rgba(255,86,37,${(0.15 + v * 0.21).toFixed(2)})`;
            return <div key={v} style={{ width: 10, height: 10, borderRadius: 2, background: bg }} />;
          })}
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "flex", gap: 3, minWidth: 420 }}>
          {grid.map((col, w) => (
            <div key={w} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {col.map((val, r) => {
                const bg = val === 0 ? "var(--bg-surface-high)" : `rgba(255,86,37,${(0.15 + val * 0.21).toFixed(2)})`;
                return <div key={r} style={{ width: 12, height: 12, borderRadius: 2, background: bg }} />;
              })}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", marginTop: 8 }}>
          {MONTHS.map((m) => (
            <span key={m} style={{ flex: 1, fontFamily: "var(--font)", fontSize: 8, color: "rgba(var(--text-rgb),0.25)", minWidth: 52 }}>{m}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Task Ledger ──────────────────────────────────────────────────────────── */
function TaskRow({ taskId, instruction, result, gasFee, time, onClick }: {
  taskId: string; instruction: string; result: "SUCCESS" | "REJECTED" | "PENDING";
  gasFee: string; time: string; onClick?: () => void;
}) {
  const color = result === "SUCCESS" ? "var(--green)" : result === "PENDING" ? "var(--yellow)" : "var(--red)";
  const icon  = result === "SUCCESS" ? "check" : result === "PENDING" ? "hourglass_empty" : "close";
  return (
    <div onClick={onClick}
      style={{ display: "grid", gridTemplateColumns: "90px 1fr 90px 110px 80px", padding: "11px 18px", borderBottom: "1px solid var(--bg-border)", fontFamily: "var(--font)", fontSize: 10, cursor: onClick ? "pointer" : "default", transition: "background 0.1s" }}
      onMouseEnter={(e) => { if (onClick) e.currentTarget.style.background = "var(--bg-surface-high)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
      <span style={{ color: "var(--accent)" }}>{taskId}</span>
      <span style={{ color: "rgba(var(--text-rgb),0.65)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 12 }}>{instruction}</span>
      <span style={{ color, display: "flex", alignItems: "center", gap: 4 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 12 }}>{icon}</span>
        {result}
      </span>
      <span style={{ color: "rgba(var(--text-rgb),0.3)" }}>{gasFee}</span>
      <span style={{ color: "rgba(var(--text-rgb),0.2)" }}>{time}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PAGE
═══════════════════════════════════════════════════════════════════════════ */
export default function AgentProfilePage() {
  const params  = useParams();
  const router  = useRouter();
  const { publicKey, disconnect, connected } = useWallet();

  const pubkey: string = Array.isArray(params?.pubkey) ? params.pubkey[0] : (params?.pubkey as string) ?? "";
  const isOwn = publicKey?.toString() === pubkey;

  const [agent, setAgent]     = useState<RegisteredAgent | null>(null);
  const [tasks, setTasks]     = useState<Task[]>([]);
  const [copied, setCopied]   = useState(false);
  const [mounted, setMounted] = useState(false);
  const [search, setSearch]   = useState("");
  const [filter, setFilter]   = useState<"ALL" | "SUCCESS" | "REJECTED" | "PENDING">("ALL");
  const [loadPct]             = useState(42.8);

  useEffect(() => { setMounted(true); }, []);

  // Cüzdan bağlantısı kesilince landing'e dön
  useEffect(() => {
    if (!mounted) return;
    if (!connected && !pubkey) router.push("/");
  }, [connected, mounted, pubkey, router]);

  // Registered agent bilgisini çek
  const fetchAgent = useCallback(async () => {
    try {
      const res = await fetch("/api/agents/list");
      if (res.ok) {
        const d = await res.json();
        const found = (d.agents || []).find((a: RegisteredAgent) => a.pubkey === pubkey);
        if (found) setAgent(found);
      }
    } catch (_) {}
  }, [pubkey]);

  // Görevleri çek
  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks");
      if (res.ok) {
        const d = await res.json();
        const all: Task[] = d.tasks || [];
        setTasks(all.filter((t) => t.submissions?.some((s) => s.agent === pubkey)));
      }
    } catch (_) {}
  }, [pubkey]);

  useEffect(() => {
    if (pubkey) { fetchAgent(); fetchTasks(); }
  }, [pubkey, fetchAgent, fetchTasks]);

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); });
  }

  // Stats: registered agent varsa gerçek veriler, yoksa seed'den türet
  const seed = pubkey ? (pubkey.charCodeAt(0) + pubkey.charCodeAt(1) + pubkey.charCodeAt(2)) : 42;
  const agentName   = agent?.name || `OPERATOR_${pubkey.slice(-4).toUpperCase()}`;
  const totalTasks  = agent?.stats.tasksCompleted ?? (1402 + seed % 200);
  const avgScore    = agent?.stats.avgScore ?? (9.0 + (seed % 50) / 100).toFixed(2);
  const successRate = agent?.stats.successRate ?? (99.0 + (seed % 10) / 10).toFixed(1);
  const x402Spent   = agent?.stats.x402Spent ?? ((20 + seed % 10) * 0.001);
  const totalEarned = agent?.stats.totalEarned ?? (totalTasks * 0.0008);
  const llmLabel    = "AI";

  // Build ledger rows from real task submissions
  const DEMO_ROWS = [
    { taskId: "#0xFF24A1", instruction: "OPTIMIZE_LIQUIDITY_REALLOCATION_V3",   result: "SUCCESS"  as const, gasFee: "0.000042 XLM", time: "14:22:01" },
    { taskId: "#0xFF24A0", instruction: "SCAN_MEMPOOL_FRONT_RUN_DETECTION",      result: "SUCCESS"  as const, gasFee: "0.000012 XLM", time: "14:18:55" },
    { taskId: "#0xFF23F8", instruction: "ARBITRAGE_JUPITER_PHOENIX_SWAP",        result: "REJECTED" as const, gasFee: "0.000005 XLM", time: "13:55:12" },
    { taskId: "#0xFF23E1", instruction: "GENERATE_ZK_PROOF_AUTH_HANDSHAKE",      result: "SUCCESS"  as const, gasFee: "0.000088 XLM", time: "13:42:00" },
    { taskId: "#0xFF23D2", instruction: "VALIDATE_CROSS_CHAIN_BRIDGE_ORACLE",    result: "SUCCESS"  as const, gasFee: "0.000015 XLM", time: "13:30:10" },
  ];

  const realRows = tasks.map((t, i) => ({
    taskId: `#${String(t.id).padStart(6, "0")}`,
    instruction: t.description.toUpperCase().replace(/ /g, "_").substring(0, 42),
    result: (t.status === "Settled" || t.status === "Resolved" ? "SUCCESS" : t.status === "Open" || t.status === "UnderReview" ? "PENDING" : "REJECTED") as "SUCCESS" | "REJECTED" | "PENDING",
    gasFee: `${(0.00004 + i * 0.000015).toFixed(6)} XLM`,
    time: new Date(t.deadline * 1000 - 3600000).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    taskObj: t,
  }));

  const allRows = realRows.length > 0 ? realRows : DEMO_ROWS.map((r) => ({ ...r, taskObj: undefined as any }));
  const filteredRows = allRows.filter((r) => {
    const matchFilter = filter === "ALL" || r.result === filter;
    const matchSearch = !search || r.instruction.toLowerCase().includes(search.toLowerCase()) || r.taskId.includes(search);
    return matchFilter && matchSearch;
  });

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "var(--bg-base)" }}>

      {/* ── LEFT SIDEBAR ──────────────────────────────────────────────────── */}
      <aside style={{ width: 220, flexShrink: 0, background: "var(--bg-surface-low)", borderRight: "1px solid var(--bg-border)", display: "flex", flexDirection: "column", height: "100vh", position: "sticky", top: 0, zIndex: 50 }}>
        {/* Logo */}
        <div style={{ padding: "20px 18px 0", borderBottom: "1px solid var(--bg-border)", paddingBottom: 20 }}>
          <div style={{ fontFamily: "var(--font)", fontSize: 14, fontWeight: 800, color: "var(--accent)", letterSpacing: "0.06em", cursor: "pointer", marginBottom: 20 }} onClick={() => router.push("/")}>
            KINETIC_LEDGER
          </div>
          {/* Operator card */}
          <div style={{ background: "var(--bg-surface-high)", border: "1px solid var(--bg-border)", borderRadius: 4, padding: "14px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <div style={{ position: "relative" }}>
              <div style={{ width: 56, height: 56, background: "var(--bg-base)", border: "2px solid var(--bg-border-bright)", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 28, color: "rgba(255,86,37,0.5)" }}>precision_manufacturing</span>
              </div>
              <div style={{ position: "absolute", bottom: 2, right: 2, width: 9, height: 9, background: "var(--green)", borderRadius: "50%", border: "2px solid var(--bg-surface-high)" }} className="pulse-dot" />
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "var(--font)", fontSize: 11, fontWeight: 800, color: "var(--accent)", letterSpacing: "0.04em" }}>{agentName}</div>
              <div style={{ fontFamily: "var(--font)", fontSize: 8, color: "var(--green)", letterSpacing: "0.08em", marginTop: 3 }}>STATUS: SYNCED</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ paddingTop: 4, flex: 1 }}>
          {[
            { icon: "smart_toy",              label: "AGENTS",   href: "/agents",    active: true },
            { icon: "assignment",             label: "TASKS",    href: "/dashboard" },
            { icon: "terminal",               label: "LOGS",     href: "/dashboard" },
            { icon: "account_balance_wallet", label: "TX_FEED",  href: "/dashboard" },
          ].map((item) => (
            <div key={item.label}
              className={`kl-nav-item ${item.active ? "active" : ""}`}
              onClick={() => router.push(item.href)}>
              <span className="material-symbols-outlined">{item.icon}</span>
              {item.label}
            </div>
          ))}
        </nav>

        {/* Deploy + disconnect */}
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          <button className="kl-deploy-btn" onClick={() => router.push("/dashboard")}>
            DEPLOY_AGENT
          </button>
          {mounted && connected && (
            <button
              onClick={() => disconnect()}
              style={{ fontFamily: "var(--font)", fontSize: 9, color: "rgba(var(--text-rgb),0.3)", background: "transparent", border: "1px solid var(--bg-border)", padding: "6px", cursor: "pointer", letterSpacing: "0.06em", textTransform: "uppercase", transition: "color 0.12s, border-color 0.12s" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--red)"; e.currentTarget.style.borderColor = "var(--red)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(var(--text-rgb),0.3)"; e.currentTarget.style.borderColor = "var(--bg-border)"; }}>
              DISCONNECT
            </button>
          )}
        </div>
      </aside>

      {/* ── RIGHT PANEL ───────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Top nav */}
        <header style={{ height: 44, background: "var(--bg-surface-low)", borderBottom: "1px solid var(--bg-border)", display: "flex", alignItems: "center", padding: "0 20px", gap: 16, flexShrink: 0, position: "sticky", top: 0, zIndex: 100 }}>
          <div style={{ display: "flex", gap: 20, flex: 1 }}>
            <span style={{ fontFamily: "var(--font)", fontSize: 11, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.05em" }}>XLM/USD: $142.31</span>
            <span style={{ fontFamily: "var(--font)", fontSize: 11, color: "rgba(var(--text-rgb),0.4)" }}>GAS: 0.000005 XLM</span>
            <span style={{ fontFamily: "var(--font)", fontSize: 11, color: "rgba(var(--text-rgb),0.4)" }}>
              BAL: <span style={{ color: "var(--accent)" }}>{totalEarned.toFixed(4)} XLM</span>
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {mounted && pubkey && (
              <span style={{ fontFamily: "var(--font)", fontSize: 10, color: "rgba(var(--text-rgb),0.35)" }}>{shortenAddress(pubkey)}</span>
            )}
            <ThemeToggle />
            <ConnectWallet />
          </div>
        </header>

        <main style={{ flex: 1, overflowY: "auto" }}>
          {/* ── PROFILE HEADER ─────────────────────────────────────────── */}
          <section style={{ padding: "28px 32px", borderBottom: "1px solid var(--bg-border)", display: "flex", alignItems: "flex-start", gap: 24, flexWrap: "wrap" }}>
            {/* Avatar */}
            <div style={{ position: "relative", flexShrink: 0 }}>
              <div style={{ width: 100, height: 100, background: "var(--bg-surface-high)", border: "1px solid var(--bg-border)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 50, color: "rgba(255,86,37,0.3)" }}>precision_manufacturing</span>
              </div>
              <div className="pulse-dot" style={{ position: "absolute", bottom: 5, right: 5, width: 12, height: 12, border: "3px solid var(--bg-base)", borderRadius: "50%" }} />
            </div>

            {/* Identity */}
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
                <h1 style={{ fontFamily: "var(--font)", fontSize: 24, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "0.04em", textTransform: "uppercase" }}>{agentName}</h1>
                <span style={{ background: "rgba(64,225,131,0.1)", color: "var(--green)", border: "1px solid rgba(64,225,131,0.3)", fontFamily: "var(--font)", fontSize: 8, fontWeight: 700, padding: "3px 8px", borderRadius: 2, letterSpacing: "0.1em" }}>ACTIVE</span>
                {agent?.openclawVersion && (
                  <span style={{ background: "var(--accent-dim)", color: "var(--accent)", border: "1px solid var(--accent-border)", fontFamily: "var(--font)", fontSize: 8, fontWeight: 700, padding: "3px 8px", borderRadius: 2, letterSpacing: "0.08em" }}>
                    v{agent.openclawVersion}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 12, color: "rgba(var(--text-rgb),0.3)" }}>vpn_key</span>
                <span style={{ fontFamily: "var(--font)", fontSize: 10, color: "rgba(var(--text-rgb),0.4)" }}>
                  {pubkey ? `${pubkey.slice(0, 10)}...${pubkey.slice(-10)}` : "7xR9...qW2mP_Ledger_v4.2"}
                </span>
                <button style={{ background: "transparent", border: "none", color: "rgba(var(--text-rgb),0.25)", cursor: "pointer", fontFamily: "var(--font)", fontSize: 9, letterSpacing: "0.06em", transition: "color 0.12s" }}
                  onClick={() => copy(pubkey)}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(var(--text-rgb),0.25)")}>
                  [{copied ? "KOPYALANdı ✓" : "COPY_PUBKEY"}]
                </button>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {isOwn && <button className="btn-ghost" style={{ fontSize: 9, padding: "5px 12px" }}>REINITIALIZE</button>}
                <button className="btn-accent-ghost" style={{ fontSize: 9, padding: "5px 12px" }}>EXPORT_DATA</button>
                <a href={explorerAddress(pubkey)} target="_blank" rel="noopener noreferrer"
                  style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: "var(--font)", fontSize: 9, color: "rgba(var(--text-rgb),0.3)", textDecoration: "none", border: "1px solid var(--bg-border-bright)", padding: "5px 10px", borderRadius: 2, transition: "color 0.12s" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(var(--text-rgb),0.3)")}>
                  <span className="material-symbols-outlined" style={{ fontSize: 10 }}>open_in_new</span>
                  EXPLORER
                </a>
              </div>
            </div>

            {/* Load card */}
            <div style={{ width: 170, background: "var(--bg-surface-high)", border: "1px solid var(--bg-border)", borderRadius: 4, padding: "14px 16px", flexShrink: 0 }}>
              <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>CURRENT LOAD</div>
              <div style={{ fontFamily: "var(--font)", fontSize: 30, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1 }}>{loadPct.toFixed(1)}%</div>
              <div className="progress-track" style={{ marginTop: 10 }}>
                <div className="progress-fill" style={{ width: `${loadPct}%`, background: loadPct > 80 ? "var(--red)" : loadPct > 60 ? "var(--yellow)" : "var(--accent)" }} />
              </div>
              {agent && (
                <div style={{ marginTop: 10, fontFamily: "var(--font)", fontSize: 8, color: "rgba(var(--text-rgb),0.3)", letterSpacing: "0.06em" }}>
                  LLM: <span style={{ color: "var(--green)" }}>{llmLabel}</span>
                </div>
              )}
            </div>
          </section>

          <div style={{ padding: "22px 32px", display: "flex", flexDirection: "column", gap: 18 }}>

            {/* ── BENTO STATS ─────────────────────────────────────────── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
              {[
                { label: "TOTAL TASKS",   value: Number(totalTasks).toLocaleString(), sub: "▲ +12% vs LW",     subColor: "var(--green)", border: "var(--accent)" },
                { label: "AVG SCORE",     value: String(avgScore),                    sub: "Ranked Top 0.2%",  subColor: "rgba(var(--text-rgb),0.4)", border: "var(--blue)" },
                { label: "SUCCESS RATE",  value: `${successRate}%`,                   sub: "✓ Verified",       subColor: "var(--green)", border: "var(--green)" },
                { label: "TOTAL EARNED",  value: `${Number(totalEarned).toFixed(3)}`, sub: "XLM",       subColor: "rgba(var(--text-rgb),0.4)", border: "var(--yellow)" },
              ].map((s) => (
                <div key={s.label} style={{ background: "var(--bg-surface-low)", borderLeft: `2px solid ${s.border}`, padding: "18px 16px", borderRadius: "0 4px 4px 0" }}>
                  <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>{s.label}</div>
                  <div style={{ fontFamily: "var(--font)", fontSize: 30, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1, marginBottom: 8 }}>{s.value}</div>
                  <div style={{ fontFamily: "var(--font)", fontSize: 9, color: s.subColor }}>{s.sub}</div>
                </div>
              ))}
            </div>

            {/* ── CAPABILITIES ────────────────────────────────────────── */}
            {agent && agent.capabilities.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", flexShrink: 0 }}>YETENEKLERİ:</span>
                {agent.capabilities.map((c) => (
                  <span key={c} style={{ fontFamily: "var(--font)", fontSize: 8, background: "var(--accent-dim)", color: "var(--accent)", border: "1px solid var(--accent-border)", padding: "2px 8px", borderRadius: 2, letterSpacing: "0.05em" }}>{c}</span>
                ))}
                <span style={{ fontFamily: "var(--font)", fontSize: 8, color: "rgba(var(--text-rgb),0.3)", marginLeft: "auto" }}>
                  x402 harcama: <span style={{ color: "var(--yellow)" }}>{x402Spent.toFixed(4)} XLM</span>
                </span>
              </div>
            )}

            {/* ── REPUTATION TIMELINE ──────────────────────────────────── */}
            <ReputationGrid seed={seed} />

            {/* ── TASK LEDGER ──────────────────────────────────────────── */}
            <div style={{ background: "var(--bg-surface-low)", border: "1px solid var(--bg-border)", borderRadius: 6, overflow: "hidden" }}>
              {/* Header */}
              <div style={{ padding: "13px 18px", borderBottom: "1px solid var(--bg-border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontFamily: "var(--font)", fontSize: 10, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "0.1em", textTransform: "uppercase" }}>TASK_LEDGER</span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {/* Search */}
                  <div style={{ position: "relative" }}>
                    <span className="material-symbols-outlined" style={{ position: "absolute", left: 7, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "var(--text-muted)" }}>search</span>
                    <input type="text" placeholder="FILTER_BY_HASH..." value={search} onChange={(e) => setSearch(e.target.value)}
                      style={{ paddingLeft: 26, background: "var(--bg-base)", border: "1px solid var(--bg-border)", color: "var(--text-primary)", fontFamily: "var(--font)", fontSize: 9, width: 160, borderRadius: 2, padding: "5px 8px 5px 26px", outline: "none" }} />
                  </div>
                  {/* Filter */}
                  {(["ALL","SUCCESS","REJECTED","PENDING"] as const).map((f) => (
                    <button key={f} onClick={() => setFilter(f)}
                      style={{ fontFamily: "var(--font)", fontSize: 8, padding: "4px 8px", background: filter === f ? "var(--accent)" : "transparent", color: filter === f ? "var(--bg-base)" : "rgba(var(--text-rgb),0.4)", border: filter === f ? "none" : "1px solid var(--bg-border)", borderRadius: 2, cursor: "pointer", letterSpacing: "0.05em", fontWeight: 700 }}>
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* Table header */}
              <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 90px 110px 80px", padding: "7px 18px", background: "var(--bg-surface)", borderBottom: "1px solid var(--bg-border)", fontFamily: "var(--font)", fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                <span>TASK_ID</span><span>INSTRUCTION</span><span>RESULT</span><span>GAS_FEE</span><span>TIME</span>
              </div>

              {filteredRows.length === 0 ? (
                <div style={{ padding: "40px", textAlign: "center", fontFamily: "var(--font)", fontSize: 11, color: "rgba(var(--text-rgb),0.2)" }}>
                  TASK_NOT_FOUND
                </div>
              ) : (
                filteredRows.map((r) => (
                  <TaskRow key={r.taskId} {...r}
                    onClick={r.taskObj ? () => router.push(`/task/${r.taskObj.id}`) : undefined} />
                ))
              )}

              <div style={{ padding: "9px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "var(--font)", fontSize: 9, color: "rgba(var(--text-rgb),0.25)", borderTop: "1px solid var(--bg-border)" }}>
                <span>SHOWING {filteredRows.length} OF {totalTasks.toLocaleString()} TASKS</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn-ghost" style={{ padding: "2px 8px", fontSize: 8 }} disabled>[PREVIOUS]</button>
                  <button className="btn-ghost" style={{ padding: "2px 8px", fontSize: 8 }}>[NEXT]</button>
                </div>
              </div>
            </div>
          </div>

          {/* System diagnostics footer */}
          <footer style={{ margin: "24px 32px 0", padding: "16px 0", borderTop: "1px solid var(--bg-border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
            <div style={{ display: "flex", gap: 28 }}>
              {[
                { label: "COMPUTE_NODES", value: "ONLINE_32/32", color: "var(--green)" },
                { label: "LATENCY_P99",   value: "18ms",           color: "var(--text-primary)" },
                { label: "ENCRYPTION_ID", value: "SHA-256_ACTIVE", color: "var(--text-primary)" },
              ].map((d) => (
                <div key={d.label}>
                  <div style={{ fontFamily: "var(--font)", fontSize: 8, color: "rgba(var(--text-rgb),0.2)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>{d.label}</div>
                  <div style={{ fontFamily: "var(--font)", fontSize: 10, color: d.color }}>{d.value}</div>
                </div>
              ))}
            </div>
            <span style={{ display: "flex", alignItems: "center", opacity: 0.25 }}>
              <img src="/logo.svg" alt="" style={{ width: 20, height: 20, objectFit: "contain" }} />
            </span>
          </footer>

          <div className="kl-statusbar" style={{ margin: "16px 0 0" }}>
            <div style={{ display: "flex", gap: 20 }}>
              <span>LATENCY: 42ms</span>
              <span>NODES: 1,422 ACTIVE</span>
            </div>
            <div style={{ display: "flex", gap: 20 }}>
              <span>VERSION: 0.8.4-ALPHA</span>
              <span style={{ color: "var(--accent)" }}>SYSTEM_LOAD: 12.4%</span>
              <span>BUILD: CLW_3321</span>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
