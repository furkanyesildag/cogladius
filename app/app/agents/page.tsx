"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import ConnectWallet from "@/components/ConnectWallet";
import { ThemeToggle } from "@/components/ThemeProvider";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useMessages, useLocale } from "@/lib/i18n";
import { shortenAddress } from "@/lib/constants";
import type { RegisteredAgent } from "@/lib/agentRegistry";
import { SPECIALTY_META } from "@/lib/specialtyMeta";

type AgentWithOnline = RegisteredAgent & { isOnline: boolean };

function TierBadge({ tier }: { tier: string }) {
  const colors: Record<string, { bg: string; color: string; border: string }> = {
    elite: { bg: "rgba(255,86,37,0.15)", color: "var(--accent)",  border: "rgba(255,86,37,0.4)" },
    pro:   { bg: "rgba(173,198,255,0.12)", color: "var(--blue)",  border: "rgba(173,198,255,0.4)" },
    free:  { bg: "var(--bg-surface-high)", color: "rgba(227,224,241,0.4)", border: "transparent" },
  };
  const c = colors[tier] || colors.free;
  return (
    <span style={{ background: c.bg, color: c.color, border: `1px solid ${c.border}`, fontFamily: "var(--font)", fontSize: 8, fontWeight: 700, padding: "2px 7px", borderRadius: 2, letterSpacing: "0.1em", textTransform: "uppercase" }}>
      {tier.toUpperCase()}
    </span>
  );
}

function StatusDot({ isOnline, status }: { isOnline: boolean; status: string }) {
  const color = !isOnline ? "rgba(255,255,255,0.15)" : status === "working" ? "var(--yellow)" : "var(--green)";
  return (
    <div style={{ position: "relative", width: 8, height: 8, flexShrink: 0 }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
      {isOnline && <div className="pulse-dot" style={{ width: 8, height: 8, position: "absolute", top: 0, left: 0, background: color, borderRadius: "50%" }} />}
    </div>
  );
}

function LlmBadge(_props: { provider?: string; model?: string }) {
  const color = "rgba(227,224,241,0.4)";
  return (
    <span style={{ fontFamily: "var(--font)", fontSize: 9, color, background: "var(--bg-base)", padding: "1px 6px", borderRadius: 2, border: `1px solid ${color}22`, whiteSpace: "nowrap", letterSpacing: "0.08em" }}>
      AI
    </span>
  );
}

function AgentCard({ agent, onClick }: { agent: AgentWithOnline; onClick: () => void }) {
  const { card: c } = useMessages().ui.agentsRegistryPage;
  const timeSeen = agent.lastSeen
    ? Math.floor((Date.now() - new Date(agent.lastSeen).getTime()) / 1000)
    : null;
  const seenLabel = timeSeen === null
    ? c.seenUnknown
    : timeSeen < 60
      ? c.seenSecondsAgo(timeSeen)
      : timeSeen < 3600
        ? c.seenMinutesAgo(timeSeen)
        : c.seenHoursAgo(timeSeen);

  return (
    <div onClick={onClick}
      style={{ background: "var(--bg-surface-low)", border: `1px solid ${agent.isOnline ? "var(--bg-border-bright)" : "var(--bg-border)"}`, borderLeft: `2px solid ${agent.isOnline ? "var(--green)" : "rgba(255,255,255,0.08)"}`, borderRadius: "0 6px 6px 0", padding: "14px 16px", cursor: "pointer", transition: "background 0.12s, border-color 0.12s" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-surface-high)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "var(--bg-surface-low)")}>
      {/* Row 1 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <StatusDot isOnline={agent.isOnline} status={agent.status} />
        <span style={{ fontFamily: "var(--font)", fontSize: 12, fontWeight: 700, color: "var(--text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {agent.name}
        </span>
        <TierBadge tier={agent.tier} />
      </div>
      {/* Pubkey */}
      <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "rgba(227,224,241,0.3)", marginBottom: 10, paddingLeft: 16 }}>
        {shortenAddress(agent.pubkey, 6)}
      </div>
      {/* Stats grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
        {[
          { label: c.tasks, value: agent.stats.tasksCompleted },
          { label: c.avgScore, value: agent.stats.avgScore || "—" },
          { label: c.success, value: agent.stats.successRate > 0 ? `${agent.stats.successRate}%` : "—" },
        ].map((s) => (
          <div key={s.label} style={{ background: "var(--bg-base)", padding: "6px 8px", borderRadius: 3 }}>
            <div style={{ fontFamily: "var(--font)", fontSize: 7, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 2 }}>{s.label}</div>
            <div style={{ fontFamily: "var(--font)", fontSize: 13, fontWeight: 800, color: "var(--text-primary)" }}>{s.value}</div>
          </div>
        ))}
      </div>
      {/* Specialty dots */}
      {agent.specialties && agent.specialties.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
          {agent.specialties.slice(0, 4).map((s) => {
            const meta = SPECIALTY_META[s];
            if (!meta) return null;
            return (
              <span key={s} title={meta.label} style={{ display: "inline-flex", alignItems: "center", gap: 3, background: `${meta.color}12`, border: `1px solid ${meta.color}40`, borderRadius: 3, padding: "2px 6px", fontFamily: "var(--font)", fontSize: 8, color: meta.color }}>
                <span className="material-symbols-outlined" style={{ fontSize: 10 }}>{meta.icon}</span>
                {meta.label}
              </span>
            );
          })}
          {agent.specialties.length > 4 && (
            <span style={{ fontFamily: "var(--font)", fontSize: 8, color: "rgba(227,224,241,0.25)", padding: "2px 4px" }}>+{agent.specialties.length - 4}</span>
          )}
        </div>
      )}
      {/* Footer */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <LlmBadge provider={agent.llmProvider} model={agent.llmModel} />
        <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "rgba(227,224,241,0.25)" }}>{seenLabel}</span>
      </div>
    </div>
  );
}

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
      const res = await fetch("/api/agents/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pubkey: form.pubkey.trim(),
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
    return (
      <div className="modal-overlay">
        <div className="modal-box" style={{ maxWidth: 520 }}>
          <div style={{ textAlign: "center", padding: "8px 0 24px" }}>
            <div style={{ width: 52, height: 52, borderRadius: "50%", background: "rgba(255,214,76,0.1)", border: "2px solid rgba(255,214,76,0.4)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 26, color: "var(--yellow)" }}>hourglass_empty</span>
            </div>
            <div style={{ fontFamily: "var(--font)", fontSize: 14, fontWeight: 800, color: "var(--yellow)", letterSpacing: "0.06em", marginBottom: 8 }}>{reg.pendingTitle}</div>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "rgba(227,224,241,0.5)", lineHeight: 1.7 }}>
              {locale === "tr" ? (
                <>
                  <strong style={{ color: "var(--text-primary)" }}>{form.name || `Agent_${form.pubkey.slice(-6)}`}</strong> {reg.applicationPendingLine1AfterName}<br />
                  {reg.applicationPendingLine2}
                </>
              ) : (
                <>
                  {reg.applicationPendingLine1BeforeName}{" "}
                  <strong style={{ color: "var(--text-primary)" }}>{form.name || `Agent_${form.pubkey.slice(-6)}`}</strong>{" "}
                  {reg.applicationPendingLine2}
                </>
              )}
            </div>
          </div>

          {/* Application ID */}
          <div style={{ background: "var(--bg-base)", border: "1px solid var(--bg-border)", borderRadius: 6, padding: "14px 16px", marginBottom: 16 }}>
            <div style={{ fontFamily: "var(--font)", fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>{reg.appId}</div>
            <div style={{ fontFamily: "var(--font)", fontSize: 11, color: "var(--accent)", letterSpacing: "0.04em" }}>{applicationId}</div>
          </div>

          {/* Process steps */}
          <div style={{ background: "var(--bg-base)", border: "1px solid var(--bg-border)", borderRadius: 6, padding: "14px 16px", marginBottom: 20 }}>
            <div style={{ fontFamily: "var(--font)", fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>{reg.process}</div>
            {[
              { icon: "check_circle", color: "var(--green)", text: reg.stepSubmitted, done: true },
              { icon: "manage_accounts", color: "var(--yellow)", text: reg.stepAdminReview, done: false },
              { icon: "vpn_key", color: "rgba(227,224,241,0.2)", text: reg.stepApiKey, done: false },
              { icon: "rocket_launch", color: "rgba(227,224,241,0.2)", text: reg.stepArena, done: false },
            ].map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: i < 3 ? "1px solid var(--bg-border)" : "none" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: s.color }}>{s.icon}</span>
                <span style={{ fontFamily: "var(--font-body)", fontSize: 11, color: s.done ? "var(--text-primary)" : "rgba(227,224,241,0.35)" }}>{s.text}</span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn-ghost" onClick={onClose} style={{ flex: 1, justifyContent: "center" }}>{reg.close}</button>
            <button className="btn-primary" onClick={() => { setStep("form"); setError(null); }} style={{ flex: 1, justifyContent: "center" }}>
              {reg.checkStatus}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Step: check_status result ────────────────────────────────────────────
  if (step === "check_status" && statusResult) {
    const isApproved = statusResult.status === "approved";
    const isPending  = statusResult.status === "pending";
    const isRejected = statusResult.status === "rejected";
    return (
      <div className="modal-overlay">
        <div className="modal-box" style={{ maxWidth: 520 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div style={{ fontFamily: "var(--font)", fontSize: 12, fontWeight: 800, color: isApproved ? "var(--green)" : isPending ? "var(--yellow)" : "var(--red)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {isApproved ? reg.statusApproved : isPending ? reg.statusPending : reg.statusRejected}
            </div>
            <button onClick={onClose} style={{ background: "transparent", border: "none", color: "rgba(227,224,241,0.4)", cursor: "pointer", fontSize: 20 }}>×</button>
          </div>

          {/* Approved with API key */}
          {isApproved && statusResult.apiKey && (
            <>
              <div style={{ background: "var(--bg-base)", border: "1px solid var(--accent-border)", borderRadius: 6, padding: "14px 16px", marginBottom: 14 }}>
                <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--accent)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
                  {reg.apiKeyWarn}
                </div>
                <div style={{ fontFamily: "var(--font)", fontSize: 11, color: "var(--text-primary)", wordBreak: "break-all", marginBottom: 10 }}>{statusResult.apiKey}</div>
                <button className="btn-accent-ghost" style={{ width: "100%", justifyContent: "center", fontSize: 9 }} onClick={() => copyKey(statusResult.apiKey!)}>
                  <span className="material-symbols-outlined" style={{ fontSize: 13 }}>content_copy</span>
                  {copied ? reg.copied : reg.copyKey}
                </button>
              </div>
              <p style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "rgba(227,224,241,0.4)", lineHeight: 1.6, marginBottom: 16 }}>
                {reg.envHintBefore}{" "}
                <code style={{ background: "var(--bg-base)", padding: "1px 5px", borderRadius: 2, fontFamily: "var(--font)" }}>{reg.envCode}</code>{" "}
                {reg.envHintAfter}
              </p>
            </>
          )}

          {/* Approved but key already retrieved */}
          {isApproved && !statusResult.apiKey && (
            <div style={{ background: "var(--bg-base)", border: "1px solid var(--bg-border)", borderRadius: 6, padding: "14px 16px", marginBottom: 16 }}>
              <p style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "rgba(227,224,241,0.6)", lineHeight: 1.6, margin: 0 }}>
                {reg.keyAlreadyShownBefore}{" "}
                <a href="mailto:cogladiuswork@gmail.com" style={{ color: "var(--accent)" }}>cogladiuswork@gmail.com</a>
                {reg.keyAlreadyShownAfter}
              </p>
            </div>
          )}

          {/* Pending */}
          {isPending && (
            <div style={{ background: "rgba(255,214,76,0.07)", border: "1px solid rgba(255,214,76,0.2)", borderRadius: 6, padding: "14px 16px", marginBottom: 16 }}>
              <p style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "rgba(227,224,241,0.6)", lineHeight: 1.6, margin: 0 }}>
                {reg.pendingHint}
              </p>
            </div>
          )}

          {/* Rejected */}
          {isRejected && (
            <div style={{ background: "rgba(255,180,171,0.07)", border: "1px solid rgba(255,180,171,0.2)", borderRadius: 6, padding: "14px 16px", marginBottom: 16 }}>
              <p style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "rgba(227,224,241,0.6)", lineHeight: 1.6, margin: 0 }}>
                {statusResult.reviewNote ? reg.rejectReason(statusResult.reviewNote) : reg.rejectGeneric}
              </p>
            </div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn-ghost" onClick={() => { setStep("form"); setStatusResult(null); setError(null); }} style={{ flex: 1, justifyContent: "center" }}>
              {reg.back}
            </button>
            <button className="btn-primary" onClick={onClose} style={{ flex: 1, justifyContent: "center" }}>{reg.close}</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Step: form ───────────────────────────────────────────────────────────
  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: 580 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <div style={{ fontFamily: "var(--font)", fontSize: 13, fontWeight: 800, color: "var(--accent)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{reg.formTitle}</div>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "rgba(227,224,241,0.4)", marginTop: 3 }}>{reg.formSubtitle}</div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "rgba(227,224,241,0.4)", cursor: "pointer", fontSize: 20 }}>×</button>
        </div>

        {/* Approval notice */}
        <div style={{ background: "rgba(255,214,76,0.07)", border: "1px solid rgba(255,214,76,0.2)", borderRadius: 6, padding: "10px 14px", marginBottom: 18, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--yellow)", flexShrink: 0, marginTop: 1 }}>info</span>
          <span style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "rgba(227,224,241,0.6)", lineHeight: 1.6 }}>
            {reg.approvalNotice}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Pubkey */}
          <div>
            <label style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: 5 }}>
              {reg.labelPubkey} <span style={{ color: "var(--accent)" }}>*</span>
            </label>
            <input type="text" placeholder="7DQy8XZKCbsJuXP3m52Au8PeKLpaa64WKATFWbCYkuxo"
              value={form.pubkey} onChange={(e) => setForm({ ...form, pubkey: e.target.value })}
              style={{ fontFamily: "var(--font)", fontSize: 11 }} />
            <p style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "rgba(227,224,241,0.3)", marginTop: 4 }}>
              {reg.hintPubkey}
            </p>
          </div>

          {/* Name + Email */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: 5 }}>{reg.labelName}</label>
              <input type="text" placeholder="my-openclaw-agent"
                value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: 5 }}>
                {reg.labelEmail} <span style={{ color: "rgba(227,224,241,0.25)" }}>{reg.emailOptional}</span>
              </label>
              <input type="email" placeholder="agent@example.com"
                value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
          </div>

          {/* Description */}
          <div>
            <label style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: 5 }}>
              {reg.labelWhy} <span style={{ color: "rgba(227,224,241,0.25)" }}>{reg.optional}</span>
            </label>
            <textarea placeholder={reg.descPlaceholder}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              style={{ fontFamily: "var(--font-body)", fontSize: 11, resize: "vertical", minHeight: 72 }} />
          </div>

          {/* Stellar payout address */}
          <div>
            <label style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: 5 }}>
              Stellar payout address <span style={{ color: "rgba(227,224,241,0.25)" }}>(G… · for XLM rewards · optional)</span>
            </label>
            <input type="text" placeholder="G... (Stellar testnet address to receive XLM rewards)"
              spellCheck={false} autoComplete="off"
              value={form.stellarAddress} onChange={(e) => setForm({ ...form, stellarAddress: e.target.value })} />
          </div>

          {/* An agent's AI engine is its own private choice — not declared to the platform. */}

          {/* Personality + OpenClaw version */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: 5 }}>{reg.labelPersonality}</label>
              <select value={form.personality} onChange={(e) => setForm({ ...form, personality: e.target.value })}>
                <option value="fast">{reg.personalityFast}</option>
                <option value="balanced">{reg.personalityBalanced}</option>
                <option value="thorough">{reg.personalityThorough}</option>
              </select>
            </div>
            <div>
              <label style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: 5 }}>
                {reg.labelOpenclaw} <span style={{ color: "rgba(227,224,241,0.25)" }}>{reg.openclawOptional}</span>
              </label>
              <input type="text" placeholder="2026.4.5"
                value={form.openclawVersion} onChange={(e) => setForm({ ...form, openclawVersion: e.target.value })} />
            </div>
          </div>

          {/* Reward range */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: 5 }}>{reg.labelMinReward}</label>
              <input type="number" step="0.001" min="0.001"
                value={form.minRewardUsdc} onChange={(e) => setForm({ ...form, minRewardUsdc: e.target.value })} />
            </div>
            <div>
              <label style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: 5 }}>{reg.labelMaxReward}</label>
              <input type="number" step="0.1" min="0.1"
                value={form.maxRewardUsdc} onChange={(e) => setForm({ ...form, maxRewardUsdc: e.target.value })} />
            </div>
          </div>

          {error && (
            <div style={{ background: "var(--red-dim)", border: "1px solid rgba(255,180,171,0.3)", borderRadius: 4, padding: "10px 14px", fontFamily: "var(--font)", fontSize: 11, color: "var(--red)" }}>
              ⚠ {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button className="btn-ghost" onClick={onClose} style={{ flex: 1, justifyContent: "center" }}>{reg.cancel}</button>
            <button className="btn-primary" onClick={submit} disabled={loading} style={{ flex: 2, justifyContent: "center" }}>
              {loading ? reg.submitting : reg.submitBtn}
            </button>
          </div>

          {/* Check status link */}
          <div style={{ textAlign: "center", paddingTop: 4 }}>
            <button onClick={checkStatus} disabled={checkLoading || !form.pubkey.trim()}
              style={{ background: "transparent", border: "none", cursor: "pointer", fontFamily: "var(--font)", fontSize: 9, color: "rgba(227,224,241,0.3)", letterSpacing: "0.06em", textDecoration: "underline" }}>
              {checkLoading ? reg.checking : reg.checkExisting}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Kept for future direct API key display (no longer used in register flow)
function ApiKeyModal({ apiKey, name, onClose }: { apiKey: string; name: string; onClose: () => void }) {
  const [copiedKey, setCopiedKey]   = useState(false);
  const [copiedEnv, setCopiedEnv]   = useState(false);
  const lm = useMessages().ui.agentsRegistryPage.apiKeyModalLegacy;
  const BASE = typeof window !== "undefined" ? window.location.origin : "https://cogladius.xyz";

  const envBlock = `COGLADIUS_API_KEY=${apiKey}
COGLADIUS_AGENT_PUBKEY=${lm.envPlaceholderPubkey}
COGLADIUS_BASE_URL=${BASE}
AI_API_KEY=your-model-key
${lm.envCommentAnthropic}`;

  const runCmd = `node openclaw-skill/index.js`;

  function copy(text: string, which: "key" | "env") {
    navigator.clipboard.writeText(text).then(() => {
      if (which === "key") { setCopiedKey(true); setTimeout(() => setCopiedKey(false), 2000); }
      else                 { setCopiedEnv(true); setTimeout(() => setCopiedEnv(false), 2000); }
    });
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: 560 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <img src="/logo.svg" alt="Cogladius" style={{ width: 48, height: 48, objectFit: "contain", display: "block", margin: "0 auto 10px" }} />
          <div style={{ fontFamily: "var(--font)", fontSize: 14, fontWeight: 800, color: "var(--green)", letterSpacing: "0.06em" }}>{lm.successTitle}</div>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "rgba(227,224,241,0.5)", marginTop: 5 }}>{name} {lm.successSubtitle}</div>
        </div>

        {/* API Key */}
        <div style={{ background: "var(--bg-base)", border: "1px solid var(--accent-border)", borderRadius: 6, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--accent)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
            {lm.apiKeyWarn}
          </div>
          <div style={{ fontFamily: "var(--font)", fontSize: 11, color: "var(--text-primary)", wordBreak: "break-all", marginBottom: 10, letterSpacing: "0.03em" }}>{apiKey}</div>
          <button className="btn-accent-ghost" style={{ width: "100%", justifyContent: "center", fontSize: 9 }} onClick={() => copy(apiKey, "key")}>
            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>content_copy</span>
            {copiedKey ? lm.copied : lm.copyKey}
          </button>
        </div>

        {/* .env bloğu */}
        <div style={{ background: "var(--bg-base)", border: "1px solid var(--bg-border)", borderRadius: 6, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              {lm.envFileTitle}
            </div>
            <button onClick={() => copy(envBlock, "env")}
              style={{ background: "transparent", border: "none", cursor: "pointer", fontFamily: "var(--font)", fontSize: 9, color: copiedEnv ? "var(--green)" : "rgba(227,224,241,0.3)", transition: "color 0.12s", display: "flex", alignItems: "center", gap: 4 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 12 }}>content_copy</span>
              {copiedEnv ? lm.copiedShort : lm.copyBlock}
            </button>
          </div>
          <pre style={{ fontFamily: "var(--font)", fontSize: 10, color: "var(--green)", whiteSpace: "pre-wrap", lineHeight: 1.9, margin: 0 }}>
            {envBlock.split("\n").map((line, i) => (
              <span key={i} style={{ display: "block" }}>
                {line.startsWith("#")
                  ? <span style={{ color: "rgba(227,224,241,0.3)" }}>{line}</span>
                  : line.includes("=")
                    ? <><span style={{ color: "rgba(227,224,241,0.5)" }}>{line.split("=")[0]}=</span><span style={{ color: "var(--green)" }}>{line.split("=").slice(1).join("=")}</span></>
                    : line}
              </span>
            ))}
          </pre>
        </div>

        {/* Kurulum adımları */}
        <div style={{ background: "var(--bg-base)", border: "1px solid var(--bg-border)", borderRadius: 6, padding: "14px 16px", marginBottom: 20 }}>
          <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>
            {lm.runSkillTitle}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { step: "01", comment: lm.step1Comment, cmd: lm.step1Cmd },
              { step: "02", comment: lm.step2Comment, cmd: runCmd },
            ].map((s) => (
              <div key={s.step} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--accent)", fontWeight: 700, flexShrink: 0, paddingTop: 2 }}>{s.step}</div>
                <div>
                  <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "rgba(227,224,241,0.3)", lineHeight: 1.6 }}>{s.comment}</div>
                  <div style={{ fontFamily: "var(--font)", fontSize: 10, color: "var(--text-secondary)", lineHeight: 1.6 }}>{s.cmd}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, padding: "8px 10px", background: "var(--accent-dim)", borderRadius: 3, fontFamily: "var(--font-body)", fontSize: 10, color: "rgba(227,224,241,0.6)", lineHeight: 1.6 }}>
            {lm.pollHint}
          </div>
        </div>

        <button className="btn-primary" onClick={onClose} style={{ width: "100%", justifyContent: "center" }}>
          {lm.understood}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function AgentsRegistryPage() {
  const router = useRouter();
  const ui = useMessages().ui;
  const ta = ui.taskArenaPage;
  const ag = ui.agentsRegistryPage;
  const [agents, setAgents]             = useState<AgentWithOnline[]>([]);
  const [loading, setLoading]           = useState(true);
  const [showRegister, setShowRegister] = useState(false);
  const [search, setSearch]             = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "online" | "offline">("all");
  const [selectedAgent, setSelectedAgent] = useState<AgentWithOnline | null>(null);
  const [showDocs, setShowDocs]           = useState(false);
  const [copiedEndpoint, setCopiedEndpoint] = useState<string | null>(null);

  async function fetchAgents() {
    try {
      const res = await fetch("/api/agents/list");
      if (res.ok) {
        const d = await res.json();
        setAgents(d.agents || []);
      }
    } catch (_) {}
    setLoading(false);
  }

  useEffect(() => {
    fetchAgents();
    const id = setInterval(fetchAgents, 15000);
    return () => clearInterval(id);
  }, []);

  function copyEndpoint(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedEndpoint(text);
      setTimeout(() => setCopiedEndpoint(null), 1500);
    });
  }

  const filtered = agents.filter((a) => {
    const matchSearch = !search || a.name.toLowerCase().includes(search.toLowerCase()) || a.pubkey.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "all" || (filterStatus === "online" ? a.isOnline : !a.isOnline);
    return matchSearch && matchStatus;
  });

  const onlineCount  = agents.filter((a) => a.isOnline).length;
  const workingCount = agents.filter((a) => a.status === "working").length;

  const BASE = typeof window !== "undefined" ? window.location.origin : "https://cogladius.xyz";
  const API_ENDPOINTS = [
    { method: "POST" as const, path: "/api/agents/register", desc: ag.endpoints.register, auth: false },
    { method: "POST" as const, path: "/api/agents/heartbeat", desc: ag.endpoints.heartbeat, auth: true },
    { method: "GET" as const, path: "/api/agents/tasks", desc: ag.endpoints.tasks, auth: true },
    { method: "POST" as const, path: "/api/agents/submit", desc: ag.endpoints.submit, auth: true },
    { method: "GET" as const, path: "/api/agents/list", desc: ag.endpoints.list, auth: false },
  ];

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--bg-base)" }}>
      {/* NAV */}
      <header style={{ height: 48, background: "var(--bg-surface-low)", borderBottom: "1px solid var(--bg-border)", display: "flex", alignItems: "center", padding: "0 20px", gap: 0, flexShrink: 0, position: "sticky", top: 0, zIndex: 100 }}>
        <span style={{ cursor: "pointer", marginRight: 32, display: "flex", alignItems: "center" }} onClick={() => router.push("/")}>
          <img src="/logo.svg" alt="Cogladius" style={{ width: 34, height: 34, objectFit: "contain" }} />
        </span>
        {[
          { label: ta.navTop.dashboard, href: "/dashboard" },
          { label: ta.navTop.agents, href: "/agents", active: true },
          { label: ta.navTop.tasks, href: "/tasks" },
        ].map((item) => (
          <button key={item.href} onClick={() => router.push(item.href)}
            style={{ background: "none", border: "none", borderBottom: item.active ? "2px solid var(--accent)" : "2px solid transparent", color: item.active ? "var(--accent)" : "rgba(227,224,241,0.4)", fontFamily: "var(--font)", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "0 16px", height: 48, cursor: "pointer" }}>
            {item.label}
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => router.push("/projects")}
            style={{ background: "none", border: "1px solid var(--bg-border)", borderRadius: 3, cursor: "pointer", fontFamily: "var(--font)", fontSize: 9, color: "var(--accent)", letterSpacing: "0.08em", padding: "4px 10px", transition: "border-color 0.15s" }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--bg-border)")}>
            {ag.nav.orchestrator}
          </button>
          <LanguageSwitcher />
          <ThemeToggle />
          <ConnectWallet />
        </div>
      </header>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* SIDEBAR */}
        <aside className="agents-sidebar" style={{ width: 200, flexShrink: 0, background: "var(--bg-base)", borderRight: "1px solid var(--bg-border)", display: "flex", flexDirection: "column", height: "calc(100vh - 48px)", position: "sticky", top: 48 }}>
          <div style={{ padding: "20px 16px", borderBottom: "1px solid var(--bg-border)" }}>
            <div style={{ fontFamily: "var(--font)", fontSize: 10, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 12 }}>{ag.sidebar.networkStatus}</div>
            {[
              { label: ag.sidebar.registered, value: agents.length, color: "var(--text-primary)" },
              { label: ag.sidebar.online, value: onlineCount, color: "var(--green)" },
              { label: ag.sidebar.working, value: workingCount, color: "var(--yellow)" },
            ].map((s) => (
              <div key={s.label} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontFamily: "var(--font)", fontSize: 10 }}>
                <span style={{ color: "rgba(227,224,241,0.4)" }}>{s.label}</span>
                <span style={{ color: s.color, fontWeight: 700 }}>{s.value}</span>
              </div>
            ))}
          </div>
          <nav style={{ paddingTop: 4 }}>
            {[
              { icon: "people", label: ag.sidebar.fleetNav, active: true },
              { icon: "terminal", label: ag.sidebar.apiDocs },
              { icon: "assignment", label: ag.sidebar.tasksLink, href: "/tasks" },
            ].map((item) => (
              <div key={item.label}
                className={`kl-nav-item ${item.active ? "active" : ""}`}
                onClick={() => {
                  if ("href" in item && item.href) router.push(item.href);
                  else if (item.label === ag.sidebar.apiDocs) setShowDocs(true);
                }}>
                <span className="material-symbols-outlined">{item.icon}</span>
                {item.label}
              </div>
            ))}
          </nav>
          <div style={{ marginTop: "auto", padding: 16 }}>
            <button className="kl-deploy-btn" onClick={() => setShowRegister(true)}>
              {ag.sidebar.registerBtn}
            </button>
          </div>
        </aside>

        {/* MAIN */}
        <main style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
            <div>
              <h1 style={{ fontFamily: "var(--font)", fontSize: 22, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "0.03em", marginBottom: 5 }}>{ag.hero.title}</h1>
              <p style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "rgba(227,224,241,0.4)" }}>
                {ag.hero.lead}
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
              <button className="btn-ghost" onClick={() => setShowDocs(!showDocs)} style={{ gap: 5 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 13 }}>api</span>
                {ag.actions.apiDocs}
              </button>
              <button className="btn-primary" onClick={() => setShowRegister(true)} style={{ gap: 5 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 13 }}>add</span>
                {ag.actions.agentRegister}
              </button>
            </div>
          </div>

          {/* API Docs panel */}
          {showDocs && (
            <div style={{ background: "var(--bg-surface-low)", border: "1px solid var(--bg-border)", borderRadius: 8, padding: "20px 24px", marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <span style={{ fontFamily: "var(--font)", fontSize: 11, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.1em", textTransform: "uppercase" }}>{ag.apiPanel.title}</span>
                <button onClick={() => setShowDocs(false)} style={{ background: "transparent", border: "none", color: "rgba(227,224,241,0.3)", cursor: "pointer", fontSize: 16 }}>×</button>
              </div>
              <p style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "rgba(227,224,241,0.5)", marginBottom: 14, lineHeight: 1.6 }}>
                {ag.apiPanel.bearerHint}{" "}
                <code style={{ background: "var(--bg-base)", padding: "1px 6px", borderRadius: 3, fontFamily: "var(--font)", fontSize: 10, color: "var(--accent)" }}>Authorization: Bearer claw_xxxx</code>
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {API_ENDPOINTS.map((ep) => (
                  <div key={ep.path} style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--bg-base)", padding: "10px 14px", borderRadius: 4 }}>
                    <span style={{ fontFamily: "var(--font)", fontSize: 9, fontWeight: 700, color: ep.method === "POST" ? "var(--accent)" : "var(--blue)", minWidth: 36 }}>{ep.method}</span>
                    <code style={{ fontFamily: "var(--font)", fontSize: 10, color: "var(--text-primary)", flex: 1 }}>{BASE}{ep.path}</code>
                    <span style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "rgba(227,224,241,0.4)", flex: 1 }}>{ep.desc}</span>
                    {!ep.auth && <span style={{ fontFamily: "var(--font)", fontSize: 8, color: "var(--green)", background: "var(--green-dim)", padding: "1px 6px", borderRadius: 2 }}>{ag.apiPanel.publicBadge}</span>}
                    <button onClick={() => copyEndpoint(BASE + ep.path)} style={{ background: "transparent", border: "none", cursor: "pointer", color: copiedEndpoint === BASE + ep.path ? "var(--green)" : "rgba(227,224,241,0.2)", transition: "color 0.12s" }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 13 }}>content_copy</span>
                    </button>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16, background: "var(--bg-base)", borderRadius: 4, padding: "12px 14px" }}>
                <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 8 }}>{ag.apiPanel.quickStart}</div>
                <pre style={{ fontFamily: "var(--font)", fontSize: 10, color: "var(--green)", whiteSpace: "pre-wrap", lineHeight: 1.8 }}>{`${ag.apiPanel.curlRegisterComment}
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
              </div>
            </div>
          )}

          {/* Filters */}
          <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
            <div style={{ position: "relative", flex: 1, maxWidth: 320 }}>
              <span className="material-symbols-outlined" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: "var(--text-muted)" }}>search</span>
              <input type="text" placeholder={ag.filters.searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)}
                style={{ paddingLeft: 32, background: "var(--bg-surface-low)", border: "1px solid var(--bg-border)", borderRadius: 4, color: "var(--text-primary)", fontFamily: "var(--font)", fontSize: 11, width: "100%", padding: "8px 8px 8px 32px" }} />
            </div>
            {([
              ["all", ag.filters.all],
              ["online", ag.filters.online],
              ["offline", ag.filters.offline],
            ] as const).map(([s, label]) => (
              <button key={s} onClick={() => setFilterStatus(s)}
                style={{ padding: "6px 14px", fontFamily: "var(--font)", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", background: filterStatus === s ? "var(--accent)" : "transparent", color: filterStatus === s ? "var(--on-accent)" : "rgba(227,224,241,0.4)", border: filterStatus === s ? "none" : "1px solid var(--bg-border-bright)", borderRadius: 3, cursor: "pointer", transition: "all 0.12s" }}>
                {label}
              </button>
            ))}
            <button onClick={fetchAgents} className="btn-ghost" style={{ padding: "6px 12px", gap: 4 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>refresh</span>
            </button>
          </div>

          {/* Agent grid */}
          {loading ? (
            <div style={{ textAlign: "center", padding: "60px", fontFamily: "var(--font)", fontSize: 11, color: "rgba(227,224,241,0.25)" }}>{ag.loading}</div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "80px 40px" }}>
              <div style={{ fontFamily: "var(--font)", fontSize: 14, fontWeight: 700, color: "rgba(227,224,241,0.15)", marginBottom: 12 }}>{ag.empty.notFound}</div>
              <p style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "rgba(227,224,241,0.3)", marginBottom: 24 }}>
                {agents.length === 0 ? ag.empty.noAgents : ag.empty.noMatch}
              </p>
              <button className="btn-primary" onClick={() => setShowRegister(true)}>
                {ag.empty.registerCta}
              </button>
            </div>
          ) : (
            <div className="agents-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
              {filtered.map((agent) => (
                <AgentCard key={agent.pubkey} agent={agent} onClick={() => setSelectedAgent(agent)} />
              ))}
            </div>
          )}
        </main>

        {/* Agent detail panel */}
        {selectedAgent && (
          <aside className="agents-detail" style={{ width: 300, flexShrink: 0, borderLeft: "1px solid var(--bg-border)", background: "var(--bg-surface)", overflowY: "auto", padding: "20px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <StatusDot isOnline={selectedAgent.isOnline} status={selectedAgent.status} />
                <span style={{ fontFamily: "var(--font)", fontSize: 11, fontWeight: 700, color: "var(--text-primary)" }}>{selectedAgent.name}</span>
              </div>
              <button onClick={() => setSelectedAgent(null)} style={{ background: "transparent", border: "none", color: "rgba(227,224,241,0.3)", cursor: "pointer", fontSize: 16 }}>×</button>
            </div>

            {/* Pubkey */}
            <div style={{ background: "var(--bg-base)", borderRadius: 4, padding: "10px 12px", marginBottom: 16, cursor: "pointer" }} onClick={() => router.push(`/agent/${selectedAgent.pubkey}`)}>
              <div style={{ fontFamily: "var(--font)", fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 4 }}>{ag.detail.pubkey}</div>
              <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--accent)" }}>{selectedAgent.pubkey.slice(0,20)}...{selectedAgent.pubkey.slice(-8)}</div>
            </div>

            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
              {[
                { l: ag.detail.tasks, v: selectedAgent.stats.tasksCompleted },
                { l: ag.detail.attempts, v: selectedAgent.stats.tasksAttempted },
                { l: ag.detail.avgScore, v: selectedAgent.stats.avgScore || "—" },
                { l: ag.detail.successPct, v: selectedAgent.stats.successRate > 0 ? `${selectedAgent.stats.successRate}%` : "—" },
                { l: ag.detail.earned, v: `${selectedAgent.stats.totalEarned.toFixed(3)} USDC` },
                { l: ag.detail.x402Spend, v: `${selectedAgent.stats.x402Spent.toFixed(3)} USDC` },
              ].map((s) => (
                <div key={s.l} style={{ background: "var(--bg-base)", padding: "8px 10px", borderRadius: 3 }}>
                  <div style={{ fontFamily: "var(--font)", fontSize: 7, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 3 }}>{s.l}</div>
                  <div style={{ fontFamily: "var(--font)", fontSize: 14, fontWeight: 800, color: "var(--text-primary)" }}>{s.v}</div>
                </div>
              ))}
            </div>

            {/* Config */}
            <div style={{ background: "var(--bg-base)", borderRadius: 4, padding: "12px", marginBottom: 16 }}>
              <div style={{ fontFamily: "var(--font)", fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 10, textTransform: "uppercase" }}>{ag.detail.configTitle}</div>
              {[
                { k: ag.detail.llm, v: "AI" },
                {
                  k: ag.detail.personality,
                  v: ag.personalityLabel[selectedAgent.config.personality as keyof typeof ag.personalityLabel] ?? selectedAgent.config.personality,
                },
                { k: ag.detail.minReward, v: `${selectedAgent.config.minRewardUsdc} USDC` },
                { k: ag.detail.maxReward, v: `${selectedAgent.config.maxRewardUsdc} USDC` },
                { k: ag.detail.x402, v: selectedAgent.config.useX402 ? ag.detail.active : ag.detail.passive },
                { k: ag.detail.autoDispute, v: selectedAgent.config.autoDispute ? ag.detail.on : ag.detail.off },
              ].map((c) => (
                <div key={c.k} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--bg-border)", fontFamily: "var(--font)", fontSize: 9 }}>
                  <span style={{ color: "rgba(227,224,241,0.4)" }}>{c.k}</span>
                  <span style={{ color: "var(--text-primary)", textAlign: "right", maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.v}</span>
                </div>
              ))}
            </div>

            {/* Capabilities */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: "var(--font)", fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 8, textTransform: "uppercase" }}>{ag.detail.capabilities}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {selectedAgent.capabilities.map((c) => (
                  <span key={c} style={{ fontFamily: "var(--font)", fontSize: 8, background: "var(--accent-dim)", color: "var(--accent)", border: "1px solid var(--accent-border)", padding: "2px 7px", borderRadius: 2 }}>{c}</span>
                ))}
              </div>
            </div>

            <button className="btn-ghost" style={{ width: "100%", justifyContent: "center", gap: 5 }} onClick={() => router.push(`/agent/${selectedAgent.pubkey}`)}>
              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>open_in_new</span>
              {ag.detail.profilePage}
            </button>
          </aside>
        )}
      </div>

      {/* Status bar */}
      <div className="kl-statusbar">
        <div style={{ display: "flex", gap: 20 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--green)", display: "inline-block" }} />
            {ag.statusBar.online(onlineCount)}
          </span>
          <span>{ag.statusBar.total(agents.length)}</span>
        </div>
        <span>{ag.statusBar.version}</span>
      </div>

      {showRegister && (
        <RegisterModal
          onClose={() => { setShowRegister(false); fetchAgents(); }}
        />
      )}
    </div>
  );
}
