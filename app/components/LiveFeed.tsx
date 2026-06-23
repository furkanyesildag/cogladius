"use client";

import { useRef } from "react";
import { FeedEntry } from "@/lib/types";

interface LiveFeedProps {
  entries: FeedEntry[];
}

function getSourceStyle(icon: string, agent?: string): { label: string; cls: string } {
  const a = (agent || icon || "").toLowerCase();
  if (a.includes("alpha"))                         return { label: "ALPHA",  cls: "feed-tag-alpha" };
  if (a.includes("beta"))                          return { label: "BETA",   cls: "feed-tag-beta" };
  if (a.includes("hakem") || a.includes("judge"))  return { label: "JUDGE",  cls: "feed-tag-judge" };
  if (a === "tx" || icon === "tx")                 return { label: "TX",     cls: "feed-tag-tx" };
  if (a.includes("poster"))                        return { label: "USER",   cls: "feed-tag-tx" };
  return { label: "SYS", cls: "feed-tag-sys" };
}

export default function LiveFeed({ entries }: LiveFeedProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>

      {/* Header */}
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--bg-border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, background: "var(--bg-surface-low)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 14, color: "var(--accent)" }}>terminal</span>
          <span style={{ fontFamily: "var(--font)", fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.15em", textTransform: "uppercase" }}>Canlı Akış</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-ghost)" }}>{entries.length} olay</span>
          <span className="pulse-dot" style={{ width: 5, height: 5 }} />
        </div>
      </div>

      {/* Feed */}
      <div ref={containerRef} style={{ flex: 1, overflowY: "auto", padding: "6px 0", fontFamily: "var(--font)" }}>
        {entries.length === 0 ? (
          <div style={{ padding: "40px 20px", textAlign: "center", fontFamily: "var(--font)", fontSize: 11, color: "var(--text-ghost)", lineHeight: 2 }}>
            Aktivite bekleniyor...<br />
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>agent-simulator.js başlatın</span>
          </div>
        ) : (
          entries.map((entry, i) => {
            const src = getSourceStyle(entry.icon, entry.agent);
            return (
              <div
                key={entry.id || i}
                className="feed-entry terminal-row"
                style={{ display: "flex", gap: 10, padding: "5px 14px", alignItems: "flex-start" }}
              >
                {/* Timestamp */}
                <span suppressHydrationWarning style={{ fontSize: 10, color: "var(--text-ghost)", flexShrink: 0, minWidth: 58, paddingTop: 1 }}>
                  {entry.timeStr && entry.timeStr !== "--:--:--"
                    ? entry.timeStr
                    : new Date(entry.time).getTime() === 0
                      ? "——"
                      : new Date(entry.time).toLocaleTimeString("tr-TR", { hour12: false })}
                </span>

                {/* Source tag */}
                <span className={`feed-tag ${src.cls}`} style={{ marginTop: 1 }}>
                  {src.label}
                </span>

                {/* Message */}
                <span style={{ fontSize: 11, color: "var(--text-primary)", lineHeight: 1.6, flex: 1, wordBreak: "break-word" }}>
                  {entry.message}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
