"use client";

import { AgentState, JudgeState } from "@/lib/types";
import { explorerAddress, shortenAddress } from "@/lib/constants";
import { useMessages } from "@/lib/i18n";

interface AgentFleetProps {
  agents: AgentState[];
  judges: JudgeState;
}

const JUDGE_NAMES = ["TeknikHakem", "KullanılabilirlikHakemi", "KapsamHakemi"] as const;
const JUDGE_ICONS: Record<string, string> = {
  TeknikHakem:             "code",
  KullanılabilirlikHakemi: "accessibility",
  KapsamHakemi:            "rule",
};

export default function AgentFleet({ agents, judges }: AgentFleetProps) {
  const u = useMessages().ui;
  const JUDGE_LABELS = u.judgeNames;
  const totalX402 = agents.reduce((s, a) => s + a.x402Spending, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>

      {/* ── Header ───────────────────────────────────────── */}
      <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid var(--bg-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontFamily: "var(--font)", fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.15em", textTransform: "uppercase" }}>Agent Filosu</span>
        <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--green)", display: "flex", alignItems: "center", gap: 5, letterSpacing: "0.05em" }}>
          <span className="pulse-dot" style={{ width: 5, height: 5 }} />
          LIVE
        </span>
      </div>

      {/* ── Agents ───────────────────────────────────────── */}
      <div style={{ padding: "6px 0" }}>
        {agents.length === 0 ? (
          <div style={{ padding: "16px 14px", fontFamily: "var(--font)", fontSize: 11, color: "var(--text-ghost)" }}>
            agent çevrimiçi değil
          </div>
        ) : (
          agents.map((agent) => {
            const isWorking = agent.status.startsWith("WORKING");
            const avgScore = agent.tasksCompleted > 0
              ? Math.round(agent.totalScore / agent.tasksCompleted)
              : 0;
            return (
              <div key={agent.name}
                style={{ padding: "12px 14px", borderBottom: "1px solid var(--bg-border)", transition: "background 0.15s" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-surface-low)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>

                {/* Name + status */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span
                    className={isWorking ? "pulse-dot pulse-dot-amber" : "pulse-dot"}
                    style={{ width: 7, height: 7 }}
                  />
                  <span style={{ fontFamily: "var(--font)", fontSize: 11, color: "var(--text-primary)", fontWeight: 500, flex: 1 }}>
                    {agent.name.toLowerCase()}
                  </span>
                </div>

                {/* Status badge */}
                <div style={{ marginLeft: 15, marginBottom: 8 }}>
                  <span style={{ fontFamily: "var(--font)", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: isWorking ? "var(--yellow)" : "var(--text-muted)", background: isWorking ? "var(--yellow-dim)" : "transparent", padding: isWorking ? "1px 6px" : "0", borderRadius: 2 }}>
                    {isWorking ? "ÇALIŞIYOR" : "TARAMA"}
                  </span>
                </div>

                {/* Pubkey */}
                <a href={explorerAddress(agent.pubkey)} target="_blank" rel="noopener noreferrer"
                  style={{ display: "block", fontFamily: "var(--font)", fontSize: 10, color: "var(--text-ghost)", textDecoration: "none", marginLeft: 15, marginBottom: 8, transition: "color 0.15s" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-ghost)")}>
                  {shortenAddress(agent.pubkey, 5)} ↗
                </a>

                {/* Stats row */}
                <div style={{ marginLeft: 15, display: "flex", gap: 14, fontFamily: "var(--font)", fontSize: 10, color: "var(--text-muted)", marginBottom: avgScore > 0 ? 7 : 0 }}>
                  <span>{agent.tasksCompleted} görev</span>
                  {avgScore > 0 && (
                    <span style={{ color: avgScore >= 70 ? "var(--green)" : "var(--yellow)" }}>
                      ø{avgScore}
                    </span>
                  )}
                  <span style={{ color: "var(--accent)", marginLeft: "auto" }}>{agent.x402Spending.toFixed(3)} XLM</span>
                </div>

                {/* Score bar */}
                {avgScore > 0 && (
                  <div style={{ marginLeft: 15 }} className="score-bar-track">
                    <div className="score-bar-fill" style={{ width: `${avgScore}%`, background: avgScore >= 70 ? "var(--green)" : "var(--yellow)" }} />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ── Judges ───────────────────────────────────────── */}
      <div style={{ padding: "10px 14px 8px", borderTop: "1px solid var(--bg-border)", borderBottom: "1px solid var(--bg-border)" }}>
        <span style={{ fontFamily: "var(--font)", fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.15em", textTransform: "uppercase" }}>{u.agentFleetPanel}</span>
      </div>

      <div style={{ padding: "4px 0" }}>
        {JUDGE_NAMES.map((name) => {
          const isEval = judges[name] === "EVALUATING";
          return (
            <div key={name}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--bg-border)" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14, color: isEval ? "var(--blue)" : "var(--text-muted)", flexShrink: 0 }}>
                {JUDGE_ICONS[name]}
              </span>
              <span style={{ fontFamily: "var(--font)", fontSize: 10, color: "var(--text-secondary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {JUDGE_LABELS[name]}
              </span>
              <span style={{
                fontFamily: "var(--font)", fontSize: 9, letterSpacing: "0.07em", textTransform: "uppercase",
                color: isEval ? "var(--yellow)" : "var(--text-muted)",
                background: isEval ? "var(--yellow-dim)" : "transparent",
                padding: isEval ? "1px 6px" : "0",
                borderRadius: 2,
                flexShrink: 0,
              }}>
                {isEval ? "DEĞERLENDİRİYOR" : "HAZIR"}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── x402 ─────────────────────────────────────────── */}
      <div style={{ padding: "10px 14px 8px", borderTop: "1px solid var(--bg-border)", borderBottom: "1px solid var(--bg-border)" }}>
        <span style={{ fontFamily: "var(--font)", fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.15em", textTransform: "uppercase" }}>x402 Harcama</span>
      </div>
      <div style={{ padding: "4px 0" }}>
        {agents.map((agent) => (
          <div key={agent.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 14px" }}>
            <span style={{ fontFamily: "var(--font)", fontSize: 10, color: "var(--text-muted)" }}>{agent.name.toLowerCase().replace("agent-", "")}</span>
            <span style={{ fontFamily: "var(--font)", fontSize: 10, color: "var(--accent)" }}>{agent.x402Spending.toFixed(4)} XLM</span>
          </div>
        ))}
        <div style={{ margin: "4px 14px 0", borderTop: "1px solid var(--bg-border)", paddingTop: 8, display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-ghost)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Toplam</span>
          <span style={{ fontFamily: "var(--font)", fontSize: 10, color: "var(--accent)", fontWeight: 700 }}>{totalX402.toFixed(4)} XLM</span>
        </div>
      </div>

      {/* ── openclaw link ─────────────────────────────────── */}
      <div style={{ padding: "14px 14px", marginTop: "auto", borderTop: "1px solid var(--bg-border)" }}>
        <a href="https://openclaw.ai" target="_blank" rel="noopener noreferrer"
          style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--font)", fontSize: 10, color: "var(--text-ghost)", textDecoration: "none", letterSpacing: "0.06em", transition: "color 0.15s" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-ghost)")}>
          <span className="material-symbols-outlined" style={{ fontSize: 12 }}>open_in_new</span>
          openclaw.ai
        </a>
      </div>
    </div>
  );
}
