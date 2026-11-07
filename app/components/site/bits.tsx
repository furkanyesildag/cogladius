"use client";
/** Small shared pieces for the redesigned pages. */
import { useState } from "react";
import type { Task } from "@/lib/types";
import { avatarColor, isAcceptingSubmissions, shortKey } from "@/lib/ui/tasks";
import { useT } from "@/lib/ui/copy";
import { isTeamAddress } from "@/lib/ui/team";

export function CopyCommand({ cmd, label }: { cmd: string; label?: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <div className="ui-code" aria-label={label}>
      <span className="ui-prompt">$</span>
      <span style={{ flex: 1, whiteSpace: "nowrap" }}>{cmd}</span>
      <button
        type="button"
        className="ui-btn ui-btn-secondary ui-btn-sm"
        onClick={async () => {
          try { await navigator.clipboard.writeText(cmd); setDone(true); setTimeout(() => setDone(false), 1600); } catch { /* ignore */ }
        }}
      >
        {done ? t({ en: "Copied", tr: "Kopyalandı" }) : t({ en: "Copy", tr: "Kopyala" })}
      </button>
    </div>
  );
}

export function Avatar({ seed, label, size = 36 }: { seed: string; label?: string; size?: number }) {
  const text = (label || seed || "?").replace(/^agent_/i, "").slice(0, 2).toUpperCase();
  return (
    <span className="ui-avatar" style={{ width: size, height: size, fontSize: size * 0.36, background: avatarColor(seed) }} aria-hidden>
      {text}
    </span>
  );
}

export function AgentChip({ id, name, size = 28 }: { id: string; name?: string; size?: number }) {
  const t = useT();
  const team = isTeamAddress(id);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      <Avatar seed={id} label={name || id.slice(1)} size={size} />
      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        {name && <span style={{ color: "var(--text-primary)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span className="ui-mono ui-muted" style={{ fontSize: name ? 12 : 13, color: name ? undefined : "var(--text-primary)" }}>{shortKey(id)}</span>
          {team && <span className="ui-badge" title={t({ en: "Run by the Cogladius team", tr: "Cogladius ekibine ait" })} style={{ height: 18, padding: "0 7px", fontSize: 10.5 }}>{t({ en: "Team", tr: "Ekip" })}</span>}
        </span>
      </span>
    </span>
  );
}

export function TaskStatusBadge({ task }: { task: Task }) {
  const t = useT();
  if (isAcceptingSubmissions(task)) return <span className="ui-badge ui-badge-live ui-badge-dot ui-pulse">{t({ en: "Live", tr: "Canlı" })}</span>;
  switch (task.status) {
    case "Settled":
    case "Resolved":
      return <span className="ui-badge ui-badge-gold">{t({ en: "Paid", tr: "Ödendi" })}</span>;
    case "Disputed":
      return <span className="ui-badge ui-badge-red">{t({ en: "In dispute", tr: "İtirazda" })}</span>;
    case "Refunded":
      return <span className="ui-badge">{t({ en: "Refunded", tr: "İade edildi" })}</span>;
    case "Expired":
    case "Stopped":
      return <span className="ui-badge">{t({ en: "Ended", tr: "Bitti" })}</span>;
    default:
      return (task.submissions?.length ?? 0) > 0
        ? <span className="ui-badge ui-badge-blue">{t({ en: "Settling", tr: "Sonuçlanıyor" })}</span>
        : <span className="ui-badge">{t({ en: "Ended", tr: "Bitti" })}</span>;
  }
}

export function Icon({ name, size = 20 }: { name: "shield" | "scale" | "bolt" | "trophy" | "code" | "coins" | "check" | "arrow" | "users" | "gavel"; size?: number }) {
  const p: Record<string, JSX.Element> = {
    shield: <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z" />,
    scale: <><path d="M12 3v18M5 7h14" /><path d="M5 7l-3 7a4 4 0 006 0L5 7zM19 7l-3 7a4 4 0 006 0l-3-7z" /></>,
    bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />,
    trophy: <><path d="M8 4h8v5a4 4 0 01-8 0V4z" /><path d="M16 6h3a3 3 0 01-3 4M8 6H5a3 3 0 003 4M12 13v4M8 21h8M9 17h6" /></>,
    code: <path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14" />,
    coins: <><ellipse cx="9" cy="7" rx="6" ry="3" /><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7" /><path d="M9 15v2c0 1.7 2.7 3 6 3s6-1.3 6-3v-5c0-1.6-2.4-2.9-5.5-3" /></>,
    check: <path d="M5 12l5 5 9-10" />,
    arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
    users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 7M21.5 20a6.5 6.5 0 00-4-6" /></>,
    gavel: <><path d="M14 4l6 6M11 7l6 6M12.5 5.5l-6 6 3 3 6-6M8 13l-5 5 2 2 5-5" /><path d="M13 21h8" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {p[name]}
    </svg>
  );
}

export function FeatureIcon({ name, tone = "accent" }: { name: Parameters<typeof Icon>[0]["name"]; tone?: "accent" | "gold" | "green" | "blue" }) {
  const c = { accent: ["var(--accent)", "var(--accent-dim)"], gold: ["var(--gold)", "var(--gold-dim)"], green: ["var(--green)", "var(--green-dim)"], blue: ["var(--blue)", "var(--blue-dim)"] }[tone];
  return (
    <span style={{ width: 44, height: 44, borderRadius: 12, display: "inline-flex", alignItems: "center", justifyContent: "center", color: c[0], background: c[1], flexShrink: 0 }}>
      <Icon name={name} size={22} />
    </span>
  );
}
