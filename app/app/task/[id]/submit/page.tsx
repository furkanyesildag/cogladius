"use client";

import { useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeProvider";
import { useMessages } from "@/lib/i18n";

const S = {
  bg:      "var(--bg-base)",
  surface: "var(--bg-surface)",
  elevated:"var(--bg-elevated)",
  border:  "var(--bg-border)",
  borderB: "var(--bg-border-bright)",
  accent:  "var(--accent)",
  accentD: "var(--accent-dim)",
  green:   "var(--green)",
  greenD:  "var(--green-dim)",
  yellow:  "var(--yellow)",
  red:     "var(--red)",
  tp:      "var(--text-primary)",
  ts:      "var(--text-secondary)",
  tm:      "var(--text-muted)",
};

export default function SubmitPage() {
  const ts = useMessages().ui.taskSubmitPage;
  const params = useParams();
  const searchParams = useSearchParams();

  const taskId = params?.id as string;
  const agentName = searchParams?.get("agent") || "agent-alpha";
  const initialResult = searchParams?.get("result") || "";

  const [result, setResult] = useState(initialResult);
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resultHash, setResultHash] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    // Real SHA-256 of the submitted content (verifiable; this is not an on-chain tx).
    try {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(result));
      setResultHash(Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join(""));
    } catch { setResultHash(""); }
    setSubmitted(true);
    setSubmitting(false);
  }

  if (submitted) {
    return (
      <div style={{ minHeight: "100vh", background: S.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ background: S.surface, border: `1px solid ${S.border}`, maxWidth: 480, width: "100%", margin: "0 16px" }}>
          <div style={{ borderBottom: `1px solid ${S.border}`, padding: "10px 16px", fontSize: 10, color: S.green, letterSpacing: "0.1em" }}>
            {ts.submittedBanner(taskId)}
          </div>
          <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14, textAlign: "center" }}>
            <div style={{ fontSize: 24, color: S.green }}>✓</div>
            <div style={{ fontSize: 12, color: S.tp }}>{ts.successTitle(taskId)}</div>
            <div style={{ fontSize: 11, color: S.ts, lineHeight: 1.7 }}>
              {ts.successBodyLine1(agentName)}<br />
              {ts.successBodyLine2}
            </div>
            <div style={{ background: S.bg, border: `1px solid ${S.borderB}`, padding: "10px 12px", textAlign: "left" }}>
              <div style={{ fontSize: 10, color: S.tm, marginBottom: 4, letterSpacing: "0.08em" }}>SUBMISSION HASH (SHA-256)</div>
              <span style={{ fontSize: 10, color: S.ts, wordBreak: "break-all", fontFamily: "var(--font)" }}>{resultHash}</span>
            </div>
            <Link href="/dashboard" style={{
              display: "block", textAlign: "center", textDecoration: "none",
              background: "transparent", border: `1px solid ${S.accent}`,
              color: S.accent, padding: "8px 14px", fontSize: 11, fontFamily: "var(--font)", letterSpacing: "0.06em",
            }}>
              {ts.backDashboard}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: S.bg, fontFamily: "var(--font)" }}>
      {/* Header */}
      <header style={{
        background: S.bg, borderBottom: `1px solid ${S.border}`,
        padding: "0 24px", height: 48,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Link href="/dashboard" style={{ textDecoration: "none", fontSize: 13, color: "var(--text-primary)", letterSpacing: "0.1em" }}>
            <span style={{ color: S.accent }}>{ts.headerBrandAccent}</span> {ts.headerBrandRest}
          </Link>
          <span style={{ color: S.tm, fontSize: 10 }}>{ts.crumbSubmit}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ThemeToggle />
          <Link href="/dashboard" style={{ fontSize: 11, color: S.ts, textDecoration: "none" }}>
            {ts.backDashboardShort}
          </Link>
        </div>
      </header>

      <main style={{ maxWidth: 680, margin: "0 auto", padding: "40px 24px" }}>
        {/* Title */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 10, color: S.tm, letterSpacing: "0.1em", marginBottom: 8 }}>{ts.titleLine(taskId, agentName)}</div>
          <h1 style={{ fontSize: 20, color: S.tp, margin: 0, fontWeight: 400, letterSpacing: "0.04em" }}>{ts.h1}</h1>
          <div style={{ fontSize: 12, color: S.ts, marginTop: 6 }}>{ts.subtitle}</div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Agent result */}
          <div>
            <div style={{ fontSize: 10, color: S.tm, letterSpacing: "0.1em", marginBottom: 8 }}>{ts.agentOutputSection}</div>
            <textarea
              value={result}
              onChange={(e) => setResult(e.target.value)}
              rows={10}
              style={{
                width: "100%", resize: "vertical",
                background: S.bg, border: `1px solid ${S.borderB}`,
                color: S.tp, padding: "12px 14px", fontSize: 12,
                fontFamily: "var(--font)", lineHeight: 1.8, outline: "none", boxSizing: "border-box",
              }}
              placeholder={ts.placeholderResult}
            />
            <div style={{ fontSize: 10, color: S.tm, marginTop: 4, textAlign: "right" }}>{ts.charCount(result.length)}</div>
          </div>

          {/* Review notes */}
          <div>
            <div style={{ fontSize: 10, color: S.tm, letterSpacing: "0.1em", marginBottom: 8 }}>{ts.notesSection}</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              style={{
                width: "100%", resize: "vertical",
                background: S.bg, border: `1px solid ${S.borderB}`,
                color: S.tp, padding: "10px 12px", fontSize: 12,
                fontFamily: "var(--font)", lineHeight: 1.7, outline: "none", boxSizing: "border-box",
              }}
              placeholder={ts.placeholderNotes}
            />
          </div>

          {/* Info box */}
          <div style={{ background: S.surface, border: `1px solid ${S.border}`, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 10, color: S.tm, letterSpacing: "0.08em", marginBottom: 4 }}>{ts.deliveryInfo}</div>
            {[
              [ts.rowTaskId, `#${taskId}`],
              [ts.rowAgent, agentName],
              [ts.rowEvaluation, ts.rowEvaluationValue],
              [ts.rowEta, ts.rowEtaValue],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span style={{ color: S.tm }}>{k}</span>
                <span style={{ color: S.ts }}>{v}</span>
              </div>
            ))}
          </div>

          {/* Buttons */}
          <div style={{ display: "flex", gap: 10 }}>
            <Link href="/dashboard" style={{
              flex: 1, textAlign: "center", textDecoration: "none",
              background: "transparent", border: `1px solid ${S.border}`,
              color: S.ts, padding: "9px 14px", fontSize: 11, fontFamily: "var(--font)",
            }}>
              {ts.cancel}
            </Link>
            <button type="submit" disabled={submitting || !result.trim()} style={{
              flex: 2, background: "transparent", border: `1px solid ${S.green}`,
              color: S.green, padding: "9px 14px", fontSize: 11, fontFamily: "var(--font)",
              cursor: submitting ? "default" : "pointer", opacity: !result.trim() ? 0.4 : 1,
              letterSpacing: "0.06em",
            }}>
              {submitting ? ts.submitting : ts.submitCta}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
