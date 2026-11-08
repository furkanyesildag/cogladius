"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useWallet } from "@/lib/useWallet";
import PageShell from "@/components/site/PageShell";
import s from "./projects.module.css";
import { useMessages, useLocale } from "@/lib/i18n";
import type {
  Project, OrchestratorBreakdown, AgentSpecialty,
} from "@/lib/types";
import { SPECIALTY_META, specialtyLabel } from "@/lib/specialtyMeta";
import { useT } from "@/lib/ui/copy";

// ── Types ────────────────────────────────────────────────────────────────────

interface ChatMsg {
  role: "assistant" | "user";
  content: string;
  breakdown?: OrchestratorBreakdown[];
  ts: string;
}

/** Local persistence for NEXUS (modal drafts, sidebar selection, per-project chat cache). */
const NEXUS_LS_PREFIX = "cogladius:nexus:v1";

interface NexusModalDraftStored {
  title: string;
  description: string;
  budget: number;
  deadlineIdx: number;
}

interface NexusChatStored {
  v: 1;
  messages: ChatMsg[];
  pendingBreakdown: OrchestratorBreakdown[] | null;
  editableBreakdown: OrchestratorBreakdown[] | null;
  showPayment: boolean;
}

/** Deadline options for new-project modal (days). Used for draft persistence indexing. */
const DEADLINE_VALUES = [3, 7, 14, 30];

function normalizeNexusPoster(posterPubkey: string) {
  if (!posterPubkey || posterPubkey === "anonymous" || posterPubkey.startsWith("Demo_")) return "anonymous";
  return posterPubkey;
}

function nexusModalDraftKey(poster: string) {
  return `${NEXUS_LS_PREFIX}:modal-draft:${normalizeNexusPoster(poster)}`;
}

function nexusLastProjectKey(poster: string) {
  return `${NEXUS_LS_PREFIX}:last-project:${normalizeNexusPoster(poster)}`;
}

function nexusChatKey(projectId: number) {
  return `${NEXUS_LS_PREFIX}:chat:${projectId}`;
}

function parseModalDraftStored(raw: string | null): NexusModalDraftStored | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<NexusModalDraftStored>;
    if (typeof d.title !== "string" || typeof d.description !== "string") return null;
    if (typeof d.budget !== "number" || !Number.isFinite(d.budget)) return null;
    if (typeof d.deadlineIdx !== "number" || !Number.isFinite(d.deadlineIdx)) return null;
    return {
      title: d.title,
      description: d.description,
      budget: d.budget,
      deadlineIdx: Math.max(0, Math.min(DEADLINE_VALUES.length - 1, Math.floor(d.deadlineIdx))),
    };
  } catch {
    return null;
  }
}

function readNexusChat(projectId: number): NexusChatStored | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(nexusChatKey(projectId));
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<NexusChatStored & { messages?: ChatMsg[] }>;
    const ver = o.v as unknown;
    if (ver !== undefined && ver !== 1) return null;
    if (!Array.isArray(o.messages) || o.messages.length === 0) return null;
    return {
      v: 1,
      messages: o.messages as ChatMsg[],
      pendingBreakdown: Array.isArray(o.pendingBreakdown) ? (o.pendingBreakdown as OrchestratorBreakdown[]) : null,
      editableBreakdown: Array.isArray(o.editableBreakdown) ? (o.editableBreakdown as OrchestratorBreakdown[]) : null,
      showPayment: Boolean(o.showPayment),
    };
  } catch {
    return null;
  }
}

function writeNexusChat(projectId: number, payload: NexusChatStored) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(nexusChatKey(projectId), JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

async function postOrchestratorChatApi(
  projectId: number,
  history: { role: string; content: string }[],
  userMessage: string,
  locale: string,
): Promise<{ success: false; error: string } | { success: true; reply: string; breakdown?: OrchestratorBreakdown[] }> {
  const r = await fetch(`/api/projects/${projectId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: history, userMessage, locale }),
  });
  const data = await r.json();
  if (!data.success) return { success: false, error: data.error ?? (locale === "tr" ? "Bir hata oluştu" : "Something went wrong") };
  return { success: true, reply: data.reply as string, breakdown: data.breakdown as OrchestratorBreakdown[] | undefined };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function pad(n: number) { return String(n).padStart(2, "0"); }
function nowStr() { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

function StatusBadge({ status }: { status: Project["status"] }) {
  const { locale } = useLocale();
  const tr = locale === "tr";
  const map: Record<string, [string, string, string]> = {
    draft:       ["Draft", "Taslak", "ui-badge"],
    analyzing:   ["Analyzing", "Analiz", "ui-badge ui-badge-gold ui-badge-dot ui-pulse"],
    squadFormed: ["Plan ready", "Plan hazır", "ui-badge ui-badge-blue"],
    active:      ["Active", "Aktif", "ui-badge ui-badge-live ui-badge-dot"],
    completed:   ["Completed", "Tamamlandı", "ui-badge ui-badge-accent"],
  };
  const [en, trl, cls] = map[status] ?? ["?", "?", "ui-badge"];
  return <span className={cls} style={{ height: 22, fontSize: 11.5 }}>{tr ? trl : en}</span>;
}

// ── Markdown-lite renderer (reuse from other pages) ──────────────────────────
function RenderLine({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**")
          ? <strong key={i} style={{ color: "var(--text-primary)", fontWeight: 700 }}>{p.replace(/\*\*/g, "")}</strong>
          : <span key={i}>{p}</span>
      )}
    </>
  );
}

function AgentMessageBody({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div style={{ fontFamily: "var(--font-body)", fontSize: 14.5, color: "var(--text-secondary)", lineHeight: 1.7 }}>
      {text.split("\n").map((line, i) => {
        if (!line.trim()) return <div key={i} style={{ height: 6 }} />;
        if (/^#{1,3}\s/.test(line)) {
          const lvl = (line.match(/^#+/) ?? [""])[0].length;
          return <div key={i} style={{ fontFamily: "var(--font-head)", fontSize: lvl === 1 ? 17 : 15, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.01em", marginTop: 14, marginBottom: 6, borderBottom: lvl === 1 ? "1px solid var(--bg-border)" : "none", paddingBottom: lvl === 1 ? 6 : 0 }}>{line.replace(/^#+\s/, "")}</div>;
        }
        if (/^═+$/.test(line.trim())) return <div key={i} style={{ height: 1, background: "var(--bg-border)", margin: "8px 0" }} />;
        const listM = line.match(/^([•\-\*]|\d+\.)\s+(.*)/);
        if (listM) {
          const isNum = /^\d/.test(listM[1]);
          return (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 4 }}>
              <span style={{ color: "var(--accent)", fontWeight: 700, fontSize: 13, flexShrink: 0, marginTop: 2 }}>{isNum ? listM[1] : "▸"}</span>
              <span><RenderLine text={listM[2]} /></span>
            </div>
          );
        }
        return <p key={i} style={{ margin: "0 0 4px" }}><RenderLine text={line} /></p>;
      })}
    </div>
  );
}

// ── Breakdown proposal card ───────────────────────────────────────────────────
function BreakdownCard({
  breakdown, totalBudget, editable, onChange,
}: {
  breakdown: OrchestratorBreakdown[];
  totalBudget: number;
  editable?: boolean;
  onChange?: (b: OrchestratorBreakdown[]) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  function adjust(idx: number, delta: number) {
    if (!onChange) return;
    const next = breakdown.map((b) => ({ ...b }));
    next[idx].workloadPct = Math.max(5, Math.min(90, next[idx].workloadPct + delta));
    const sum = next.reduce((s, b) => s + b.workloadPct, 0);
    const diff = 100 - sum;
    const others = next.filter((_, i) => i !== idx);
    if (others.length > 0) {
      const step = Math.round(diff / others.length);
      let rem = diff;
      next.forEach((b, i) => {
        if (i !== idx) {
          const adj = i === next.findIndex((_, j) => j !== idx && j >= next.length - 1) ? rem : step;
          b.workloadPct = Math.max(5, b.workloadPct + adj);
          rem -= step;
        }
      });
    }
    next.forEach((b) => { b.budgetUsdc = parseFloat(((totalBudget * b.workloadPct) / 100).toFixed(4)); });
    onChange(next);
  }

  return (
    <div style={{ border: "1px solid var(--accent-border)", borderRadius: 14, overflow: "hidden", marginTop: 14 }}>
      <div style={{ padding: "10px 14px", background: "var(--accent-dim)", display: "flex", alignItems: "center", gap: 8 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 15, color: "var(--accent)" }}>hub</span>
        <span style={{ fontFamily: "var(--font)", fontSize: 14, fontWeight: 700, color: "var(--accent)" }}>{t({ en: "Project plan", tr: "Proje planı" })} · {totalBudget} XLM</span>
      </div>
      {breakdown.map((b, i) => {
        const meta = SPECIALTY_META[b.specialty as AgentSpecialty];
        if (!meta) return null;
        return (
          <div key={b.specialty} style={{ padding: "12px 14px", borderTop: i > 0 ? "1px solid var(--bg-border)" : "none", background: i % 2 === 0 ? "var(--bg-base)" : "transparent" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14, color: meta.color }}>{meta.icon}</span>
              <span style={{ fontFamily: "var(--font)", fontSize: 14, fontWeight: 700, color: meta.color, flex: 1 }}>{specialtyLabel(b.specialty, locale)}</span>
              <span style={{ fontFamily: "var(--font)", fontSize: 13, fontWeight: 800, color: "var(--accent)" }}>{b.budgetUsdc.toFixed(3)} XLM</span>
            </div>
            {/* Progress bar + pct controls */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{ flex: 1, height: 3, background: "var(--bg-border)", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ width: `${b.workloadPct}%`, height: "100%", background: meta.color, transition: "width 0.3s" }} />
              </div>
              {editable ? (
                <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <button type="button" onClick={() => adjust(i, -5)} style={{ width: 18, height: 18, background: "var(--bg-surface-high)", border: "1px solid var(--bg-border)", borderRadius: 8, cursor: "pointer", color: "var(--text-muted)", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
                  <span style={{ fontFamily: "var(--font)", fontSize: 12, fontWeight: 700, color: "var(--text-primary)", minWidth: 28, textAlign: "center" }}>{b.workloadPct}%</span>
                  <button type="button" onClick={() => adjust(i, 5)} style={{ width: 18, height: 18, background: "var(--bg-surface-high)", border: "1px solid var(--bg-border)", borderRadius: 8, cursor: "pointer", color: "var(--text-muted)", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                </div>
              ) : (
                <span style={{ fontFamily: "var(--font)", fontSize: 12, color: "var(--text-muted)" }}>{b.workloadPct}%</span>
              )}
            </div>
            {/* Reasoning */}
            {b.reasoning && <p style={{ fontFamily: "var(--font-body)", fontSize: 13.5, color: "var(--text-muted)", margin: "0 0 8px", lineHeight: 1.55 }}>{b.reasoning}</p>}
            {/* Technologies */}
            {(b as any).technologies?.length > 0 && (
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {(b as any).technologies.map((t: string) => (
                  <span key={t} style={{ fontFamily: "var(--font)", fontSize: 11, color: meta.color, background: `${meta.color}12`, border: `1px solid ${meta.color}40`, borderRadius: 8, padding: "1px 6px" }}>{t}</span>
                ))}
              </div>
            )}
            {/* Agents */}
            {b.agents?.length > 0 && (
              <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
                {b.agents.slice(0, 2).map((a) => (
                  <div key={a.pubkey} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--bg-surface-high)", border: "1px solid var(--bg-border)", borderRadius: 8, padding: "3px 8px" }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: meta.color, display: "inline-block" }} />
                    <span style={{ fontFamily: "var(--font)", fontSize: 11.5, color: "var(--text-secondary)" }}>{a.name}</span>
                    <span style={{ fontFamily: "var(--font)", fontSize: 11, color: "rgba(var(--text-rgb),0.3)" }}>◈ {a.avgScore}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── OpenAI Key Modal ──────────────────────────────────────────────────────────
function ApiKeyModal({ onSave, onSkip }: { onSave: (key: string) => void; onSkip: () => void }) {
  const [key, setKey] = useState("");
  const t = useT();
  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: 440 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 20, color: "var(--accent)" }}>key</span>
          <span style={{ fontFamily: "var(--font-head)", fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>{t({ en: "AI engine key", tr: "Yapay zekâ anahtarı" })}</span>
        </div>
        <p style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7, marginBottom: 16 }}>
          {t({ en: "Enter the AI engine key for the orchestrator agent. It stays in your browser and is never sent to the server.", tr: "NEXUS için yapay zekâ anahtarını gir. Anahtar sadece tarayıcında kalır, sunucuya gönderilmez." })}
        </p>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-..."
          autoFocus
          onKeyDown={(e) => { if (e.key === "Enter" && key.startsWith("sk-")) onSave(key.trim()); }}
          style={{ fontFamily: "var(--font)", fontSize: 12, marginBottom: 12 }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onSkip} className="btn-ghost" style={{ flex: 1, justifyContent: "center", fontSize: 12 }}>{t({ en: "Not now", tr: "Şimdi değil" })}</button>
          <button
            disabled={!key.startsWith("sk-")}
            onClick={() => onSave(key.trim())}
            className="btn-primary"
            style={{ flex: 2, justifyContent: "center", opacity: key.startsWith("sk-") ? 1 : 0.4 }}
          >
            {t({ en: "Save and start", tr: "Kaydet ve başlat" })}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Payment Confirmation Modal ────────────────────────────────────────────────
function PaymentModal({
  breakdown, totalBudget, onConfirm, onCancel, loading,
}: {
  breakdown: OrchestratorBreakdown[];
  totalBudget: number;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const n = useMessages().nexusSection;
  const common = useMessages().common;
  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: 520 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 20, color: "var(--green)" }}>payments</span>
          <span style={{ fontFamily: "var(--font-head)", fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>{n.paymentTitle}</span>
        </div>
        <p style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7, marginBottom: 16 }}>
          {n.paymentDesc(totalBudget)}
        </p>
        <BreakdownCard breakdown={breakdown} totalBudget={totalBudget} editable={false} />
        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          <button onClick={onCancel} className="btn-ghost" style={{ flex: 1, justifyContent: "center" }}>{common.back.replace("← ", "")}</button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="btn-green"
            style={{ flex: 2, justifyContent: "center", opacity: loading ? 0.6 : 1 }}
          >
            {loading
              ? <><span className="material-symbols-outlined" style={{ fontSize: 14, animation: "spin 1s linear infinite" }}>sync</span>{n.confirmLoading}</>
              : <><span className="material-symbols-outlined" style={{ fontSize: 14 }}>check_circle</span>{n.confirmLock(totalBudget)}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PostProjectModal ──────────────────────────────────────────────────────────

function PostProjectModal({
  onClose, onCreated, posterPubkey,
}: {
  onClose: () => void;
  onCreated: (project: Project) => void;
  posterPubkey: string;
}) {
  const m = useMessages();
  const n = m.nexusSection;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [budget, setBudget] = useState(1.0);
  const [deadlineIdx, setDeadlineIdx] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; desc?: string }>({});
  const [draftHydrated, setDraftHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDraftHydrated(false);
    try {
      const d = parseModalDraftStored(localStorage.getItem(nexusModalDraftKey(posterPubkey)));
      if (d) {
        setTitle(d.title);
        setDescription(d.description);
        setBudget(Number.isFinite(d.budget) && d.budget >= 0.01 ? d.budget : 1);
        setDeadlineIdx(Math.max(0, Math.min(DEADLINE_VALUES.length - 1, d.deadlineIdx)));
      }
    } catch {
      /* ignore */
    }
    const id = window.setTimeout(() => {
      if (!cancelled) setDraftHydrated(true);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [posterPubkey]);

  useEffect(() => {
    if (!draftHydrated) return;
    const timer = window.setTimeout(() => {
      try {
        if (!title.trim() && !description.trim()) {
          localStorage.removeItem(nexusModalDraftKey(posterPubkey));
          return;
        }
        const payload: NexusModalDraftStored = { title, description, budget, deadlineIdx };
        localStorage.setItem(nexusModalDraftKey(posterPubkey), JSON.stringify(payload));
      } catch {
        /* ignore */
      }
    }, 380);
    return () => window.clearTimeout(timer);
  }, [draftHydrated, posterPubkey, title, description, budget, deadlineIdx]);

  const deadlineDays = DEADLINE_VALUES[deadlineIdx];

  function clearTitleErr() {
    setFieldErrors((f) => {
      if (!f.title) return f;
      const { title: _omit, ...r } = f;
      return r;
    });
  }
  function clearDescErr() {
    setFieldErrors((f) => {
      if (!f.desc) return f;
      const { desc: _omit, ...r } = f;
      return r;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const nextErr: { title?: string; desc?: string } = {};
    if (title.trim().length < 3) nextErr.title = n.modalValidationTitle;
    if (description.trim().length < 20) nextErr.desc = n.modalValidationDesc;
    if (Object.keys(nextErr).length > 0) {
      setFieldErrors(nextErr);
      return;
    }
    setFieldErrors({});

    setLoading(true);
    try {
      const r = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poster: posterPubkey, title, description, totalBudgetUsdc: budget, deadlineDays }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      localStorage.removeItem(nexusModalDraftKey(posterPubkey));
      onCreated(d.project);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const descWarn = description.length > 1600;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="nexus-modal-shell" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="nexus-modal-title" aria-modal="true">

        <header className="nexus-modal-header">
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "var(--accent-dim)", border: "1px solid var(--accent-border)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 0 28px color-mix(in srgb, var(--accent) 22%, transparent)" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 22, color: "var(--accent)" }}>hub</span>
              </div>
              <div>
                <h2 id="nexus-modal-title" style={{ margin: 0, fontFamily: "var(--font-head)", fontSize: "clamp(1.05rem, 2.8vw, 1.35rem)", fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.02em", lineHeight: 1.2 }}>
                  {n.modalTitle}
                </h2>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "var(--font)", fontSize: 11.5, color: "var(--accent)", fontWeight: 800, letterSpacing: "0.01em", textTransform: "none" }}>NEXUS</span>
                  <span style={{ width: 4, height: 4, borderRadius: "50%", background: "rgba(var(--text-rgb),0.2)" }} />
                  <span style={{ fontFamily: "var(--font)", fontSize: 11.5, color: "rgba(var(--text-rgb),0.38)", letterSpacing: "0.01em", textTransform: "none" }}>{n.step1} · {n.step2} · {n.step3}</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(var(--white-rgb),0.04)", border: "1px solid var(--bg-border)", borderRadius: 10, cursor: "pointer", color: "var(--text-muted)", flexShrink: 0, transition: "background 0.15s ease, color 0.15s ease" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-surface-high)"; e.currentTarget.style.color = "var(--text-primary)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(var(--white-rgb),0.04)"; e.currentTarget.style.color = "var(--text-muted)"; }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
            </button>
          </div>
        </header>

        <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "22px 26px 10px", maxHeight: "min(68vh, 560px)", overflowY: "auto" }}>

            <div className="nexus-modal-section-label">
              <span className="nexus-modal-step">1</span>
              {n.modalSectionBrief}
            </div>

            <div style={{ marginBottom: 18 }}>
              <label className="nexus-modal-field-label" htmlFor="nexus-proj-title">{n.modalTitleLabel}</label>
              <div className={`nexus-modal-input-wrap ${fieldErrors.title ? "nexus-modal-input-error" : ""}`}>
                <input
                  id="nexus-proj-title"
                  type="text"
                  value={title}
                  onChange={(e) => { setTitle(e.target.value); clearTitleErr(); }}
                  placeholder={n.modalTitlePlaceholder}
                  maxLength={100}
                  autoFocus
                  style={{ fontSize: 14, fontWeight: 600, padding: "12px 14px" }}
                />
              </div>
              {fieldErrors.title && (
                <p style={{ margin: "8px 0 0", fontFamily: "var(--font)", fontSize: 12, color: "var(--red)", display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>error</span>
                  {fieldErrors.title}
                </p>
              )}
            </div>

            <div style={{ marginBottom: 22 }}>
              <label className="nexus-modal-field-label" htmlFor="nexus-proj-desc">{n.modalDescLabel}</label>
              <div className={`nexus-modal-input-wrap ${fieldErrors.desc ? "nexus-modal-input-error" : ""}`} style={{ position: "relative" }}>
                <span className={`nexus-modal-char-pill ${descWarn ? "nexus-modal-char-pill_warn" : ""}`}>
                  {description.length}/2000
                </span>
                <textarea
                  id="nexus-proj-desc"
                  value={description}
                  onChange={(e) => { setDescription(e.target.value); clearDescErr(); }}
                  placeholder={n.modalDescPlaceholder}
                  maxLength={2000}
                  style={{ minHeight: 168, padding: "14px 14px 40px", fontFamily: "var(--font-body)", fontSize: 13, lineHeight: 1.75 }}
                />
              </div>
              <p style={{ margin: "10px 0 0", fontFamily: "var(--font-body)", fontSize: 13, color: "rgba(var(--text-rgb),0.42)", lineHeight: 1.65 }}>
                {n.modalDescHelper}
              </p>
              {fieldErrors.desc && (
                <p style={{ margin: "8px 0 0", fontFamily: "var(--font)", fontSize: 12, color: "var(--red)", display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>error</span>
                  {fieldErrors.desc}
                </p>
              )}
            </div>

            <div className="nexus-modal-section-label" style={{ marginTop: 4 }}>
              <span className="nexus-modal-step">2</span>
              {n.modalSectionParams}
            </div>

            <div className="nexus-params-card">
              <div>
                <label className="nexus-modal-field-label" htmlFor="nexus-budget" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 13, color: "var(--accent)", opacity: 0.85 }}>account_balance_wallet</span>
                  {n.modalBudgetLabel}
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    id="nexus-budget"
                    type="number"
                    value={Number.isFinite(budget) ? budget : 0}
                    onChange={(e) => setBudget(parseFloat(e.target.value) || 0)}
                    min={0.01}
                    max={1000}
                    step={0.1}
                    style={{ fontFamily: "var(--font)", fontSize: 24, fontWeight: 900, color: "var(--accent)", padding: "12px 46px 12px 14px", borderRadius: 10 }}
                  />
                  <span style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", fontFamily: "var(--font)", fontSize: 13, fontWeight: 800, color: "var(--accent)", opacity: 0.55 }}>XLM</span>
                </div>
                <p style={{ margin: "8px 0 0", fontFamily: "var(--font-body)", fontSize: 12, color: "rgba(var(--text-rgb),0.36)", lineHeight: 1.5 }}>{n.modalBudgetSub}</p>
              </div>

              <div>
                <label className="nexus-modal-field-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 13, color: "var(--accent)", opacity: 0.85 }}>schedule</span>
                  {n.modalDurationLabel}
                </label>
                <div className="nexus-duration-row" role="group" aria-label={n.modalDurationLabel}>
                  {DEADLINE_VALUES.map((v, idx) => (
                    <button
                      key={v}
                      type="button"
                      data-active={deadlineIdx === idx}
                      className="nexus-duration-pill"
                      onClick={() => setDeadlineIdx(idx)}
                    >
                      {n.modalDeadlines[idx]}
                    </button>
                  ))}
                </div>
                <p style={{ margin: "8px 0 0", fontFamily: "var(--font-body)", fontSize: 12, color: "rgba(var(--text-rgb),0.36)", lineHeight: 1.5 }}>{n.modalDurationSub}</p>
              </div>
            </div>

            <div className="nexus-info-rail" style={{ marginTop: 18 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--accent)", flexShrink: 0 }}>bolt</span>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "rgba(var(--text-rgb),0.78)", lineHeight: 1.65 }}>
                {n.s1Desc}
              </span>
            </div>

            {error && (
              <div style={{ marginTop: 14, background: "var(--red-dim)", border: "1px solid rgba(255,180,171,0.28)", borderRadius: 10, padding: "12px 14px", fontFamily: "var(--font)", fontSize: 13, color: "var(--red)", display: "flex", alignItems: "center", gap: 8 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 15 }}>warning</span>
                {error}
              </div>
            )}
          </div>

          <div className="nexus-modal-footer">
            <p style={{ margin: "0 0 12px", fontFamily: "var(--font-body)", fontSize: 13, color: "rgba(var(--text-rgb),0.38)", textAlign: "center", lineHeight: 1.55 }}>
              {n.modalCtaHint}
            </p>
            <button type="submit" disabled={loading} className="nexus-modal-submit">
              {loading ? (
                <>
                  <span className="material-symbols-outlined" style={{ fontSize: 17, animation: "spin 1s linear infinite" }}>sync</span>
                  {n.modalLoading}
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined" style={{ fontSize: 17 }}>arrow_forward</span>
                  {n.modalSubmit}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Orchestrator Chat Panel ───────────────────────────────────────────────────
function OrchestratorChat({
  project, onPlanConfirmed,
}: {
  project: Project;
  onPlanConfirmed: (updated: Project) => void;
}) {
  const msgs = useMessages();
  const { locale } = useLocale();
  const t = useT();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingBreakdown, setPendingBreakdown] = useState<OrchestratorBreakdown[] | null>(null);
  const [editableBreakdown, setEditableBreakdown] = useState<OrchestratorBreakdown[] | null>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatBootDone, setChatBootDone] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  // Restore cached transcript or bootstrap first orchestrator reply.
  useEffect(() => {
    let cancelled = false;
    setChatBootDone(false);

    async function run() {
      try {
        const stored = readNexusChat(project.id);
        if (!cancelled && stored?.messages.length) {
          setMessages(stored.messages);
          setPendingBreakdown(stored.pendingBreakdown);
          setEditableBreakdown(stored.editableBreakdown);
          setShowPayment(stored.showPayment);
          return;
        }

        if (cancelled) return;

        setSending(true);
        setError(null);

        const data = await postOrchestratorChatApi(project.id, [], "", locale);
        if (cancelled) return;

        if (!data.success) {
          setError(data.error ?? t({ en: "Something went wrong", tr: "Bir hata oluştu" }));
          return;
        }

        const assistantMsg: ChatMsg = {
          role: "assistant",
          content: data.reply,
          breakdown: data.breakdown ?? undefined,
          ts: nowStr(),
        };
        setMessages([assistantMsg]);
        if (data.breakdown) {
          setPendingBreakdown(data.breakdown);
          setEditableBreakdown(data.breakdown.map((b: OrchestratorBreakdown) => ({ ...b })));
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) {
          setSending(false);
          setInput("");
          setChatBootDone(true);
        }
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [project.id]);

  useEffect(() => {
    if (!chatBootDone) return;
    writeNexusChat(project.id, {
      v: 1,
      messages,
      pendingBreakdown,
      editableBreakdown,
      showPayment,
    });
  }, [chatBootDone, project.id, messages, pendingBreakdown, editableBreakdown, showPayment]);

  async function sendMessage(userMsg: string) {
    setSending(true);
    setError(null);

    const newMessages = [...messages, { role: "user" as const, content: userMsg, ts: nowStr() }];
    setMessages(newMessages);

    const history = newMessages.map((m) => ({ role: m.role, content: m.content }));

    try {
      const data = await postOrchestratorChatApi(project.id, history, userMsg, locale);

      if (!data.success) {
        setError(data.error ?? t({ en: "Something went wrong", tr: "Bir hata oluştu" }));
        return;
      }

      const assistantMsg: ChatMsg = {
        role: "assistant",
        content: data.reply,
        breakdown: data.breakdown ?? undefined,
        ts: nowStr(),
      };

      setMessages((prev) => [...prev, assistantMsg]);

      if (data.breakdown) {
        setPendingBreakdown(data.breakdown);
        setEditableBreakdown(data.breakdown.map((b: OrchestratorBreakdown) => ({ ...b })));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
      setInput("");
    }
  }

  async function handlePaymentConfirm() {
    if (!editableBreakdown) return;
    setPaying(true);
    try {
      const r = await fetch(`/api/projects/${project.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ breakdown: editableBreakdown }),
      });
      const d = await r.json();
      if (d.success) onPlanConfirmed(d.project);
      setShowPayment(false);
    } finally { setPaying(false); }
  }

  const isActive = project.status === "active" || project.status === "completed";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* Chat area */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>

        {messages.length === 0 && sending && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0" }}>
            <div style={{ display: "flex", gap: 4 }}>
              {[0, 1, 2].map((i) => (
                <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", display: "inline-block", animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
              ))}
            </div>
            <span style={{ fontFamily: "var(--font)", fontSize: 12, color: "var(--text-muted)" }}>{msgs.nexusSection.s1Title}…</span>
          </div>
        )}

        {messages.map((msg, i) => {
          const isAgent = msg.role === "assistant";
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: isAgent ? "flex-start" : "flex-end", gap: 6 }}>
              {/* Speaker label */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {isAgent && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", display: "inline-block" }} />}
                <span style={{ fontFamily: "var(--font)", fontSize: 11.5, color: isAgent ? "var(--accent)" : "rgba(var(--text-rgb),0.3)", letterSpacing: "0.01em" }}>
                  {isAgent ? "NEXUS" : t({ en: "You", tr: "Sen" })} · {msg.ts}
                </span>
              </div>
              {/* Bubble */}
              <div style={{
                background: isAgent ? "var(--bg-surface)" : "var(--accent-dim)",
                border: `1px solid ${isAgent ? "var(--bg-border-bright)" : "rgba(255,86,37,0.3)"}`,
                borderRadius: isAgent ? "4px 16px 16px 16px" : "16px 4px 16px 16px",
                padding: "14px 18px",
                maxWidth: "90%",
                animation: "fadeIn 0.25s ease",
              }}>
                {isAgent ? <AgentMessageBody text={msg.content} /> : (
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 14.5, lineHeight: 1.6, color: "var(--text-primary)", whiteSpace: "pre-wrap" }}>{msg.content}</span>
                )}
                {/* Plan visualization in message */}
                {isAgent && msg.breakdown && (
                  <BreakdownCard
                    breakdown={editableBreakdown ?? msg.breakdown}
                    totalBudget={project.totalBudgetUsdc}
                    editable={!isActive}
                    onChange={isActive ? undefined : setEditableBreakdown}
                  />
                )}
              </div>
              {/* Approve button right after plan message */}
              {isAgent && msg.breakdown && !isActive && i === messages.length - 1 && (
                <button
                  onClick={() => setShowPayment(true)}
                  className="btn-green"
                  style={{ alignSelf: "flex-start", padding: "10px 20px", fontSize: 13, marginTop: 4 }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>check_circle</span>
                  {msgs.nexusSection.chatPlanApprove}
                </button>
              )}
            </div>
          );
        })}

        {/* Sending indicator (mid-conversation) */}
        {sending && messages.length > 0 && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
            <span style={{ fontFamily: "var(--font)", fontSize: 11.5, color: "var(--accent)", letterSpacing: "0.01em" }}>NEXUS</span>
            <div style={{ display: "flex", gap: 4, padding: "10px 14px", background: "var(--bg-surface)", border: "1px solid var(--bg-border-bright)", borderRadius: "0 8px 8px 8px" }}>
              {[0, 1, 2].map((i) => (
                <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", display: "inline-block", animation: `pulse 1.2s ease-in-out ${i * 0.25}s infinite` }} />
              ))}
            </div>
          </div>
        )}

        {error && (
          <div style={{ background: "var(--red-dim)", border: "1px solid rgba(255,180,171,0.3)", borderRadius: 8, padding: "10px 14px", fontFamily: "var(--font)", fontSize: 13, color: "var(--red)", display: "flex", alignItems: "center", gap: 8 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>warning</span>
            {error}
          </div>
        )}

        {isActive && (
          <div style={{ padding: "12px 16px", background: "var(--green-dim)", border: "1px solid rgba(64,225,131,0.3)", borderRadius: 6, display: "flex", alignItems: "center", gap: 8 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--green)" }}>check_circle</span>
            <span style={{ fontFamily: "var(--font)", fontSize: 13, color: "var(--green)" }}>{msgs.nexusSection.chatActive}</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      {!isActive && (
        <div style={{ borderTop: "1px solid var(--bg-border)", padding: "12px 16px", display: "flex", gap: 8, flexShrink: 0 }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && input.trim() && chatBootDone && !sending) { e.preventDefault(); sendMessage(input.trim()); } }}
            placeholder={msgs.nexusSection.chatPlaceholder}
            rows={2}
            disabled={sending || !chatBootDone}
            style={{ flex: 1, resize: "none", fontFamily: "var(--font-body)", fontSize: 14.5, lineHeight: 1.55, background: "var(--bg-base)", border: "1px solid var(--bg-border-bright)", borderRadius: 14, padding: "12px 14px", color: "var(--text-primary)", outline: "none" }}
          />
          <button
            onClick={() => { if (input.trim()) sendMessage(input.trim()); }}
            disabled={sending || !chatBootDone || !input.trim()}
            className="btn-primary"
            style={{ alignSelf: "flex-end", padding: "9px 18px", fontSize: 13, opacity: (!input.trim() || sending || !chatBootDone) ? 0.4 : 1 }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>send</span>
          </button>
        </div>
      )}

      {/* Payment modal */}
      {showPayment && editableBreakdown && (
        <PaymentModal
          breakdown={editableBreakdown}
          totalBudget={project.totalBudgetUsdc}
          onConfirm={handlePaymentConfirm}
          onCancel={() => setShowPayment(false)}
          loading={paying}
        />
      )}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({ onNew }: { onNew: () => void }) {
  const m = useMessages();
  const { locale } = useLocale();
  const steps: { label: string; tone: string }[] = [
    { label: m.nexusSection.step1, tone: "var(--blue)" },
    { label: m.nexusSection.step2, tone: "var(--accent)" },
    { label: m.nexusSection.step3, tone: "var(--gold)" },
    { label: m.nexusSection.step4, tone: "var(--green)" },
  ];

  const specs: AgentSpecialty[] = ["frontend","backend","blockchain","design","finance","ai_ml","devops","security","data","mobile"];
  const [line1, line2] = m.nexusSection.emptyHeadline.split("\n");

  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "56px 24px", textAlign: "center" }}>
      <div style={{ maxWidth: 760, width: "100%" }}>
        <span className="ui-badge ui-badge-accent ui-badge-dot">NEXUS orchestrator</span>
        <h1 className="ui-page-title" style={{ marginTop: 20 }}>
          {line1}{line2 ? <><br /><span className="ui-gradient-text">{line2}</span></> : null}
        </h1>
        <p className="ui-lead" style={{ marginTop: 14, maxWidth: 440, marginInline: "auto" }}>{m.nexusSection.emptySub}</p>

        <div className={s.steps}>
          {[
            [m.nexusSection.s1Title, m.nexusSection.s1Desc],
            [m.nexusSection.s2Title, m.nexusSection.s2Desc],
            [m.nexusSection.s3Title, m.nexusSection.s3Desc],
            [m.nexusSection.s4Title, m.nexusSection.s4Desc],
          ].map(([title, desc], i) => (
            <div key={i} className={s.step}>
              <span className="ui-mono" style={{ color: steps[i].tone, fontSize: 12.5, fontWeight: 600 }}>0{i + 1}</span>
              <div style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 14.5, marginTop: 6 }}>{title}</div>
              <div className="ui-small" style={{ marginTop: 4, lineHeight: 1.5 }}>{desc}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", marginTop: 20 }}>
          {specs.map((sp) => {
            const meta = SPECIALTY_META[sp];
            return (
              <span key={sp} className="ui-badge" style={{ color: meta.color, background: `${meta.color}14`, fontWeight: 500 }}>
                {specialtyLabel(sp, locale)}
              </span>
            );
          })}
        </div>

        <button type="button" onClick={onNew} className="ui-btn ui-btn-primary ui-btn-lg" style={{ marginTop: 32 }}>
          + {m.nexusSection.emptyStart}
        </button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ProjectsPage() {
  const { publicKey } = useWallet();
  const m = useMessages();
  const { locale } = useLocale();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [mounted, setMounted] = useState(false);
  const lastHandledPosterRef = useRef<string | undefined>(undefined);

  useEffect(() => { setMounted(true); }, []);

  const loadProjects = useCallback(async () => {
    const url = publicKey ? `/api/projects?poster=${publicKey.toString()}` : "/api/projects";
    const r = await fetch(url);
    const d = await r.json();
    if (d.success) setProjects(d.projects);
  }, [publicKey]);

  useEffect(() => { if (mounted) loadProjects(); }, [mounted, loadProjects]);

  useEffect(() => {
    lastHandledPosterRef.current = undefined;
  }, [publicKey]);

  useEffect(() => {
    if (!mounted || !publicKey || projects.length === 0) return;
    const pk = publicKey.toString();
    if (lastHandledPosterRef.current === pk) return;
    lastHandledPosterRef.current = pk;

    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(nexusLastProjectKey(pk)) : null;
      const id = raw ? parseInt(raw, 10) : NaN;
      if (Number.isFinite(id) && projects.some((p) => p.id === id)) setSelectedId(id);
    } catch {
      /* ignore */
    }
  }, [mounted, publicKey, projects]);

  const selectedProject = projects.find((p) => p.id === selectedId) ?? null;

  function handleCreated(project: Project) {
    if (typeof window !== "undefined" && publicKey) {
      try {
        localStorage.setItem(nexusLastProjectKey(publicKey.toString()), String(project.id));
      } catch {
        /* ignore */
      }
    }
    setProjects((prev) => [project, ...prev.filter((p) => p.id !== project.id)]);
    setShowModal(false);
    setSelectedId(project.id);
  }

  function handlePlanConfirmed(updated: Project) {
    setProjects((prev) => prev.map((p) => p.id === updated.id ? updated : p));
  }

  const tr = locale === "tr";
  return (
    <PageShell footer={false}>
      <div className={s.wrap}>
        <div className={s.head}>
          <div>
            <h1 className="ui-page-title" style={{ fontSize: "clamp(26px, 3vw, 34px)" }}>{tr ? "NEXUS projeleri" : "NEXUS projects"}</h1>
            <p className="ui-small" style={{ marginTop: 6, fontSize: 14 }}>
              {tr ? "Çok disiplinli bir projeyi tarif et; NEXUS onu alt görevlere böler, bütçeyi dağıtır, sen onaylarsın." : "Describe a multi-discipline project; NEXUS splits it into sub-tasks, allocates the budget, and you approve."}
            </p>
          </div>
          <button type="button" onClick={() => setShowModal(true)} className="ui-btn ui-btn-primary">+ {m.nexusSection.emptyStart}</button>
        </div>

        <div className={s.grid}>
          {/* Project list */}
          <aside className={`ui-card ${s.list}`}>
            <div className={s.listHead}>
              <span style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 15 }}>{publicKey ? (tr ? "Projelerim" : "My projects") : (tr ? "Projeler" : "Projects")}</span>
              <span className="ui-badge" style={{ height: 22 }}>{projects.length}</span>
            </div>
            <div className={s.listBody}>
              {projects.length === 0 ? (
                <div className="ui-empty" style={{ padding: "32px 16px" }}>{tr ? "Henüz proje yok." : "No projects yet."}</div>
              ) : (
                projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`${s.item}${selectedId === p.id ? ` ${s.itemOn}` : ""}`}
                    onClick={() => {
                      setSelectedId(p.id);
                      if (typeof window !== "undefined" && publicKey) {
                        try {
                          localStorage.setItem(nexusLastProjectKey(publicKey.toString()), String(p.id));
                        } catch {
                          /* ignore */
                        }
                      }
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <StatusBadge status={p.status} />
                      <span className="ui-mono ui-muted" style={{ fontSize: 12, marginLeft: "auto" }}>#{p.id}</span>
                    </div>
                    <div className={s.itemTitle}>{p.title}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                      <span className="ui-num" style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{p.totalBudgetUsdc.toFixed(2)} XLM</span>
                      {p.subTasks.length > 0 && (
                        <div style={{ display: "flex", gap: 3 }}>
                          {p.subTasks.slice(0, 5).map((st) => <span key={st.id} style={{ width: 7, height: 7, borderRadius: "50%", background: SPECIALTY_META[st.specialty]?.color ?? "var(--bg-border)", display: "inline-block" }} title={specialtyLabel(st.specialty, locale)} />)}
                        </div>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>

          {/* Main */}
          <section className={`ui-card ${s.main}`}>
            {selectedProject ? (
              <>
                <div className={s.projHead}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <h2 className="ui-h3" style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>{selectedProject.title}</h2>
                      <StatusBadge status={selectedProject.status} />
                    </div>
                    <p className="ui-small" style={{ marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedProject.description.slice(0, 160)}</p>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div className="ui-num" style={{ fontFamily: "var(--font-head)", fontSize: 22, fontWeight: 700, color: "var(--text-primary)" }}>{selectedProject.totalBudgetUsdc.toFixed(2)} XLM</div>
                    <div className="ui-small">{tr ? "Toplam bütçe" : "Total budget"}</div>
                  </div>
                </div>
                <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
                  <OrchestratorChat
                    key={selectedProject.id}
                    project={selectedProject}
                    onPlanConfirmed={handlePlanConfirmed}
                  />
                </div>
              </>
            ) : (
              <EmptyState onNew={() => setShowModal(true)} />
            )}
          </section>
        </div>
      </div>

      {showModal && mounted && (
        <PostProjectModal
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
          posterPubkey={publicKey?.toString() ?? "anonymous"}
        />
      )}
    </PageShell>
  );
}
