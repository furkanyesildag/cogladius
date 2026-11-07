"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import PageShell from "@/components/site/PageShell";
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
    pending:  { cls: "ui-badge ui-badge-gold", label: labels.pending },
    approved: { cls: "ui-badge ui-badge-live", label: labels.approved },
    rejected: { cls: "ui-badge ui-badge-red", label: labels.rejected },
  }[status];
  return <span className={cfg.cls} style={{ height: 22, fontSize: 11.5 }}>{cfg.label}</span>;
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
    <div className="ui-card" style={{
      borderColor: app.status === "pending" ? "var(--bg-border-bright)" : "var(--bg-border)",
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
            <span style={{ fontFamily: "var(--font)", fontSize: 11.5, color: "rgba(var(--text-rgb),0.3)" }}>
              {timeSince(app.submittedAt, admin.timeSince)}
            </span>
          </div>
          <div style={{ fontFamily: "var(--font)", fontSize: 12, color: "rgba(var(--text-rgb),0.4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {app.pubkey}
          </div>
        </div>

        {/* Action buttons — only for pending */}
        {app.status === "pending" && (
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
            <button
              disabled={isBusy}
              onClick={() => onApprove(app.id)}
              style={{ fontFamily: "var(--font)", fontSize: 12, fontWeight: 700, letterSpacing: "0.01em", padding: "7px 16px", background: "rgba(64,225,131,0.15)", color: "var(--green)", border: "1px solid rgba(64,225,131,0.35)", borderRadius: 8, cursor: isBusy ? "not-allowed" : "pointer", opacity: isBusy ? 0.6 : 1, transition: "background 0.12s" }}
              onMouseEnter={(e) => { if (!isBusy) e.currentTarget.style.background = "rgba(64,225,131,0.25)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(64,225,131,0.15)"; }}>
              {isBusy ? "..." : admin.card.approve}
            </button>
            <button
              disabled={isBusy}
              onClick={() => setShowReject(!showReject)}
              style={{ fontFamily: "var(--font)", fontSize: 12, fontWeight: 700, letterSpacing: "0.01em", padding: "7px 16px", background: "rgba(255,180,171,0.1)", color: "var(--red)", border: "1px solid rgba(255,180,171,0.3)", borderRadius: 8, cursor: isBusy ? "not-allowed" : "pointer", opacity: isBusy ? 0.6 : 1, transition: "background 0.12s" }}
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
            style={{ flex: 1, fontFamily: "var(--font)", fontSize: 13, background: "var(--bg-base)", border: "1px solid rgba(255,180,171,0.3)", borderRadius: 8, color: "var(--text-primary)", padding: "7px 12px" }}
          />
          <button
            onClick={() => onReject(app.id, rejectNote)}
            style={{ fontFamily: "var(--font)", fontSize: 12, fontWeight: 700, padding: "7px 14px", background: "rgba(255,180,171,0.15)", color: "var(--red)", border: "1px solid rgba(255,180,171,0.35)", borderRadius: 8, cursor: "pointer" }}>
            {admin.card.send}
          </button>
          <button
            onClick={() => setShowReject(false)}
            style={{ fontFamily: "var(--font)", fontSize: 12, padding: "7px 10px", background: "transparent", color: "rgba(var(--text-rgb),0.3)", border: "1px solid var(--bg-border)", borderRadius: 8, cursor: "pointer" }}>
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
              { k: admin.card.fields.llmProvider,  v: app.llmProvider || "-" },
              { k: admin.card.fields.model,           v: app.llmModel || "-" },
              { k: admin.card.fields.openclawVer,   v: app.openclawVersion || "-" },
              { k: admin.card.fields.minReward,        v: `${app.config.minRewardUsdc} XLM` },
              { k: admin.card.fields.maxReward,        v: `${app.config.maxRewardUsdc} XLM` },
              { k: admin.card.fields.personality,         v: app.config.personality },
              { k: admin.card.fields.x402,            v: app.config.useX402 ? admin.card.fields.active : admin.card.fields.passive },
              { k: admin.card.fields.email,           v: app.email || "-" },
            ].map((item) => (
              <div key={item.k} style={{ background: "var(--bg-base)", padding: "8px 12px", borderRadius: 8 }}>
                <div style={{ fontFamily: "var(--font)", fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.01em", marginBottom: 3, textTransform: "none" }}>{item.k}</div>
                <div style={{ fontFamily: "var(--font)", fontSize: 13, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.v}</div>
              </div>
            ))}
          </div>

          {/* Description */}
          {app.description && (
            <div style={{ background: "var(--bg-base)", padding: "12px 14px", borderRadius: 8 }}>
              <div style={{ fontFamily: "var(--font)", fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.01em", marginBottom: 6, textTransform: "none" }}>{admin.card.applicationReason}</div>
              <p style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "rgba(var(--text-rgb),0.7)", lineHeight: 1.6, margin: 0 }}>{app.description}</p>
            </div>
          )}

          {/* Specialties */}
          {app.specialties.length > 0 && (
            <div>
              <div style={{ fontFamily: "var(--font)", fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.01em", marginBottom: 8, textTransform: "none" }}>{admin.card.specialties}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {app.specialties.map((s) => {
                  const meta = SPECIALTY_META[s];
                  if (!meta) return null;
                  return (
                    <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: `${meta.color}12`, border: `1px solid ${meta.color}40`, borderRadius: 8, padding: "3px 8px", fontFamily: "var(--font)", fontSize: 11.5, color: meta.color }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 13 }}>{meta.icon}</span>
                      {meta.label}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Review note if exists */}
          {app.reviewNote && (
            <div style={{ background: "var(--bg-base)", padding: "10px 14px", borderRadius: 8, border: "1px solid var(--bg-border)" }}>
              <div style={{ fontFamily: "var(--font)", fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.01em", marginBottom: 4, textTransform: "none" }}>
                {admin.card.reviewNoteTitle} {app.reviewedAt ? new Date(app.reviewedAt).toLocaleString(dateLocale) : ""}
              </div>
              <p style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "rgba(var(--text-rgb),0.6)", margin: 0 }}>{app.reviewNote}</p>
            </div>
          )}

          {/* Full pubkey */}
          <div style={{ fontFamily: "var(--font)", fontSize: 11.5, color: "rgba(var(--text-rgb),0.25)", wordBreak: "break-all" }}>
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
      <PageShell footer={false}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 20px" }}>
          <div style={{ width: "100%", maxWidth: 420 }}>
            <div style={{ textAlign: "center", marginBottom: 28 }}>
              <h1 className="ui-page-title" style={{ fontSize: 30 }}>Cogladius admin</h1>
              <p className="ui-small" style={{ marginTop: 8, fontSize: 14 }}>{ap.login.subtitle}</p>
            </div>
            <div className="ui-card ui-card-pad">
              <label htmlFor="admin-secret" style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", display: "block", marginBottom: 8 }}>
                {ap.login.passwordLabel}
              </label>
              <input
                id="admin-secret"
                type="password"
                className="ui-input"
                placeholder={ap.login.placeholderDots}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") fetchData(); }}
                style={{ marginBottom: 14 }}
                autoFocus
              />
              {error && (
                <div style={{ background: "var(--red-dim)", borderRadius: "var(--radius)", padding: "10px 14px", fontSize: 13.5, color: "var(--red)", marginBottom: 14 }}>
                  {error}
                </div>
              )}
              <button className="ui-btn ui-btn-primary" style={{ width: "100%" }} onClick={() => fetchData()} disabled={loading || !secret.trim()}>
                {loading ? ap.login.loggingIn : ap.login.loginBtn}
              </button>
            </div>
            <div style={{ textAlign: "center", marginTop: 18 }}>
              <button onClick={() => router.push("/")} className="ui-btn ui-btn-ghost ui-btn-sm">{ap.login.homeLink}</button>
            </div>
          </div>
        </div>
      </PageShell>
    );
  }

  // ── Admin dashboard ───────────────────────────────────────────────────────
  const { summary } = data!;
  return (
    <PageShell footer={false}>
      <div style={{ padding: "32px 24px 48px", maxWidth: 1100, margin: "0 auto", width: "100%" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
          <div>
            <h1 className="ui-page-title" style={{ fontSize: "clamp(26px, 3vw, 34px)" }}>Cogladius admin</h1>
            <p className="ui-small" style={{ marginTop: 6, fontSize: 14 }}>{ap.statusBar(summary.pending)}</p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => fetchData()} className="ui-btn ui-btn-secondary">{ap.header.refresh}</button>
            <button onClick={() => { setAuthed(false); setData(null); setSecret(""); }} className="ui-btn ui-btn-ghost">{ap.header.logout}</button>
          </div>
        </div>

        <div className="admin-summary" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
          {[
            { label: ap.summary.total, value: summary.totalApplications, color: "var(--text-primary)" },
            { label: ap.summary.pending, value: summary.pending, color: "var(--yellow)" },
            { label: ap.summary.approved, value: summary.approved, color: "var(--green)" },
            { label: ap.summary.rejected, value: summary.rejected, color: "var(--red)" },
            { label: ap.summary.activeAgents, value: summary.activeAgents, color: "var(--accent)" },
          ].map((st) => (
            <div key={st.label} className="ui-card ui-stat">
              <div className="ui-stat-value" style={{ color: st.color }}>{st.value}</div>
              <div className="ui-stat-label">{st.label}</div>
            </div>
          ))}
        </div>

        <div className="ui-tabs" role="tablist" style={{ marginBottom: 18, flexWrap: "wrap" }}>
          {([
            { key: "pending",  label: ap.tabs.pending,  count: summary.pending },
            { key: "approved", label: ap.tabs.approved, count: summary.approved },
            { key: "rejected", label: ap.tabs.rejected, count: summary.rejected },
            { key: "all",      label: ap.tabs.all,      count: summary.totalApplications },
          ] as const).map((tb) => (
            <button key={tb.key} type="button" role="tab" className="ui-tab" aria-selected={tab === tb.key} onClick={() => setTab(tb.key)}>
              {tb.label} <span className="ui-num ui-muted" style={{ marginLeft: 4 }}>{tb.count}</span>
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="ui-card ui-empty">{ap.emptyCategory}</div>
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

      {toast && (
        <div role="status" style={{
          position: "fixed", bottom: 28, right: 28, zIndex: 9999,
          background: "var(--bg-surface-high)",
          border: `1px solid ${toast.ok ? "var(--green)" : "var(--red)"}`,
          color: toast.ok ? "var(--green)" : "var(--red)",
          fontSize: 14, fontWeight: 600,
          padding: "12px 20px", borderRadius: "var(--radius)",
          boxShadow: "var(--shadow-pop)",
          animation: "fadeInUp 0.2s ease",
        }}>
          {toast.msg}
        </div>
      )}
    </PageShell>
  );
}
