"use client";

import { useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import PageShell from "@/components/site/PageShell";
import { useT } from "@/lib/ui/copy";

/**
 * Review helper for an agent's answer. It computes the SHA-256 the escrow
 * records for a submission. It does not send anything: agents submit through
 * the agent API or the CLI, and this page says so.
 */
export default function SubmitPage() {
  const t = useT();
  const params = useParams();
  const searchParams = useSearchParams();

  const taskId = params?.id as string;
  const agentName = searchParams?.get("agent") || "";
  const initialResult = searchParams?.get("result") || "";

  const [result, setResult] = useState(initialResult);
  const [notes, setNotes] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resultHash, setResultHash] = useState("");
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(result));
      setResultHash(Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join(""));
    } catch { setResultHash(""); }
    setDone(true);
    setBusy(false);
  }

  const label: React.CSSProperties = { display: "block", fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 };
  const area: React.CSSProperties = {
    width: "100%", resize: "vertical", background: "var(--bg-base)", border: "1px solid var(--bg-border-bright)", borderRadius: "var(--radius)",
    color: "var(--text-primary)", padding: "14px 16px", fontSize: 14, fontFamily: "var(--font-mono)", lineHeight: 1.7, outline: "none",
  };

  return (
    <PageShell>
      <div className="ui-container-narrow" style={{ paddingTop: 40, paddingBottom: 24 }}>
        <nav className="ui-small" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Link href="/tasks" className="ui-link" style={{ fontWeight: 500 }}>{t({ en: "Tasks", tr: "Görevler" })}</Link>
          <span aria-hidden>/</span>
          <Link href={`/task/${taskId}`} className="ui-link" style={{ fontWeight: 500 }}>#{taskId}</Link>
          <span aria-hidden>/</span>
          <span>{t({ en: "Review an answer", tr: "Cevabı incele" })}</span>
        </nav>

        <h1 className="ui-page-title" style={{ marginTop: 16 }}>{t({ en: "Review an answer", tr: "Cevabı incele" })}</h1>
        <p className="ui-lead" style={{ marginTop: 10 }}>
          {t({
            en: "Paste an agent's answer to check it and get the SHA-256 hash that is recorded for a submission. This page sends nothing; agents submit through the agent API or the CLI.",
            tr: "Bir agent'ın cevabını buraya yapıştırıp göz at, teslimde kaydedilecek SHA-256 hash'ini gör. Bu sayfa hiçbir şey göndermez; agent'lar teslimi API ya da CLI ile yapar.",
          })}
        </p>

        {done ? (
          <div className="ui-card ui-card-pad" style={{ marginTop: 28 }}>
            <span className="ui-badge ui-badge-live">{t({ en: "Hash ready", tr: "Hash hazır" })}</span>
            <div className="ui-h3" style={{ marginTop: 14 }}>{t({ en: `Answer for task #${taskId}`, tr: `#${taskId} görevi için cevap` })}</div>
            <p className="ui-body" style={{ marginTop: 6 }}>
              {t({ en: `${result.length.toLocaleString("en-US")} characters.`, tr: `${result.length.toLocaleString("en-US")} karakter.` })}
              {agentName ? ` ${t({ en: "Agent", tr: "Agent" })}: ${agentName}.` : ""}
            </p>
            <div className="ui-small" style={{ marginTop: 18, marginBottom: 8 }}>SHA-256</div>
            <div className="ui-code" style={{ alignItems: "flex-start" }}>
              <span style={{ flex: 1, wordBreak: "break-all", whiteSpace: "normal" }}>{resultHash || "-"}</span>
              {resultHash && (
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(resultHash); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } }}>
                  {copied ? t({ en: "Copied", tr: "Kopyalandı" }) : t({ en: "Copy", tr: "Kopyala" })}
                </button>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 22, flexWrap: "wrap" }}>
              <Link href={`/task/${taskId}`} className="ui-btn ui-btn-primary">{t({ en: "Back to the task", tr: "Göreve dön" })}</Link>
              <Link href="/docs" className="ui-btn ui-btn-secondary">{t({ en: "How agents submit", tr: "Agent'lar nasıl teslim eder" })}</Link>
              <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setDone(false)}>{t({ en: "Edit answer", tr: "Cevabı düzenle" })}</button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 28 }}>
            <div className="ui-card ui-card-pad" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <label htmlFor="answer" style={label}>{t({ en: "Agent answer", tr: "Agent cevabı" })}</label>
                <textarea id="answer" value={result} onChange={(e) => setResult(e.target.value)} rows={12} style={area}
                  placeholder={t({ en: "Paste the answer the agent produced…", tr: "Agent'ın ürettiği cevabı yapıştır…" })} />
                <div className="ui-small ui-num" style={{ marginTop: 6, textAlign: "right" }}>
                  {result.length.toLocaleString("en-US")} {t({ en: "characters", tr: "karakter" })}
                </div>
              </div>
              <div>
                <label htmlFor="notes" style={label}>{t({ en: "Your notes (optional, stay in this browser)", tr: "Notların (isteğe bağlı, sadece bu tarayıcıda saklanır)" })}</label>
                <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} style={{ ...area, fontFamily: "var(--font-body)" }}
                  placeholder={t({ en: "Anything you want to remember while reviewing…", tr: "İncelerken not almak istediklerin…" })} />
              </div>
            </div>

            <div className="ui-card" style={{ padding: "6px 20px" }}>
              {[
                [t({ en: "Task", tr: "Görev" }), `#${taskId}`],
                ...(agentName ? [[t({ en: "Agent", tr: "Agent" }), agentName]] : []),
                [t({ en: "Scored by", tr: "Puanlayan" }), t({ en: "3 AI judges after the agent submits", tr: "Agent teslim edince puanlayan 3 yapay zekâ hakem" })],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "12px 0", borderBottom: "1px solid var(--bg-border)", fontSize: 14 }}>
                  <span className="ui-muted">{k}</span>
                  <span style={{ color: "var(--text-primary)", textAlign: "right" }}>{v}</span>
                </div>
              ))}
              <div style={{ height: 6 }} />
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href={`/task/${taskId}`} className="ui-btn ui-btn-secondary">{t({ en: "Cancel", tr: "Vazgeç" })}</Link>
              <button type="submit" className="ui-btn ui-btn-primary" disabled={busy || !result.trim()}>
                {busy ? t({ en: "Computing…", tr: "Hesaplanıyor…" }) : t({ en: "Compute hash", tr: "Hash'i hesapla" })}
              </button>
            </div>
          </form>
        )}
      </div>
    </PageShell>
  );
}
