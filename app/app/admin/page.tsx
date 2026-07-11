"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { AgentApplication } from "@/lib/applicationStore";
import { SPECIALTY_META } from "@/lib/specialtyMeta";
import { useMessages, useLocale } from "@/lib/i18n";
import type { AppMessages } from "@/lib/i18n";

type AdminCopy = AppMessages["ui"]["adminPage"];

// ─────────────────────────────────────────────────────────────────────────────

function StatusBadge({
  status,
  labels,
}: {
  status: AgentApplication["status"];
  labels: AdminCopy["statusBadges"];
}) {
  const cfg = {
    pending:  { color: "var(--yellow)", bg: "rgba(255,214,76,0.1)",  border: "rgba(255,214,76,0.3)",  label: labels.pending },
    approved: { color: "var(--green)",  bg: "rgba(64,225,131,0.1)",  border: "rgba(64,225,131,0.3)",  label: labels.approved },
    rejected: { color: "var(--red)",    bg: "rgba(255,180,171,0.1)", border: "rgba(255,180,171,0.3)", label: labels.rejected },
  }[status];
  return (
    <span style={{ fontFamily: "var(--font)", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", padding: "3px 8px", borderRadius: 3, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>
      {cfg.label}
    </span>
  );
}

function timeSince(iso: string, rel: AdminCopy["timeSince"]) {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return rel.secondsAgo(secs);
  if (secs < 3600) return rel.minutesAgo(Math.floor(secs / 60));
  if (secs < 86400) return rel.hoursAgo(Math.floor(secs / 3600));
  return rel.daysAgo(Math.floor(secs / 86400));
}

// ─────────────────────────────────────────────────────────────────────────────

function ApplicationCard({
  app,
  onApprove,
  onReject,
  loading,
  admin,
  dateLocale,
}: {
  app: AgentApplication;
  onApprove: (id: string, note?: string) => void;
  onReject: (id: string, note: string) => void;
  loading: string | null;
  admin: AdminCopy;
  dateLocale: string;
}) {
  const [expanded, setExpanded]   = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [showReject, setShowReject] = useState(false);
  const isBusy = loading === app.id;

  return (
    <div style={{
      background: "var(--bg-surface-low)",
      border: `1px solid ${app.status === "pending" ? "var(--bg-border-bright)" : "var(--bg-border)"}`,
      borderLeft: `3px solid ${app.status === "pending" ? "var(--yellow)" : app.status === "approved" ? "var(--green)" : "var(--red)"}`,
      borderRadius: "0 8px 8px 0",
      marginBottom: 12,
      overflow: "hidden",
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", cursor: "pointer" }}
        onClick={() => setExpanded(!expanded)}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--font)", fontSize: 13, fontWeight: 800, color: "var(--text-primary)" }}>
              {app.name}
            </span>
            <StatusBadge status={app.status} labels={admin.statusBadges} />
            <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "rgba(var(--text-rgb),0.3)" }}>
              {timeSince(app.submittedAt, admin.timeSince)}
            </span>
          </div>
          <div style={{ fontFamily: "var(--font)", fontSize: 10, color: "rgba(var(--text-rgb),0.4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {app.pubkey}
          </div>
        </div>

        {/* Action buttons — only for pending */}
        {app.status === "pending" && (
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
            <button
              disabled={isBusy}
              onClick={() => onApprove(app.id)}
              style={{ fontFamily: "var(--font)", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", padding: "7px 16px", background: "rgba(64,225,131,0.15)", color: "var(--green)", border: "1px solid rgba(64,225,131,0.35)", borderRadius: 4, cursor: isBusy ? "not-allowed" : "pointer", opacity: isBusy ? 0.6 : 1, transition: "background 0.12s" }}
              onMouseEnter={(e) => { if (!isBusy) e.currentTarget.style.background = "rgba(64,225,131,0.25)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(64,225,131,0.15)"; }}>
              {isBusy ? "..." : admin.card.approve}
            </button>
            <button
              disabled={isBusy}
              onClick={() => setShowReject(!showReject)}
              style={{ fontFamily: "var(--font)", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", padding: "7px 16px", background: "rgba(255,180,171,0.1)", color: "var(--red)", border: "1px solid rgba(255,180,171,0.3)", borderRadius: 4, cursor: isBusy ? "not-allowed" : "pointer", opacity: isBusy ? 0.6 : 1, transition: "background 0.12s" }}
              onMouseEnter={(e) => { if (!isBusy) e.currentTarget.style.background = "rgba(255,180,171,0.18)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,180,171,0.1)"; }}>
              {admin.card.reject}
            </button>
          </div>
        )}

        <span className="material-symbols-outlined" style={{ fontSize: 16, color: "rgba(var(--text-rgb),0.2)", flexShrink: 0, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>expand_more</span>
      </div>

      {/* Reject note input */}
      {showReject && app.status === "pending" && (
        <div style={{ padding: "0 18px 14px", display: "flex", gap: 8, alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
          <input
            type="text"
            placeholder={admin.card.rejectPlaceholder}
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onReject(app.id, rejectNote); }}
            style={{ flex: 1, fontFamily: "var(--font)", fontSize: 11, background: "var(--bg-base)", border: "1px solid rgba(255,180,171,0.3)", borderRadius: 4, color: "var(--text-primary)", padding: "7px 12px" }}
          />
          <button
            onClick={() => onReject(app.id, rejectNote)}
            style={{ fontFamily: "var(--font)", fontSize: 10, fontWeight: 700, padding: "7px 14px", background: "rgba(255,180,171,0.15)", color: "var(--red)", border: "1px solid rgba(255,180,171,0.35)", borderRadius: 4, cursor: "pointer" }}>
            {admin.card.send}
          </button>
          <button
            onClick={() => setShowReject(false)}
            style={{ fontFamily: "var(--font)", fontSize: 10, padding: "7px 10px", background: "transparent", color: "rgba(var(--text-rgb),0.3)", border: "1px solid var(--bg-border)", borderRadius: 4, cursor: "pointer" }}>
            {admin.card.cancel}
          </button>
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div style={{ padding: "0 18px 18px", borderTop: "1px solid var(--bg-border)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Info grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
            {[
              { k: admin.card.fields.llmProvider,  v: app.llmProvider || "—" },
              { k: admin.card.fields.model,           v: app.llmModel || "—" },
              { k: admin.card.fields.openclawVer,   v: app.openclawVersion || "—" },
              { k: admin.card.fields.minReward,        v: `${app.config.minRewardUsdc} XLM` },
              { k: admin.card.fields.maxReward,        v: `${app.config.maxRewardUsdc} XLM` },
              { k: admin.card.fields.personality,         v: app.config.personality },
              { k: admin.card.fields.x402,            v: app.config.useX402 ? admin.card.fields.active : admin.card.fields.passive },
              { k: admin.card.fields.email,           v: app.email || "—" },
            ].map((item) => (
              <div key={item.k} style={{ background: "var(--bg-base)", padding: "8px 12px", borderRadius: 4 }}>
                <div style={{ fontFamily: "var(--font)", fontSize: 7, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 3, textTransform: "uppercase" }}>{item.k}</div>
                <div style={{ fontFamily: "var(--font)", fontSize: 11, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.v}</div>
              </div>
            ))}
          </div>

          {/* Description */}
          {app.description && (
            <div style={{ background: "var(--bg-base)", padding: "12px 14px", borderRadius: 4 }}>
              <div style={{ fontFamily: "var(--font)", fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 6, textTransform: "uppercase" }}>{admin.card.applicationReason}</div>
              <p style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "rgba(var(--text-rgb),0.7)", lineHeight: 1.6, margin: 0 }}>{app.description}</p>
            </div>
          )}

          {/* Specialties */}
          {app.specialties.length > 0 && (
            <div>
              <div style={{ fontFamily: "var(--font)", fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 8, textTransform: "uppercase" }}>{admin.card.specialties}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {app.specialties.map((s) => {
                  const meta = SPECIALTY_META[s];
                  if (!meta) return null;
                  return (
                    <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: `${meta.color}12`, border: `1px solid ${meta.color}40`, borderRadius: 4, padding: "3px 8px", fontFamily: "var(--font)", fontSize: 9, color: meta.color }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 11 }}>{meta.icon}</span>
                      {meta.label}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Review note if exists */}
          {app.reviewNote && (
            <div style={{ background: "var(--bg-base)", padding: "10px 14px", borderRadius: 4, border: "1px solid var(--bg-border)" }}>
              <div style={{ fontFamily: "var(--font)", fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 4, textTransform: "uppercase" }}>
                {admin.card.reviewNoteTitle} {app.reviewedAt ? new Date(app.reviewedAt).toLocaleString(dateLocale) : ""}
              </div>
              <p style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "rgba(var(--text-rgb),0.6)", margin: 0 }}>{app.reviewNote}</p>
            </div>
          )}

          {/* Full pubkey */}
          <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "rgba(var(--text-rgb),0.25)", wordBreak: "break-all" }}>
            {admin.card.pubkeyLabel} {app.pubkey}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const router = useRouter();
  const { locale } = useLocale();
  const msgs = useMessages();
  const ap = msgs.ui.adminPage;
  const dateLocale = locale === "tr" ? "tr-TR" : "en-US";
  const [secret, setSecret]           = useState("");
  const [authed, setAuthed]           = useState(false);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [data, setData]               = useState<{
    summary: { totalApplications: number; pending: number; approved: number; rejected: number; activeAgents: number };
    applications: AgentApplication[];
  } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast]             = useState<{ msg: string; ok: boolean } | null>(null);
  const [tab, setTab]                 = useState<"pending" | "approved" | "rejected" | "all">("pending");

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }

  const fetchData = useCallback(async (sk = secret) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/agents", {
        headers: { Authorization: `Bearer ${sk}` },
      });
      if (res.status === 401) { setError(msgs.ui.adminPage.errors.invalidPassword); setLoading(false); return; }
      const d = await res.json();
      if (!d.success) { setError(d.error || msgs.ui.adminPage.errors.fetchFailed); } else {
        setData(d);
        setAuthed(true);
      }
    } catch {
      setError(msgs.ui.adminPage.errors.connectionError);
    } finally {
      setLoading(false);
    }
  }, [secret, msgs]);

  async function handleApprove(id: string, note?: string) {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/admin/agents/${id}/approve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reviewNote: note }),
      });
      const d = await res.json();
      if (d.success) { showToast(msgs.ui.adminPage.toast.approved(d.name)); fetchData(); }
      else showToast(d.error || msgs.ui.adminPage.toast.error, false);
    } catch {
      showToast(msgs.ui.adminPage.toast.connectionError, false);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReject(id: string, note: string) {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/admin/agents/${id}/reject`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reviewNote: note }),
      });
      const d = await res.json();
      if (d.success) { showToast(msgs.ui.adminPage.toast.rejected, true); fetchData(); }
      else showToast(d.error || msgs.ui.adminPage.toast.error, false);
    } catch {
      showToast(msgs.ui.adminPage.toast.connectionError, false);
    } finally {
      setActionLoading(null);
    }
  }

  const filtered = (data?.applications ?? []).filter((a) => {
    if (tab === "all") return true;
    return a.status === tab;
  });

  // ── Login screen ──────────────────────────────────────────────────────────
  if (!authed) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-base)" }}>
        <div style={{ width: "100%", maxWidth: 400, padding: "0 20px" }}>
          {/* Logo */}
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <img src="/logo.svg" alt="Cogladius" style={{ width: 52, height: 52, objectFit: "contain", display: "block", margin: "0 auto 12px" }} />
            <div style={{ fontFamily: "var(--font)", fontSize: 11, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.15em", textTransform: "uppercase" }}>{ap.login.title}</div>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "rgba(var(--text-rgb),0.35)", marginTop: 5 }}>{ap.login.subtitle}</div>
          </div>

          <div style={{ background: "var(--bg-surface-low)", border: "1px solid var(--bg-border)", borderRadius: 8, padding: "28px 24px" }}>
            <label style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
              {ap.login.passwordLabel}
            </label>
            <input
              type="password"
              placeholder={ap.login.placeholderDots}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") fetchData(); }}
              style={{ width: "100%", fontFamily: "var(--font)", fontSize: 13, marginBottom: 14, boxSizing: "border-box" }}
              autoFocus
            />
            {error && (
              <div style={{ background: "var(--red-dim)", border: "1px solid rgba(255,180,171,0.3)", borderRadius: 4, padding: "10px 14px", fontFamily: "var(--font)", fontSize: 11, color: "var(--red)", marginBottom: 14 }}>
                ⚠ {error}
              </div>
            )}
            <button
              className="btn-primary"
              style={{ width: "100%", justifyContent: "center" }}
              onClick={() => fetchData()}
              disabled={loading || !secret.trim()}>
              {loading ? ap.login.loggingIn : ap.login.loginBtn}
            </button>
          </div>

          <div style={{ textAlign: "center", marginTop: 20 }}>
            <button onClick={() => router.push("/")} style={{ background: "transparent", border: "none", cursor: "pointer", fontFamily: "var(--font)", fontSize: 9, color: "rgba(var(--text-rgb),0.25)", letterSpacing: "0.06em" }}>
              {ap.login.homeLink}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Admin dashboard ───────────────────────────────────────────────────────
  const { summary } = data!;
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)", display: "flex", flexDirection: "column" }}>

      {/* Header */}
      <header style={{ height: 52, background: "var(--bg-surface-low)", borderBottom: "1px solid var(--bg-border)", display: "flex", alignItems: "center", padding: "0 24px", gap: 12, flexShrink: 0, position: "sticky", top: 0, zIndex: 100 }}>
        <img src="/logo.svg" alt="" style={{ width: 32, height: 32, objectFit: "contain", cursor: "pointer" }} onClick={() => router.push("/")} />
        <span style={{ fontFamily: "var(--font)", fontSize: 11, fontWeight: 800, color: "var(--accent)", letterSpacing: "0.12em", textTransform: "uppercase" }}>{ap.header.panelTitle}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center" }}>
          <button onClick={() => fetchData()} className="btn-ghost" style={{ gap: 5, fontSize: 9 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>refresh</span>
            {ap.header.refresh}
          </button>
          <button onClick={() => { setAuthed(false); setData(null); setSecret(""); }} style={{ background: "transparent", border: "none", cursor: "pointer", fontFamily: "var(--font)", fontSize: 9, color: "rgba(var(--text-rgb),0.3)", letterSpacing: "0.06em" }}>
            {ap.header.logout}
          </button>
        </div>
      </header>

      <div style={{ flex: 1, padding: "28px 32px", maxWidth: 1100, margin: "0 auto", width: "100%" }}>

        {/* Summary cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 28 }}>
          {[
            { label: ap.summary.total, value: summary.totalApplications, color: "var(--text-primary)", border: "var(--bg-border-bright)" },
            { label: ap.summary.pending,      value: summary.pending,            color: "var(--yellow)",       border: "rgba(255,214,76,0.4)" },
            { label: ap.summary.approved,      value: summary.approved,           color: "var(--green)",        border: "rgba(64,225,131,0.4)" },
            { label: ap.summary.rejected,    value: summary.rejected,           color: "var(--red)",          border: "rgba(255,180,171,0.4)" },
            { label: ap.summary.activeAgents,   value: summary.activeAgents,       color: "var(--accent)",       border: "var(--accent-border)" },
          ].map((s) => (
            <div key={s.label} style={{ background: "var(--bg-surface-low)", border: `1px solid ${s.border}`, borderRadius: 6, padding: "16px 18px" }}>
              <div style={{ fontFamily: "var(--font)", fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>{s.label}</div>
              <div style={{ fontFamily: "var(--font)", fontSize: 32, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 18 }}>
          {([
            { key: "pending",  label: ap.tabs.pending,  count: summary.pending },
            { key: "approved", label: ap.tabs.approved, count: summary.approved },
            { key: "rejected", label: ap.tabs.rejected, count: summary.rejected },
            { key: "all",      label: ap.tabs.all,        count: summary.totalApplications },
          ] as const).map((t) => (
            <button key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                fontFamily: "var(--font)", fontSize: 10, fontWeight: 700, letterSpacing: "0.07em",
                padding: "8px 16px", borderRadius: 4, cursor: "pointer", border: "none",
                background: tab === t.key ? "var(--accent)" : "var(--bg-surface-low)",
                color: tab === t.key ? "var(--on-accent)" : "rgba(var(--text-rgb),0.5)",
                transition: "all 0.12s",
              }}>
              {t.label} ({t.count})
            </button>
          ))}
        </div>

        {/* Applications list */}
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", fontFamily: "var(--font)", fontSize: 12, color: "rgba(var(--text-rgb),0.2)" }}>
            {ap.emptyCategory}
          </div>
        ) : (
          <div>
            {filtered.map((app) => (
              <ApplicationCard
                key={app.id}
                app={app}
                onApprove={handleApprove}
                onReject={handleReject}
                loading={actionLoading}
                admin={ap}
                dateLocale={dateLocale}
              />
            ))}
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="kl-statusbar">
        <span>{ap.statusBar(summary.pending)}</span>
        <span>{ap.statusBarVersion}</span>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 40, right: 28, zIndex: 9999,
          background: toast.ok ? "rgba(64,225,131,0.15)" : "rgba(255,180,171,0.15)",
          border: `1px solid ${toast.ok ? "rgba(64,225,131,0.4)" : "rgba(255,180,171,0.4)"}`,
          color: toast.ok ? "var(--green)" : "var(--red)",
          fontFamily: "var(--font)", fontSize: 11, fontWeight: 700,
          padding: "12px 20px", borderRadius: 6,
          boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
          animation: "fadeInUp 0.2s ease",
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
