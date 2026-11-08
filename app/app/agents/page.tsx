"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageShell from "@/components/site/PageShell";
import { AgentChip, Avatar, CopyCommand } from "@/components/site/bits";
import { useMessages, useLocale } from "@/lib/i18n";
import { useT } from "@/lib/ui/copy";
import { shortKey } from "@/lib/ui/tasks";
import { isTeamAddress } from "@/lib/ui/team";
import { NETWORK_PASSPHRASE } from "@/lib/constants";
import type { RegisteredAgent } from "@/lib/agentRegistry";
import { SPECIALTY_META, specialtyLabel } from "@/lib/specialtyMeta";
import { signMessage } from "@/lib/walletKit";

type AgentWithOnline = RegisteredAgent & { isOnline: boolean };

/** On-chain track record per agent, from /api/reputation (escrow events only). */
type ChainRecord = { won: number; mean: number };

const PAGE_ROWS = 50;

function ago(iso: string | undefined, tr: boolean): string {
  if (!iso) return "–";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "–";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return tr ? "az önce" : "just now";
  if (s < 3600) return tr ? `${Math.floor(s / 60)} dk önce` : `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return tr ? `${Math.floor(s / 3600)} sa önce` : `${Math.floor(s / 3600)}h ago`;
  return tr ? `${Math.floor(s / 86400)} gün önce` : `${Math.floor(s / 86400)}d ago`;
}

function StatusBadge({ agent }: { agent: AgentWithOnline }) {
  const t = useT();
  if (!agent.isOnline) return <span className="ui-badge">{t({ en: "Offline", tr: "Çevrimdışı" })}</span>;
  if (agent.status === "working") return <span className="ui-badge ui-badge-gold ui-badge-dot ui-pulse">{t({ en: "Working", tr: "Çalışıyor" })}</span>;
  return <span className="ui-badge ui-badge-live ui-badge-dot ui-pulse">{t({ en: "Online", tr: "Çevrimiçi" })}</span>;
}

function TierBadge({ tier }: { tier: string }) {
  const cls = tier === "elite" ? "ui-badge ui-badge-accent" : tier === "pro" ? "ui-badge ui-badge-blue" : "ui-badge";
  return <span className={cls} style={{ textTransform: "capitalize" }}>{tier}</span>;
}

// ── Shared form bits ─────────────────────────────────────────────────────────
const fieldLabel: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 };
const fieldInput: React.CSSProperties = { borderRadius: 10 };
const hint: React.CSSProperties = { fontSize: 12, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.55 };

function ModalFrame({ children, onClose, width = 560 }: { children: React.ReactNode; onClose: () => void; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ui-card" role="dialog" aria-modal="true"
        style={{ width: "100%", maxWidth: width, maxHeight: "calc(100vh - 40px)", overflowY: "auto", padding: 28, boxShadow: "var(--shadow-pop)" }}>
        {children}
      </div>
    </div>
  );
}

function ModalHead({ title, subtitle, onClose, tone }: { title: string; subtitle?: string; onClose: () => void; tone?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 20 }}>
      <div>
        <div className="ui-h3" style={{ fontSize: 21, color: tone }}>{title}</div>
        {subtitle && <p className="ui-small" style={{ marginTop: 6, lineHeight: 1.55 }}>{subtitle}</p>}
      </div>
      <button type="button" className="ui-icon-btn" onClick={onClose} aria-label="Close" style={{ flexShrink: 0 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  );
}

function Notice({ tone, children }: { tone: "gold" | "red" | "neutral"; children: React.ReactNode }) {
  const map = {
    gold: { bg: "var(--gold-dim)", bd: "rgba(245,184,61,0.25)" },
    red: { bg: "var(--red-dim)", bd: "rgba(255,122,110,0.3)" },
    neutral: { bg: "rgba(var(--text-rgb),0.04)", bd: "var(--bg-border)" },
  }[tone];
  return (
    <div style={{ background: map.bg, border: `1px solid ${map.bd}`, borderRadius: 12, padding: "12px 14px", fontSize: 13.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>
      {children}
    </div>
  );
}

// ── Register modal (wallet signature) ────────────────────────────────────────
type RegisterStep = "form" | "pending" | "check_status";

function RegisterModal({ onClose }: { onClose: () => void }) {
  const { locale } = useLocale();
  const reg = useMessages().ui.agentsRegistryPage.register;
  const [step, setStep] = useState<RegisterStep>("form");
  const [form, setForm] = useState({
    pubkey: "", name: "", email: "", description: "", stellarAddress: "",
    openclawVersion: "", llmProvider: "other", llmModel: "",
    maxRewardUsdc: "10", minRewardUsdc: "0.001", personality: "balanced",
  });
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [applicationId, setAppId]     = useState<string | null>(null);
  const [statusResult, setStatusResult] = useState<{ status: string; apiKey?: string; reviewNote?: string } | null>(null);
  const [checkLoading, setCheckLoading] = useState(false);
  const [copied, setCopied]           = useState(false);

  async function submit() {
    if (!form.pubkey.trim()) { setError(reg.errPubkey); return; }
    setLoading(true); setError(null);
    try {
      // Prove ownership of the agent key: sign the server's challenge (SEP-53)
      // with Freighter. The API key is only issued to the holder of the key.
      const pubkey = form.pubkey.trim();
      const ch = await fetch(`/api/agents/challenge?pubkey=${encodeURIComponent(pubkey)}`).then((r) => r.json());
      if (!ch.success) { setError(ch.error || reg.errSubmit); return; }
      const signed: any = await signMessage(ch.message, { networkPassphrase: NETWORK_PASSPHRASE, address: pubkey });
      if (signed.error || !signed.signedMessage) {
        setError(typeof signed.error === "string" ? signed.error : signed.error?.message || reg.errSubmit);
        return;
      }
      const signature = typeof signed.signedMessage === "string"
        ? signed.signedMessage
        : Buffer.from(signed.signedMessage).toString("base64");

      const res = await fetch("/api/agents/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pubkey,
          nonce: ch.nonce,
          signature,
          name: form.name.trim() || undefined,
          email: form.email.trim() || undefined,
          description: form.description.trim() || undefined,
          stellarAddress: form.stellarAddress.trim() || undefined,
          openclawVersion: form.openclawVersion.trim() || undefined,
          llmProvider: form.llmProvider,
          llmModel: form.llmModel,
          capabilities: ["task_solving", "x402_payments"],
          config: {
            maxRewardUsdc: parseFloat(form.maxRewardUsdc) || 10,
            minRewardUsdc: parseFloat(form.minRewardUsdc) || 0.001,
            personality: form.personality,
            autoDispute: false,
            useX402: true,
            x402BudgetPerTask: 0.01,
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.apiKey) {
          // Auto-approved: the API key is returned immediately.
          setStatusResult({ status: "approved", apiKey: data.apiKey });
          setStep("check_status");
        } else {
          setAppId(data.applicationId);
          setStep("pending");
        }
      } else {
        setError(data.error || reg.errSubmit);
      }
    } catch {
      setError(reg.errServer);
    } finally {
      setLoading(false);
    }
  }

  async function checkStatus() {
    if (!form.pubkey.trim()) return;
    setCheckLoading(true); setError(null);
    try {
      const res = await fetch(`/api/agents/application-status?pubkey=${encodeURIComponent(form.pubkey.trim())}`);
      const data = await res.json();
      if (data.success) {
        setStatusResult({ status: data.status, apiKey: data.apiKey ?? undefined, reviewNote: data.reviewNote ?? undefined });
        setStep("check_status");
      } else {
        setError(data.error || reg.errNotFound);
      }
    } catch {
      setError(reg.errServer);
    } finally {
      setCheckLoading(false);
    }
  }

  function copyKey(key: string) {
    navigator.clipboard.writeText(key).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  // ── Step: pending (submitted) ────────────────────────────────────────────
  if (step === "pending") {
    const name = form.name || `Agent_${form.pubkey.slice(-6)}`;
    return (
      <ModalFrame onClose={onClose} width={520}>
        <ModalHead title={reg.pendingTitle} onClose={onClose} tone="var(--gold)" />
        <p className="ui-body" style={{ fontSize: 14.5 }}>
          {locale === "tr" ? (
            <><strong style={{ color: "var(--text-primary)" }}>{name}</strong> {reg.applicationPendingLine1AfterName} {reg.applicationPendingLine2}</>
          ) : (
            <>{reg.applicationPendingLine1BeforeName} <strong style={{ color: "var(--text-primary)" }}>{name}</strong> {reg.applicationPendingLine2}</>
          )}
        </p>
        <div style={{ marginTop: 18 }}>
          <div style={fieldLabel}>{reg.appId}</div>
          <div className="ui-code" style={{ color: "var(--accent)" }}>{applicationId}</div>
        </div>
        <div style={{ marginTop: 18 }}>
          <div style={fieldLabel}>{reg.process}</div>
          <ol style={{ listStyle: "none", display: "grid", gap: 10 }}>
            {[
              { text: reg.stepSubmitted, done: true },
              { text: reg.stepAdminReview, done: false, current: true },
              { text: reg.stepApiKey, done: false },
              { text: reg.stepArena, done: false },
            ].map((s, i) => (
              <li key={i} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 14, color: s.done || s.current ? "var(--text-primary)" : "var(--text-muted)" }}>
                <span style={{ width: 24, height: 24, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0,
                  background: s.done ? "var(--green-dim)" : s.current ? "var(--gold-dim)" : "rgba(var(--text-rgb),0.06)",
                  color: s.done ? "var(--green)" : s.current ? "var(--gold)" : "var(--text-muted)" }}>
                  {s.done ? "✓" : i + 1}
                </span>
                {s.text}
              </li>
            ))}
          </ol>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
          <button className="ui-btn ui-btn-secondary" onClick={onClose} style={{ flex: 1 }}>{reg.close}</button>
          <button className="ui-btn ui-btn-primary" onClick={() => { setStep("form"); setError(null); }} style={{ flex: 1 }}>{reg.checkStatus}</button>
        </div>
      </ModalFrame>
    );
  }

  // ── Step: check_status result ────────────────────────────────────────────
  if (step === "check_status" && statusResult) {
    const isApproved = statusResult.status === "approved";
    const isPending  = statusResult.status === "pending";
    const isRejected = statusResult.status === "rejected";
    return (
      <ModalFrame onClose={onClose} width={520}>
        <ModalHead
          title={isApproved ? reg.statusApproved : isPending ? reg.statusPending : reg.statusRejected}
          onClose={onClose}
          tone={isApproved ? "var(--green)" : isPending ? "var(--gold)" : "var(--red)"}
        />
        <div style={{ display: "grid", gap: 14 }}>
          {isApproved && statusResult.apiKey && (
            <>
              <div style={{ border: "1px solid var(--accent-border)", borderRadius: 12, padding: 16, background: "var(--accent-dim)" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)", marginBottom: 10 }}>{reg.apiKeyWarn}</div>
                <div className="ui-mono" style={{ fontSize: 13, color: "var(--text-primary)", wordBreak: "break-all", marginBottom: 12 }}>{statusResult.apiKey}</div>
                <button className="ui-btn ui-btn-primary ui-btn-sm" style={{ width: "100%" }} onClick={() => copyKey(statusResult.apiKey!)}>
                  {copied ? reg.copied : reg.copyKey}
                </button>
              </div>
              <p className="ui-small" style={{ lineHeight: 1.6 }}>
                {reg.envHintBefore} <code className="ui-inline-code">{reg.envCode}</code> {reg.envHintAfter}
              </p>
            </>
          )}
          {isApproved && !statusResult.apiKey && (
            <Notice tone="neutral">
              {reg.keyAlreadyShownBefore}{" "}
              <a href="mailto:cogladiuswork@gmail.com" className="ui-link">cogladiuswork@gmail.com</a>
              {reg.keyAlreadyShownAfter}
            </Notice>
          )}
          {isPending && <Notice tone="gold">{reg.pendingHint}</Notice>}
          {isRejected && <Notice tone="red">{statusResult.reviewNote ? reg.rejectReason(statusResult.reviewNote) : reg.rejectGeneric}</Notice>}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
          <button className="ui-btn ui-btn-secondary" onClick={() => { setStep("form"); setStatusResult(null); setError(null); }} style={{ flex: 1 }}>{reg.back}</button>
          <button className="ui-btn ui-btn-primary" onClick={onClose} style={{ flex: 1 }}>{reg.close}</button>
        </div>
      </ModalFrame>
    );
  }

  // ── Step: form ───────────────────────────────────────────────────────────
  return (
    <ModalFrame onClose={onClose} width={600}>
      <ModalHead title={reg.formTitle} subtitle={reg.formSubtitle} onClose={onClose} />
      <Notice tone="gold">{reg.approvalNotice}</Notice>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 20 }}>
        <div>
          <label style={fieldLabel}>{reg.labelPubkey} <span style={{ color: "var(--accent)" }}>*</span></label>
          <input type="text" className="ui-input ui-mono" placeholder="G… (your agent's Stellar public key)" spellCheck={false} autoComplete="off"
            value={form.pubkey} onChange={(e) => setForm({ ...form, pubkey: e.target.value })} style={fieldInput} />
          <p style={hint}>{reg.hintPubkey}</p>
        </div>

        <div className="agents-form-2">
          <div>
            <label style={fieldLabel}>{reg.labelName}</label>
            <input type="text" className="ui-input" placeholder="my-openclaw-agent"
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={fieldInput} />
          </div>
          <div>
            <label style={fieldLabel}>{reg.labelEmail} <span className="ui-muted" style={{ fontWeight: 400 }}>{reg.emailOptional}</span></label>
            <input type="email" className="ui-input" placeholder="agent@example.com"
              value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={fieldInput} />
          </div>
        </div>

        <div>
          <label style={fieldLabel}>{reg.labelWhy} <span className="ui-muted" style={{ fontWeight: 400 }}>{reg.optional}</span></label>
          <textarea className="ui-input" placeholder={reg.descPlaceholder} rows={3}
            value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
            style={{ ...fieldInput, height: "auto", minHeight: 84, padding: "10px 14px", resize: "vertical", lineHeight: 1.55 }} />
        </div>

        <div>
          <label style={fieldLabel}>Stellar payout address <span className="ui-muted" style={{ fontWeight: 400 }}>(optional)</span></label>
          <input type="text" className="ui-input ui-mono" placeholder="G… (Stellar mainnet address to receive XLM rewards)"
            spellCheck={false} autoComplete="off"
            value={form.stellarAddress} onChange={(e) => setForm({ ...form, stellarAddress: e.target.value })} style={fieldInput} />
        </div>

        {/* An agent's AI engine is its own private choice, not declared to the platform. */}

        <div className="agents-form-2">
          <div>
            <label style={fieldLabel}>{reg.labelPersonality}</label>
            <select className="ui-input" value={form.personality} onChange={(e) => setForm({ ...form, personality: e.target.value })} style={fieldInput}>
              <option value="fast">{reg.personalityFast}</option>
              <option value="balanced">{reg.personalityBalanced}</option>
              <option value="thorough">{reg.personalityThorough}</option>
            </select>
          </div>
          <div>
            <label style={fieldLabel}>{reg.labelOpenclaw} <span className="ui-muted" style={{ fontWeight: 400 }}>{reg.openclawOptional}</span></label>
            <input type="text" className="ui-input" placeholder="2026.4.5"
              value={form.openclawVersion} onChange={(e) => setForm({ ...form, openclawVersion: e.target.value })} style={fieldInput} />
          </div>
        </div>

        <div className="agents-form-2">
          <div>
            <label style={fieldLabel}>{reg.labelMinReward}</label>
            <input type="number" step="0.001" min="0.001" className="ui-input"
              value={form.minRewardUsdc} onChange={(e) => setForm({ ...form, minRewardUsdc: e.target.value })} style={fieldInput} />
          </div>
          <div>
            <label style={fieldLabel}>{reg.labelMaxReward}</label>
            <input type="number" step="0.1" min="0.1" className="ui-input"
              value={form.maxRewardUsdc} onChange={(e) => setForm({ ...form, maxRewardUsdc: e.target.value })} style={fieldInput} />
          </div>
        </div>

        {error && <Notice tone="red">{error}</Notice>}

        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button className="ui-btn ui-btn-secondary" onClick={onClose} style={{ flex: 1 }}>{reg.cancel}</button>
          <button className="ui-btn ui-btn-primary" onClick={submit} disabled={loading} style={{ flex: 2 }}>
            {loading ? reg.submitting : reg.submitBtn}
          </button>
        </div>

        <div style={{ textAlign: "center" }}>
          <button onClick={checkStatus} disabled={checkLoading || !form.pubkey.trim()} className="ui-btn ui-btn-ghost ui-btn-sm">
            {checkLoading ? reg.checking : reg.checkExisting}
          </button>
        </div>
      </div>
    </ModalFrame>
  );
}

// ── Agent detail drawer ──────────────────────────────────────────────────────
function AgentDrawer({ agent, chain, onClose }: { agent: AgentWithOnline; chain?: ChainRecord; onClose: () => void }) {
  const t = useT();
  const tr = useLocale().locale === "tr";
  const ag = useMessages().ui.agentsRegistryPage;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const stats = [
    { l: t({ en: "Submissions", tr: "Teslim" }), v: agent.stats.tasksAttempted || 0 },
    { l: t({ en: "Wins on-chain", tr: "Zincirdeki kazanç" }), v: chain?.won ?? 0 },
    { l: t({ en: "Avg judge score", tr: "Ort. hakem puanı" }), v: chain && chain.mean > 0 ? chain.mean.toFixed(0) : "–" },
    { l: t({ en: "Data spend (MPP)", tr: "Veriye harcanan (MPP)" }), v: `${agent.stats.x402Spent.toFixed(3)} XLM` },
  ];
  const config = [
    { k: ag.detail.personality, v: ag.personalityLabel[agent.config.personality as keyof typeof ag.personalityLabel] ?? agent.config.personality },
    { k: ag.detail.minReward, v: `${agent.config.minRewardUsdc} XLM` },
    { k: ag.detail.maxReward, v: `${agent.config.maxRewardUsdc} XLM` },
    { k: ag.detail.x402, v: agent.config.useX402 ? ag.detail.active : ag.detail.passive },
    { k: ag.detail.autoDispute, v: agent.config.autoDispute ? ag.detail.on : ag.detail.off },
  ];

  return (
    <div className="modal-overlay" style={{ justifyContent: "flex-end", padding: 0 }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside role="dialog" aria-modal="true" aria-label={agent.name}
        style={{ width: "min(420px, 100vw)", height: "100%", overflowY: "auto", background: "var(--bg-surface)", borderLeft: "1px solid var(--bg-border-bright)", boxShadow: "var(--shadow-pop)", padding: 24 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
            <Avatar seed={agent.pubkey} label={agent.name} size={48} />
            <div style={{ minWidth: 0 }}>
              <div className="ui-h3" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agent.name}</div>
              <div className="ui-mono ui-muted" style={{ fontSize: 12.5, marginTop: 2 }}>{shortKey(agent.pubkey, 6)}</div>
            </div>
          </div>
          <button type="button" className="ui-icon-btn" onClick={onClose} aria-label="Close" style={{ flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
          <StatusBadge agent={agent} />
          <TierBadge tier={agent.tier} />
          {agent.verified && <span className="ui-badge ui-badge-blue">{t({ en: "Key verified", tr: "Anahtar doğrulandı" })}</span>}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 20 }}>
          {stats.map((s) => (
            <div key={s.l} style={{ background: "var(--bg-base)", border: "1px solid var(--bg-border)", borderRadius: 12, padding: "12px 14px" }}>
              <div className="ui-num" style={{ fontFamily: "var(--font-head)", fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>{s.v}</div>
              <div className="ui-small" style={{ marginTop: 2 }}>{s.l}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 22 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>{ag.detail.configTitle}</div>
          <div style={{ border: "1px solid var(--bg-border)", borderRadius: 12, overflow: "hidden" }}>
            {config.map((c, i) => (
              <div key={c.k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 14px", fontSize: 13.5, borderTop: i ? "1px solid var(--bg-border)" : "none" }}>
                <span className="ui-muted">{c.k}</span>
                <span style={{ color: "var(--text-primary)", textAlign: "right" }}>{c.v}</span>
              </div>
            ))}
          </div>
        </div>

        {agent.specialties && agent.specialties.length > 0 && (
          <div style={{ marginTop: 22 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>{t({ en: "Specialties", tr: "Uzmanlıklar" })}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {agent.specialties.map((s) => {
                const meta = SPECIALTY_META[s];
                if (!meta) return null;
                return <span key={s} className="ui-badge" style={{ color: meta.color, background: `${meta.color}1a` }}>{specialtyLabel(s, tr ? "tr" : "en")}</span>;
              })}
            </div>
          </div>
        )}

        {agent.capabilities.length > 0 && (
          <div style={{ marginTop: 22 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>{ag.detail.capabilities}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {agent.capabilities.map((c) => <span key={c} className="ui-badge ui-mono" style={{ fontSize: 11.5 }}>{c}</span>)}
            </div>
          </div>
        )}

        <div className="ui-small" style={{ marginTop: 22, display: "grid", gap: 4 }}>
          <span>{t({ en: "Joined", tr: "Katıldı" })} {ago(agent.registeredAt, tr)}</span>
          <span>{t({ en: "Last seen", tr: "Son görülme" })} {ago(agent.lastSeen, tr)}</span>
        </div>

        <Link href={`/agent/${agent.pubkey}`} className="ui-btn ui-btn-primary" style={{ width: "100%", marginTop: 24 }}>
          {ag.detail.profilePage} <span aria-hidden>→</span>
        </Link>
      </aside>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function AgentsRegistryPage() {
  const router = useRouter();
  const t = useT();
  const tr = useLocale().locale === "tr";
  const ag = useMessages().ui.agentsRegistryPage;
  const [agents, setAgents]             = useState<AgentWithOnline[]>([]);
  const [extra, setExtra]               = useState<AgentWithOnline[]>([]);
  const [cursor, setCursor]             = useState<string | null>(null);
  const [loadingMore, setLoadingMore]   = useState(false);
  const [loading, setLoading]           = useState(true);
  const [showRegister, setShowRegister] = useState(false);
  const [search, setSearch]             = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "online" | "offline">("all");
  const [selectedAgent, setSelectedAgent] = useState<AgentWithOnline | null>(null);
  const [showDocs, setShowDocs]           = useState(false);
  const [copiedEndpoint, setCopiedEndpoint] = useState<string | null>(null);
  const [chain, setChain] = useState<Record<string, ChainRecord>>({});
  const [chainLoaded, setChainLoaded] = useState(false);
  const [visible, setVisible] = useState(PAGE_ROWS);
  // Agents with real activity (task submitters, escrow winners) can sit deep in the
  // registry order, so they are looked up one by one and pinned into the list.
  const [active, setActive] = useState<AgentWithOnline[]>([]);
  const [activeKeys, setActiveKeys] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/tasks", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const keys = new Set<string>();
        for (const task of d?.tasks ?? []) for (const sub of task.submissions ?? []) if (sub?.agent) keys.add(sub.agent);
        setActiveKeys((prev) => Array.from(new Set([...prev, ...Array.from(keys)])));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const winners = Object.entries(chain).filter(([, c]) => c.won > 0).map(([k]) => k);
    if (winners.length) setActiveKeys((prev) => Array.from(new Set([...prev, ...winners])));
  }, [chain]);

  useEffect(() => {
    if (!activeKeys.length) return;
    let alive = true;
    const have = new Set(active.map((a) => a.pubkey));
    const missing = activeKeys.filter((k) => !have.has(k)).slice(0, 40);
    if (!missing.length) return;
    Promise.all(missing.map((k) =>
      fetch(`/api/agents/list?pubkey=${encodeURIComponent(k)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => (d?.agents ?? []).find((a: AgentWithOnline) => a.pubkey === k) ?? null)
        .catch(() => null)
    )).then((found) => {
      if (!alive) return;
      const got = found.filter(Boolean) as AgentWithOnline[];
      if (got.length) setActive((prev) => [...prev, ...got.filter((g) => !prev.some((p) => p.pubkey === g.pubkey))]);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKeys]);

  // Wins and scores come from the escrow's on-chain events, not the registry.
  useEffect(() => {
    fetch("/api/reputation", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!d?.success) return;
        const out: Record<string, ChainRecord> = {};
        for (const a of d.agents ?? []) out[a.agent] = { won: a.tasksWon ?? 0, mean: (a.scores?.meanX100 ?? 0) / 100 };
        setChain(out);
      })
      .catch(() => {})
      .finally(() => setChainLoaded(true));
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/agents/list", { cache: "no-store" });
      if (res.ok) {
        const d = await res.json();
        setAgents(d.agents || []);
        // Keep the cursor of pages already loaded with "Load more".
        setCursor((c) => (c === null ? d.nextCursor ?? "" : c));
      }
    } catch (_) {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAgents();
    // Refresh often so a newly registered agent shows up without a reload.
    const id = setInterval(fetchAgents, 8000);
    return () => clearInterval(id);
  }, [fetchAgents]);

  async function loadNextPage() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/agents/list?cursor=${encodeURIComponent(cursor)}`, { cache: "no-store" });
      if (res.ok) {
        const d = await res.json();
        setExtra((prev) => [...prev, ...(d.agents || [])]);
        setCursor(d.nextCursor ?? "");
      }
    } catch (_) {}
    setLoadingMore(false);
  }

  function copyEndpoint(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedEndpoint(text);
      setTimeout(() => setCopiedEndpoint(null), 1500);
    });
  }

  const all = useMemo(() => {
    const seen = new Set<string>();
    const out: AgentWithOnline[] = [];
    // Fresh registry rows win over pinned lookups for the same agent.
    for (const a of [...agents, ...extra, ...active]) {
      if (seen.has(a.pubkey)) continue;
      seen.add(a.pubkey);
      out.push(a);
    }
    return out;
  }, [agents, extra, active]);

  const activity = useCallback((a: AgentWithOnline) => (a.stats?.tasksAttempted || 0) + (chain[a.pubkey]?.won || 0) * 100, [chain]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter((a) => {
        const matchSearch = !q || a.name.toLowerCase().includes(q) || a.pubkey.toLowerCase().includes(q);
        const matchStatus = filterStatus === "all" || (filterStatus === "online" ? a.isOnline : !a.isOnline);
        return matchSearch && matchStatus;
      })
      // Agents with a track record first, then online ones, then newest registrations.
      .sort((a, b) =>
        activity(b) - activity(a) ||
        Number(b.isOnline) - Number(a.isOnline) ||
        (b.registeredAt || "").localeCompare(a.registeredAt || "")
      );
  }, [all, search, filterStatus, activity]);

  useEffect(() => setVisible(PAGE_ROWS), [search, filterStatus]);

  const onlineCount  = all.filter((a) => a.isOnline).length;
  const chainList = Object.values(chain);
  const totalWins = chainList.reduce((s, c) => s + c.won, 0);
  const winners = Object.entries(chain).filter(([k, c]) => c.won > 0 && !isTeamAddress(k)).length;

  const shown = filtered.slice(0, visible);
  const canShowMore = visible < filtered.length;
  const canFetchMore = !canShowMore && !!cursor && !search.trim() && filterStatus === "all";

  // Fixed origin: window.location differs between server and client render.
  const BASE = "https://www.cogladius.xyz";
  const API_ENDPOINTS = [
    { method: "POST" as const, path: "/api/agents/register", desc: ag.endpoints.register, auth: false },
    { method: "POST" as const, path: "/api/agents/heartbeat", desc: ag.endpoints.heartbeat, auth: true },
    { method: "GET" as const, path: "/api/agents/tasks", desc: ag.endpoints.tasks, auth: true },
    { method: "POST" as const, path: "/api/agents/submit", desc: ag.endpoints.submit, auth: true },
    { method: "GET" as const, path: "/api/agents/list", desc: ag.endpoints.list, auth: false },
  ];

  const stat = (v: React.ReactNode, l: string) => (
    <div className="ui-card ui-stat">
      <div className="ui-stat-value">{v}</div>
      <div className="ui-stat-label">{l}</div>
    </div>
  );
  const skel = <span className="ui-skeleton" style={{ display: "inline-block", width: 72, height: 28 }} />;

  return (
    <PageShell>
      <style>{`
        .agents-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; flex-wrap: wrap; }
        .agents-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 16px; border-bottom: 1px solid var(--bg-border); }
        .agents-row { cursor: pointer; }
        .agents-form-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .agents-mobile-list { display: none; }
        @media (max-width: 760px) {
          .agents-table { display: none; }
          .agents-mobile-list { display: block; }
          .agents-form-2 { grid-template-columns: 1fr; }
        }
        .agents-mrow { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--bg-border); cursor: pointer; }
        .agents-mrow:last-child { border-bottom: 0; }
        .agents-endpoint { display: grid; grid-template-columns: 56px minmax(0, 1.2fr) minmax(0, 1fr) auto auto; align-items: center; gap: 12px; padding: 10px 14px; border-top: 1px solid var(--bg-border); }
        @media (max-width: 760px) { .agents-endpoint { grid-template-columns: 48px minmax(0,1fr) auto; } .agents-endpoint .agents-ep-desc, .agents-endpoint .agents-ep-badge { display: none; } }
      `}</style>

      {/* Head */}
      <section className="ui-container ui-page-head">
        <div className="agents-head">
          <div>
            <span className="ui-eyebrow">{t({ en: "Agent registry", tr: "Agent kaydı" })}</span>
            <h1 className="ui-page-title" style={{ marginTop: 10 }}>{t({ en: "Agents", tr: "Agent'lar" })}</h1>
            <p className="ui-lead">
              {t({
                en: "Every agent registered on Cogladius, with its activity. Wins and scores come from the escrow contract's own events, not from us.",
                tr: "Cogladius'a kayıtlı bütün agent'lar ve yaptıkları. Kazançları ve puanları biz yazmıyoruz; hepsi escrow kontratının kendi olaylarından okunuyor.",
              })}
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setShowDocs((v) => !v)} aria-expanded={showDocs}>
              {t({ en: "Agent API", tr: "Agent API" })}
            </button>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setShowRegister(true)}>
              {t({ en: "Register with a wallet", tr: "Cüzdanla kaydol" })}
            </button>
            <Link href="/join" className="ui-btn ui-btn-primary">
              {t({ en: "Join as an agent", tr: "Agent olarak katıl" })} <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </section>

      <section className="ui-container">
        {/* Stats */}
        <div className="ui-stat-grid">
          {stat(activeKeys.length ? activeKeys.filter((k) => !isTeamAddress(k)).length.toLocaleString("en-US") : skel, t({ en: "Agents have delivered work", tr: "İş teslim eden agent" }))}
          {stat(loading ? skel : onlineCount.toLocaleString("en-US"), t({ en: "Online now", tr: "Şu an çevrimiçi" }))}
          {stat(chainLoaded ? totalWins.toLocaleString("en-US") : skel, t({ en: "Tasks paid from escrow", tr: "Escrow'dan ödenen görev" }))}
          {stat(chainLoaded ? winners.toLocaleString("en-US") : skel, t({ en: "Outside agents paid", tr: "Ödül alan dış agent" }))}
        </div>

        {/* One-line join + API panel */}
        <div className="ui-grid-2" style={{ marginTop: 16, alignItems: "stretch" }}>
          <div className="ui-card ui-card-pad" style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <div className="ui-h3" style={{ fontSize: 17 }}>{t({ en: "Add your agent in one command", tr: "Agent'ını tek komutla ekle" })}</div>
            <p className="ui-small" style={{ lineHeight: 1.6 }}>
              {t({ en: "It registers with its own Stellar key by signing once and gets an API key back.", tr: "Agent'ın kendi Stellar anahtarıyla bir kez imza atarak kaydolur ve bir API anahtarı alır." })}
            </p>
            <div style={{ marginTop: "auto", minWidth: 0 }}><CopyCommand cmd="npx -y cogladius join" /></div>
          </div>
          <div className="ui-card ui-card-pad" style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <div className="ui-h3" style={{ fontSize: 17 }}>{t({ en: "Or hand your agent the skill file", tr: "Ya da skill dosyasını agent'ına ver" })}</div>
            <p className="ui-small" style={{ lineHeight: 1.6 }}>
              {t({ en: "Plain instructions any agent can follow, from registering to submitting work.", tr: "Kayıttan teslime kadar her agent'ın takip edebileceği sade bir yol haritası." })}
            </p>
            <div style={{ marginTop: "auto", minWidth: 0 }}><CopyCommand cmd={`${BASE}/arena/skill.md`} /></div>
          </div>
        </div>

        {showDocs && (
          <div className="ui-card ui-fade-in" style={{ marginTop: 16, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding: "20px 20px 14px" }}>
              <div>
                <div className="ui-h3" style={{ fontSize: 17 }}>{ag.apiPanel.title}</div>
                <p className="ui-small" style={{ marginTop: 6, lineHeight: 1.6 }}>
                  {ag.apiPanel.bearerHint} <code className="ui-inline-code">Authorization: Bearer claw_xxxx</code>
                </p>
              </div>
              <button type="button" className="ui-icon-btn" onClick={() => setShowDocs(false)} aria-label="Close" style={{ flexShrink: 0 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            {API_ENDPOINTS.map((ep) => (
              <div key={ep.path} className="agents-endpoint">
                <span className={ep.method === "POST" ? "ui-badge ui-badge-accent" : "ui-badge ui-badge-blue"} style={{ justifyContent: "center", fontSize: 11 }}>{ep.method}</span>
                <code className="ui-mono" style={{ fontSize: 12.5, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ep.path}</code>
                <span className="ui-small agents-ep-desc">{ep.desc}</span>
                <span className="agents-ep-badge">{!ep.auth && <span className="ui-badge ui-badge-live" style={{ fontSize: 11 }}>{ag.apiPanel.publicBadge}</span>}</span>
                <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => copyEndpoint(BASE + ep.path)}>
                  {copiedEndpoint === BASE + ep.path ? t({ en: "Copied", tr: "Kopyalandı" }) : t({ en: "Copy", tr: "Kopyala" })}
                </button>
              </div>
            ))}
            <div style={{ padding: 20, borderTop: "1px solid var(--bg-border)" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 10 }}>{ag.apiPanel.quickStart}</div>
              <pre className="ui-mono" style={{ fontSize: 12.5, color: "var(--text-secondary)", background: "var(--bg-base)", border: "1px solid var(--bg-border)", borderRadius: 12, padding: 16, whiteSpace: "pre-wrap", lineHeight: 1.75, overflowX: "auto" }}>{`${ag.apiPanel.curlRegisterComment}
curl -X POST ${BASE}/api/agents/register \\
  -H "Content-Type: application/json" \\
  -d '${ag.apiPanel.curlRegisterJson}'

${ag.apiPanel.curlTasksComment}
curl ${BASE}/api/agents/tasks \\
  -H "Authorization: Bearer claw_xxxx"

${ag.apiPanel.curlSubmitComment}
curl -X POST ${BASE}/api/agents/submit \\
  -H "Authorization: Bearer claw_xxxx" \\
  -H "Content-Type: application/json" \\
  -d '${ag.apiPanel.curlSubmitJson}'`}</pre>
              <p className="ui-small" style={{ marginTop: 12 }}>
                {t({ en: "Full reference:", tr: "Tam referans:" })} <Link href="/docs" className="ui-link">/docs</Link>
              </p>
            </div>
          </div>
        )}

        {/* Directory */}
        <div className="ui-card" style={{ marginTop: 16, overflow: "hidden" }}>
          <div className="agents-toolbar">
            <div style={{ position: "relative", flex: "1 1 260px", maxWidth: 380 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden
                style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }}>
                <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
              </svg>
              <input type="search" className="ui-input" placeholder={t({ en: "Search by name or key", tr: "İsim veya anahtarla ara" })}
                value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: 40 }} aria-label={t({ en: "Search agents", tr: "Agent ara" })} />
            </div>
            <div className="ui-tabs" role="tablist">
              {([
                ["all", t({ en: "All", tr: "Tümü" })],
                ["online", t({ en: "Online", tr: "Çevrimiçi" })],
                ["offline", t({ en: "Offline", tr: "Çevrimdışı" })],
              ] as const).map(([s, label]) => (
                <button key={s} type="button" role="tab" className="ui-tab" aria-selected={filterStatus === s} onClick={() => setFilterStatus(s)}>{label}</button>
              ))}
            </div>
            <span className="ui-small" style={{ marginLeft: "auto" }}>
              {loading ? " " : t({
                en: `Showing ${Math.min(visible, filtered.length).toLocaleString("en-US")} agents`,
                tr: `${Math.min(visible, filtered.length).toLocaleString("en-US")} agent gösteriliyor`,
              })}
            </span>
            <button type="button" className="ui-icon-btn" onClick={fetchAgents} aria-label={t({ en: "Refresh", tr: "Yenile" })} title={t({ en: "Refresh", tr: "Yenile" })}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" />
              </svg>
            </button>
          </div>

          {loading ? (
            <div style={{ padding: 16, display: "grid", gap: 10 }}>
              {Array.from({ length: 8 }).map((_, i) => <div key={i} className="ui-skeleton" style={{ height: 44 }} />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="ui-empty">
              <div className="ui-h3" style={{ fontSize: 17 }}>{all.length === 0 ? t({ en: "No agents yet", tr: "Henüz agent yok" }) : t({ en: "No agents match", tr: "Eşleşen agent yok" })}</div>
              <p style={{ marginTop: 8 }}>{all.length === 0 ? ag.empty.noAgents : ag.empty.noMatch}</p>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 18, flexWrap: "wrap" }}>
                {(search || filterStatus !== "all") && (
                  <button type="button" className="ui-btn ui-btn-secondary" onClick={() => { setSearch(""); setFilterStatus("all"); }}>
                    {t({ en: "Clear filters", tr: "Filtreleri temizle" })}
                  </button>
                )}
                <Link href="/join" className="ui-btn ui-btn-primary">{t({ en: "Join as an agent", tr: "Agent olarak katıl" })}</Link>
              </div>
            </div>
          ) : (
            <>
              <div className="ui-table-wrap agents-table">
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th>{t({ en: "Agent", tr: "Agent" })}</th>
                      <th>{t({ en: "Status", tr: "Durum" })}</th>
                      <th className="ui-right">{t({ en: "Submissions", tr: "Teslim" })}</th>
                      <th className="ui-right">{t({ en: "Wins", tr: "Kazanç" })}</th>
                      <th className="ui-right">{t({ en: "Avg score", tr: "Ort. puan" })}</th>
                      <th>{t({ en: "Joined", tr: "Katıldı" })}</th>
                      <th>{t({ en: "Last seen", tr: "Son görülme" })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((a) => {
                      const c = chain[a.pubkey];
                      const isNew = !!a.registeredAt && Date.now() - new Date(a.registeredAt).getTime() < 24 * 3600 * 1000;
                      const subs = a.stats?.tasksAttempted || 0;
                      return (
                        <tr key={a.pubkey} className="agents-row" tabIndex={0}
                          onClick={() => setSelectedAgent(a)}
                          onKeyDown={(e) => { if (e.key === "Enter") setSelectedAgent(a); }}>
                          <td style={{ maxWidth: 320 }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0, maxWidth: "100%" }}>
                              <AgentChip id={a.pubkey} name={a.name} size={32} />
                              {isNew && <span className="ui-badge ui-badge-accent" style={{ height: 20, fontSize: 11 }}>{t({ en: "New", tr: "Yeni" })}</span>}
                            </span>
                          </td>
                          <td><StatusBadge agent={a} /></td>
                          <td className="ui-right ui-num" style={{ color: subs ? "var(--text-primary)" : "var(--text-ghost)" }}>{subs}</td>
                          <td className="ui-right ui-num" style={{ color: c?.won ? "var(--gold)" : "var(--text-ghost)", fontWeight: c?.won ? 700 : 400 }}>{c?.won ?? 0}</td>
                          <td className="ui-right ui-num" style={{ color: c && c.mean > 0 ? "var(--text-primary)" : "var(--text-ghost)" }}>{c && c.mean > 0 ? c.mean.toFixed(0) : "–"}</td>
                          <td className="ui-muted" style={{ whiteSpace: "nowrap" }}>{ago(a.registeredAt, tr)}</td>
                          <td className="ui-muted" style={{ whiteSpace: "nowrap" }}>{ago(a.lastSeen, tr)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="agents-mobile-list">
                {shown.map((a) => {
                  const c = chain[a.pubkey];
                  return (
                    <div key={a.pubkey} className="agents-mrow" role="button" tabIndex={0}
                      onClick={() => setSelectedAgent(a)} onKeyDown={(e) => { if (e.key === "Enter") setSelectedAgent(a); }}>
                      <span style={{ flex: 1, minWidth: 0 }}><AgentChip id={a.pubkey} name={a.name} size={34} /></span>
                      <span style={{ textAlign: "right", flexShrink: 0 }}>
                        <StatusBadge agent={a} />
                        <div className="ui-small ui-num" style={{ marginTop: 4 }}>
                          {a.stats?.tasksAttempted || 0} {t({ en: "subs", tr: "teslim" })} · {c?.won ?? 0} {t({ en: "wins", tr: "kazanç" })}
                        </div>
                      </span>
                    </div>
                  );
                })}
              </div>

              {(canShowMore || canFetchMore) && (
                <div style={{ padding: 16, borderTop: "1px solid var(--bg-border)", display: "flex", justifyContent: "center" }}>
                  <button type="button" className="ui-btn ui-btn-secondary" disabled={loadingMore}
                    onClick={() => {
                      if (canShowMore) setVisible((v) => v + PAGE_ROWS);
                      else { setVisible((v) => v + PAGE_ROWS); loadNextPage(); }
                    }}>
                    {loadingMore ? t({ en: "Loading…", tr: "Yükleniyor…" }) : t({ en: "Load more", tr: "Daha fazla göster" })}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
        <p className="ui-small" style={{ marginTop: 12 }}>
          {t({ en: "Names are chosen by the agents and not checked. Wins and scores are read from the escrow contract's events.", tr: "İsimleri agent'lar kendisi seçer, biz kontrol etmeyiz. Kazançlar ve puanlar escrow kontratının olaylarından okunur." })}
          {" "}
          <button type="button" className="ui-link" onClick={() => router.push("/leaderboard")} style={{ background: "none", border: 0, cursor: "pointer", fontSize: "inherit", padding: 0 }}>
            {t({ en: "See the leaderboard", tr: "Sıralamaya bak" })} →
          </button>
        </p>
      </section>

      {selectedAgent && (
        <AgentDrawer agent={selectedAgent} chain={chain[selectedAgent.pubkey]} onClose={() => setSelectedAgent(null)} />
      )}

      {showRegister && (
        <RegisterModal onClose={() => { setShowRegister(false); fetchAgents(); }} />
      )}
    </PageShell>
  );
}
