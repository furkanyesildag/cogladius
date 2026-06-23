"use client";

import { TxEntry } from "@/lib/types";
import { explorerTx, shortenAddress } from "@/lib/constants";

interface TxFeedProps {
  txLog: TxEntry[];
}

function getTxTypeColor(type: string): string {
  if (type.includes("settle") || type.includes("reward")) return "var(--green)";
  if (type.includes("dispute") || type.includes("resolve")) return "var(--red)";
  if (type.includes("post")) return "var(--accent)";
  return "var(--blue)";
}

export default function TxFeed({ txLog }: TxFeedProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>

      {/* Header */}
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--bg-border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, background: "var(--bg-surface-low)", position: "sticky", top: 0, zIndex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 14, color: "var(--accent)" }}>receipt_long</span>
          <span style={{ fontFamily: "var(--font)", fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.15em", textTransform: "uppercase" }}>TX_Feed</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="pulse-dot" style={{ width: 5, height: 5 }} />
          <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-ghost)", letterSpacing: "0.06em" }}>LIVE_TICKER</span>
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {txLog.length === 0 ? (
          <div style={{ padding: "40px 16px", textAlign: "center", fontFamily: "var(--font)", fontSize: 11, color: "var(--text-ghost)", lineHeight: 2 }}>
            Henüz işlem yok<br />
            <span style={{ fontSize: 10 }}>Agent aktivitesi bekleniyor...</span>
          </div>
        ) : (
          txLog.map((tx, i) => (
            <div
              key={tx.id || i}
              className={tx.highlight ? "tx-new" : ""}
              style={{ padding: "12px 14px", borderBottom: "1px solid var(--bg-border)", transition: "background 0.15s", cursor: "pointer" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-surface-high)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>

              {/* Row 1: type + amount */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontFamily: "var(--font)", fontSize: 11, color: getTxTypeColor(tx.type), fontWeight: 700 }}>
                  {tx.type}
                </span>
                <span style={{ marginLeft: "auto", fontFamily: "var(--font)", fontSize: 11, color: tx.type.includes("settle") || tx.type.includes("reward") ? "var(--green)" : "var(--accent)" }}>
                  {tx.amount || (tx.score !== undefined ? `${tx.score}/100` : "")}
                  {tx.scores && `ort: ${Math.round(tx.scores.reduce((a, b) => a + b, 0) / tx.scores.length)}`}
                </span>
              </div>

              {/* Row 2: winner/agent/task */}
              {(tx.winner || tx.agent || tx.judge || tx.taskId) && (
                <div style={{ fontFamily: "var(--font)", fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "flex", gap: 12 }}>
                  {tx.winner && (
                    <span>
                      <span style={{ color: "var(--text-ghost)" }}>→ </span>
                      <span style={{ color: "var(--green)" }}>{tx.winner.length > 10 ? shortenAddress(tx.winner) : tx.winner.toLowerCase()}</span>
                    </span>
                  )}
                  {tx.agent && !tx.winner && <span style={{ color: "var(--text-muted)" }}>{tx.agent.toLowerCase()}</span>}
                  {tx.judge && <span style={{ color: "var(--blue)" }}>{tx.judge.toLowerCase()}</span>}
                  {tx.taskId && <span style={{ color: "var(--text-ghost)" }}>görev #{tx.taskId}</span>}
                </div>
              )}

              {/* Row 3: slot + latency */}
              {(tx.slot || tx.ms) && (
                <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-ghost)", display: "flex", gap: 12, marginBottom: 6 }}>
                  {tx.slot && <span>slot {tx.slot.toLocaleString()}</span>}
                  {tx.ms && <span style={{ color: tx.ms < 400 ? "var(--green)" : "var(--yellow)" }}>{tx.ms}ms</span>}
                </div>
              )}

              {/* Row 4: hash */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <a href={tx.explorerUrl || explorerTx(tx.hash)} target="_blank" rel="noopener noreferrer"
                  style={{ fontFamily: "var(--font)", fontSize: 10, color: "var(--text-ghost)", textDecoration: "none", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", transition: "color 0.15s" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent-soft)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-ghost)")}>
                  {tx.hash.substring(0, 20)}...
                </a>
                <a href={tx.explorerUrl || explorerTx(tx.hash)} target="_blank" rel="noopener noreferrer"
                  style={{ color: "var(--text-ghost)", textDecoration: "none", transition: "color 0.15s", display: "flex", alignItems: "center" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-ghost)")}>
                  <span className="material-symbols-outlined" style={{ fontSize: 13 }}>open_in_new</span>
                </a>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
