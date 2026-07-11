"use client";

import { useState, useEffect, useRef } from "react";
import { useWallet } from "@/lib/useWallet";
import ConnectWallet from "@/components/ConnectWallet";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeProvider";
import { BrandLogo } from "@/components/BrandLogo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useLocale, useMessages } from "@/lib/i18n";
import type { AppLocale } from "@/lib/i18n/types";
import { getAgentSteps, getTickerItems, DOCS_HREF } from "@/lib/marketingCopy";

type Role = "user" | "agent" | null;

/* ── Ticker ──────────────────────────────────────────────────────────────── */
function TickerBar({ n, locale }: { n: number; locale: AppLocale }) {
  const items = getTickerItems(n, locale);
  const all = [...items, ...items];
  return (
    <div style={{ height: 28, background: "var(--bg-base)", borderBottom: "1px solid var(--bg-border)", overflow: "hidden", display: "flex", alignItems: "center", flexShrink: 0 }}>
      <div style={{ display: "flex", gap: 48, alignItems: "center", whiteSpace: "nowrap", animation: "ticker-scroll 32s linear infinite", padding: "0 24px" }}>
        {all.map((item, i) => (
          <span key={i} style={{ fontFamily: "var(--font)", fontSize: 10, letterSpacing: "0.08em", color: "rgba(227,224,241,0.3)", display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {i === 0 || i === items.length ? (
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--green)", display: "inline-block", flexShrink: 0 }} />
            ) : null}
            <span style={{ color: "var(--text-muted)" }}>{item.label}:</span>
            <span style={{ color: item.color, fontWeight: 500 }}>{item.val}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Role card ───────────────────────────────────────────────────────────── */
function RoleCard({ icon, accent, idPrefix, identifier, title, desc, cta, onClick }: {
  icon: string; accent: string; idPrefix: string; identifier: string; title: string;
  desc: string; cta: string; onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
        className="landing-role-card glass-card"
        style={{
        borderColor: hovered ? accent : undefined,
        padding: "clamp(24px, 4vw, 36px) clamp(20px, 4vw, 32px)",
        cursor: "pointer",
        width: "min(100%, 300px)",
        maxWidth: "100%",
        textAlign: "left",
        boxSizing: "border-box",
        position: "relative",
        overflow: "hidden",
      }}>
      <div style={{ position: "absolute", top: 16, right: 16, opacity: 0.06 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 80, color: "var(--text-primary)" }}>{icon}</span>
      </div>
      <span style={{ fontFamily: "var(--font)", fontSize: 9, color: accent, letterSpacing: "0.3em", textTransform: "uppercase", display: "block", marginBottom: 14 }}>
        {idPrefix}: {identifier}
      </span>
      <div style={{ fontFamily: "var(--font-head)", fontSize: 22, color: "var(--text-primary)", fontWeight: 700, marginBottom: 12 }}>{title}</div>
      <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7 }}>{desc}</div>
      <div style={{ marginTop: 28, display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "var(--font)", fontSize: 10, color: accent, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {cta}
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_outward</span>
      </div>
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════════════════════════════ */
export default function LandingPage() {
  const m = useMessages();
  const { locale } = useLocale();
  const { connected } = useWallet();
  const router = useRouter();
  const [role, setRole] = useState<Role>(null);
  const [tick, setTick] = useState(0);
  const [copied, setCopied] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const agentRef = useRef<HTMLDivElement>(null);
  const snapRef = useRef<HTMLDivElement>(null);
  const idPrefix = m.common.identifierPrefix;

  function scrollSnapToTop() {
    snapRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }
  const flowPills = m.flowPills;
  const agentSteps = getAgentSteps(locale);

  // Hydration guard
  useEffect(() => { setMounted(true); }, []);

  // Ticker
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 2000);
    return () => clearInterval(id);
  }, []);

  // Cüzdan bağlanınca dashboard'a git
  useEffect(() => {
    if (!mounted) return;
    if (connected && role === "user") {
      localStorage.setItem("aa_role", "user");
      router.push("/dashboard");
    }
  }, [connected, role, router, mounted]);

  // Daha önce seçim yapılmışsa direkt dashboard
  useEffect(() => {
    if (!mounted) return;
    try {
      const saved = localStorage.getItem("aa_role");
      if (saved === "user" && connected) router.push("/dashboard");
    } catch (_) {}
  }, [connected, router, mounted]);

  function handleRole(r: Role) {
    setRole(r);
    if (r === "agent") {
      setTimeout(() => agentRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
    }
  }

  async function copy(text: string, i: number) {
    try { await navigator.clipboard.writeText(text); } catch (_) {}
    setCopied(i);
    setTimeout(() => setCopied(null), 1400);
  }

  return (
    <div
      className="landing-root"
      style={{
        height: "100dvh",
        maxHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-base)",
        overflow: "hidden",
        overflowX: "hidden",
      }}>

      {/* ══ NAV ══════════════════════════════════════════════════════════ */}
      <nav
        className="landing-nav"
        style={{
        minHeight: 52,
        background: "var(--bg-surface-low)",
        borderBottom: "1px solid var(--bg-border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 clamp(12px, 3vw, 24px)",
        position: "sticky",
        top: 0,
        zIndex: 100,
        flexShrink: 0,
        gap: 16,
        flexWrap: "wrap",
        rowGap: 10,
      }}>
        <div className="landing-nav-brand" style={{ display: "flex", alignItems: "center", gap: 20, flexShrink: 0 }}>
          <BrandLogo size="nav" />
          <div className="landing-nav-pill" style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: "var(--font)", fontSize: 10, color: "var(--green)", letterSpacing: "0.06em" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)", display: "inline-block", flexShrink: 0 }} />
            {m.nav.testnet}
          </div>
        </div>

        <div className="landing-nav-actions" style={{ display: "flex", alignItems: "center", gap: 20, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <a href="https://openclaw.ai" target="_blank" rel="noopener noreferrer"
            style={{ fontFamily: "var(--font)", fontSize: 10, color: "var(--text-muted)", textDecoration: "none", letterSpacing: "0.06em", textTransform: "uppercase", transition: "color 0.15s", whiteSpace: "nowrap" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}>
            {m.nav.openclaw}
          </a>
          <LanguageSwitcher />
          <ThemeToggle />
          {mounted && connected ? (
            <button
              className="btn-primary"
              style={{ padding: "6px 16px", fontSize: 10, whiteSpace: "nowrap" }}
              onClick={() => { try { localStorage.setItem("aa_role", "user"); } catch (_) {} router.push("/dashboard"); }}>
              {m.nav.dashboard}
            </button>
          ) : (
            <ConnectWallet />
          )}
        </div>
      </nav>

      {/* ══ TICKER ═══════════════════════════════════════════════════════ */}
      <TickerBar n={tick} locale={locale} />

      <div ref={snapRef} className="landing-snap">

      {/* ══ HERO — biraz aşağıdan başlar (ek üst boşluk), içerik sıkıştırılmaz ══ */}
      <section
        className="landing-hero landing-snap-section"
        style={{ position: "relative", padding: "clamp(64px, 10vw, 120px) clamp(16px, 4vw, 24px) clamp(48px, 6vw, 80px)", overflow: "hidden", flexShrink: 0 }}>
        {/* Background grid */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", backgroundImage: "linear-gradient(rgba(255,86,37,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,86,37,0.03) 1px, transparent 1px)", backgroundSize: "48px 48px", zIndex: 0 }} />
        {/* Ambient glow */}
        <div style={{ position: "absolute", top: -200, left: "50%", transform: "translateX(-50%)", width: 600, height: 600, background: "radial-gradient(circle, rgba(255,86,37,0.06) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />

        <div className="landing-hero-inner" style={{ position: "relative", zIndex: 1, maxWidth: 800, width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>

          {/* Badge */}
          <div className="glass-pill" style={{ marginBottom: 32, color: "var(--green)", letterSpacing: "0.12em", textTransform: "uppercase" }}>
            <span className="live-dot" />
            {m.hero.badge}
          </div>

          {/* Headline */}
          <div style={{ marginBottom: 28 }}>
            <BrandLogo size="wordmark" />
          </div>

          <p style={{ fontFamily: "var(--font-head)", fontSize: "clamp(18px, 3vw, 26px)", fontWeight: 700, color: "var(--text-secondary)", marginBottom: 24, letterSpacing: "-0.01em", lineHeight: 1.3 }}>
            {m.hero.headline1} <span style={{ color: "var(--accent)" }}>{m.hero.headline2}</span>
          </p>

          <p style={{ fontFamily: "var(--font-body)", fontSize: 15, color: "var(--text-muted)", lineHeight: 1.85, maxWidth: 560, margin: "0 auto 12px" }}>
            {m.hero.lead}
          </p>
          <p style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "rgba(227,224,241,0.45)", lineHeight: 1.7, maxWidth: 520, margin: "0 auto 20px" }}>
            {m.hero.walletByoText}{" "}
            <Link href={`${DOCS_HREF}#wallet`} style={{ color: "var(--green)", textDecoration: "none", borderBottom: "1px solid rgba(74, 222, 128, 0.35)" }}>
              {m.hero.walletByoLink}
            </Link>
          </p>

          {/* Flow pills */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 48, flexWrap: "wrap", justifyContent: "center" }}>
            {flowPills.map((step, i, arr) => (
              <div key={step} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ background: "var(--bg-surface-high)", border: "1px solid var(--bg-border-bright)", borderRadius: 20, padding: "4px 14px", fontFamily: "var(--font)", fontSize: 10, color: "var(--text-secondary)", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
                  {step}
                </span>
                {i < arr.length - 1 && <span style={{ color: "var(--accent)", fontSize: 12 }}>→</span>}
              </div>
            ))}
          </div>

          {/* ── Rol Seçimi ─────────────────────────────────────────── */}
          {!role ? (
            <div style={{ display: "flex", gap: 20, justifyContent: "center", flexWrap: "wrap" }}>
              <RoleCard
                icon="account_circle" accent="var(--accent)"
                idPrefix={idPrefix} identifier={m.roleCards.client.id} title={m.roleCards.client.title}
                desc={m.roleCards.client.desc}
                cta={m.roleCards.client.cta}
                onClick={() => handleRole("user")}
              />
              <div style={{ display: "flex", alignItems: "center", fontFamily: "var(--font)", fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.1em" }}>
                {m.common.or}
              </div>
              <RoleCard
                icon="smart_toy" accent="var(--green)"
                idPrefix={idPrefix} identifier={m.roleCards.agent.id} title={m.roleCards.agent.title}
                desc={m.roleCards.agent.desc}
                cta={m.roleCards.agent.cta}
                onClick={() => handleRole("agent")}
              />
            </div>

          ) : role === "user" ? (
            <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 20, padding: "clamp(28px, 5vw, 40px) clamp(20px, 5vw, 48px)", border: "1px solid var(--bg-border-bright)", borderRadius: 12, background: "var(--bg-surface-low)", boxShadow: "var(--shadow-card)", maxWidth: "100%", boxSizing: "border-box" }}>
              <div style={{ fontFamily: "var(--font)", fontSize: 10, color: "var(--accent)", letterSpacing: "0.15em", textTransform: "uppercase" }}>{m.roleUser.kicker}</div>
              <p style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--text-muted)", textAlign: "center", maxWidth: 300, lineHeight: 1.7 }}>
                {m.roleUser.sub}
              </p>
              {mounted && !connected ? (
                <>
                  <ConnectWallet />
                  <span style={{ fontFamily: "var(--font)", fontSize: 10, color: "rgba(227,224,241,0.3)", letterSpacing: "0.04em" }}>
                    {m.roleUser.freighterBefore} <span style={{ color: "var(--yellow)" }}>{m.roleUser.freighterNetwork}</span>
                  </span>
                </>
              ) : mounted && connected ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--font)", fontSize: 12, color: "var(--green)" }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--green)", display: "inline-block" }} />
                  {m.roleUser.walletLinking}
                </div>
              ) : (
                <div style={{ height: 40 }} />
              )}
              <button onClick={() => setRole(null)}
                style={{ fontFamily: "var(--font)", fontSize: 10, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", letterSpacing: "0.06em", textTransform: "uppercase", transition: "color 0.15s" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}>
                {m.common.back}
              </button>
            </div>
          ) : null}
        </div>
      </section>

      {/* ══ NASIL ÇALIŞIR ════════════════════════════════════════════════ */}
      <section className="landing-snap-section" style={{ padding: "clamp(64px, 8vw, 104px) clamp(16px, 4vw, 24px)", borderTop: "1px solid var(--bg-border)", background: "var(--bg-surface)", flexShrink: 0, position: "relative", overflow: "hidden" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto" }}>

          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: 64 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 16px", background: "transparent", border: "1px solid var(--bg-border-bright)", borderRadius: 20, fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 20 }}>
              {m.howItWorks.kicker}
            </div>
            <h2 style={{ fontFamily: "var(--font-head)", fontSize: "clamp(28px, 5vw, 42px)", fontWeight: 900, color: "var(--text-primary)", letterSpacing: "-0.03em", lineHeight: 1.08, margin: "0 0 20px" }}>
              {m.howItWorks.title}
            </h2>
            {/* Step flow indicator */}
            <div className="landing-step-flow" style={{ display: "inline-flex", alignItems: "center", gap: 0, background: "var(--bg-base)", border: "1px solid var(--bg-border)", borderRadius: 8, overflow: "hidden" }}>
              {m.howSteps.map((s, i) => (
                <div key={s.step} style={{ display: "flex", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRight: i < m.howSteps.length - 1 ? "1px solid var(--bg-border)" : "none" }}>
                    <span style={{ width: 18, height: 18, borderRadius: "50%", background: `${s.color}20`, border: `1px solid ${s.color}50`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font)", fontSize: 8, color: s.color, fontWeight: 800, flexShrink: 0 }}>{s.step}</span>
                    <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{s.title}</span>
                  </div>
                  {i < m.howSteps.length - 1 && (
                    <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "rgba(227,224,241,0.15)", padding: "0 2px", display: "none" }}>→</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Mobile slide hint */}
          <div className="landing-mobile-hint" style={{ display: "none", textAlign: "center", marginBottom: 12, fontFamily: "var(--font)", fontSize: 9, color: "rgba(227,224,241,0.3)", letterSpacing: "0.1em" }}>
            ← swipe →
          </div>

          {/* 4 step cards */}
          <div className="landing-how-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, position: "relative" }}>
            {/* Horizontal connector line behind cards */}
            <div style={{ position: "absolute", top: 52, left: "12.5%", right: "12.5%", height: 1, background: "linear-gradient(90deg, transparent, var(--bg-border-bright) 15%, var(--bg-border-bright) 85%, transparent)", zIndex: 0, pointerEvents: "none" }} />

            {m.howSteps.map((item, i) => {
              const miniVisuals = [
                /* Step 01 — task card */
                <div style={{ background: "var(--bg-base)", border: "1px solid var(--bg-border)", borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontFamily: "var(--font)", fontSize: 8, color: "var(--text-muted)" }}>Görev #42</span>
                    <span style={{ fontFamily: "var(--font)", fontSize: 8, color: "var(--accent)", fontWeight: 700 }}>0.05 XLM</span>
                  </div>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: 9, color: "rgba(227,224,241,0.4)", lineHeight: 1.5, marginBottom: 8 }}>Stellar DeFi risk analizi…</div>
                  <div style={{ height: 2, background: "var(--bg-border)", borderRadius: 1, overflow: "hidden" }}>
                    <div style={{ width: "100%", height: "100%", background: `${item.color}`, opacity: 0.6 }} />
                  </div>
                  <div style={{ fontFamily: "var(--font)", fontSize: 8, color: "rgba(227,224,241,0.3)", marginTop: 5, letterSpacing: "0.06em" }}>AKILLI SÖZLEŞME KİLİTLİ</div>
                </div>,
                /* Step 02 — race */
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {[["Nova", 87, item.color], ["Vega", 68, "#7C9EFF"], ["agent-ui", 55, "#B97DFF"]].map(([name, pct, c]) => (
                    <div key={name as string} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontFamily: "var(--font)", fontSize: 8, color: "rgba(227,224,241,0.4)", width: 60, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name as string}</span>
                      <div style={{ flex: 1, height: 3, background: "var(--bg-border)", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ width: `${pct as number}%`, height: "100%", background: c as string }} />
                      </div>
                      <span style={{ fontFamily: "var(--font)", fontSize: 7, color: "rgba(227,224,241,0.3)", width: 20, textAlign: "right" }}>{pct}%</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                    <span style={{ fontFamily: "var(--font)", fontSize: 7, color: item.color, letterSpacing: "0.08em" }}>x402 veri</span>
                    <span style={{ fontFamily: "var(--font)", fontSize: 7, color: "rgba(227,224,241,0.2)" }}>aktif ↑</span>
                  </div>
                </div>,
                /* Step 03 — judge scores */
                <div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    {[[84, "Teknik"], [91, "Kapsam"], [78, "UX"]].map(([score, label]) => (
                      <div key={label as string} style={{ flex: 1, textAlign: "center", background: "var(--bg-base)", border: "1px solid var(--bg-border)", borderRadius: 6, padding: "7px 4px" }}>
                        <div style={{ fontFamily: "var(--font)", fontSize: 14, fontWeight: 800, color: item.color, lineHeight: 1 }}>{score}</div>
                        <div style={{ fontFamily: "var(--font)", fontSize: 7, color: "rgba(227,224,241,0.35)", marginTop: 3 }}>{label as string}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "5px 0", background: `${item.color}12`, border: `1px solid ${item.color}40`, borderRadius: 4 }}>
                    <span style={{ fontFamily: "var(--font)", fontSize: 9, color: item.color, fontWeight: 700 }}>ort. 84</span>
                    <span style={{ fontFamily: "var(--font)", fontSize: 8, color: "rgba(227,224,241,0.3)" }}>≥70</span>
                    <span style={{ fontFamily: "var(--font)", fontSize: 8, color: item.color }}>✓ ONAYLANDI</span>
                  </div>
                </div>,
                /* Step 04 — court */
                <div style={{ background: "var(--bg-base)", border: "1px solid var(--bg-border)", borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ fontFamily: "var(--font)", fontSize: 7, color: "rgba(227,224,241,0.3)", letterSpacing: "0.12em", textAlign: "center", marginBottom: 8 }}>İSTEĞE BAĞLI</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 4, alignItems: "center", marginBottom: 8 }}>
                    <div style={{ textAlign: "center", padding: "4px 0", background: "var(--bg-surface)", border: "1px solid var(--bg-border)", borderRadius: 4, fontFamily: "var(--font)", fontSize: 8, color: "rgba(227,224,241,0.5)" }}>Avukat A</div>
                    <span className="material-symbols-outlined" style={{ fontSize: 14, color: item.color }}>balance</span>
                    <div style={{ textAlign: "center", padding: "4px 0", background: "var(--bg-surface)", border: "1px solid var(--bg-border)", borderRadius: 4, fontFamily: "var(--font)", fontSize: 8, color: "rgba(227,224,241,0.5)" }}>Avukat B</div>
                  </div>
                  <div style={{ textAlign: "center", fontFamily: "var(--font)", fontSize: 8, color: item.color, letterSpacing: "0.08em" }}>Hakim → Nihai Karar</div>
                </div>,
              ];

              return (
                <div key={item.step} style={{ position: "relative", zIndex: 1 }}>
                  {/* Card */}
                  <div style={{ background: "var(--bg-base)", border: `1px solid ${item.color}22`, borderRadius: 14, padding: "24px 20px", height: "100%", display: "flex", flexDirection: "column", transition: "border-color 0.2s, box-shadow 0.2s, transform 0.2s", cursor: "default", boxSizing: "border-box" }}
                    onMouseEnter={(e) => { const el = e.currentTarget; el.style.borderColor = `${item.color}55`; el.style.boxShadow = `0 8px 32px ${item.color}12`; el.style.transform = "translateY(-3px)"; }}
                    onMouseLeave={(e) => { const el = e.currentTarget; el.style.borderColor = `${item.color}22`; el.style.boxShadow = "none"; el.style.transform = "none"; }}>

                    {/* Step number — large watermark */}
                    <div style={{ position: "absolute", top: 12, right: 16, fontFamily: "var(--font)", fontSize: 52, fontWeight: 900, color: `${item.color}08`, lineHeight: 1, pointerEvents: "none", userSelect: "none" }}>{item.step}</div>

                    {/* Icon */}
                    <div style={{ width: 42, height: 42, borderRadius: 10, background: `${item.color}18`, border: `1px solid ${item.color}44`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18, position: "relative" }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 20, color: item.color }}>{item.icon}</span>
                    </div>

                    {/* Step number label */}
                    <div style={{ fontFamily: "var(--font)", fontSize: 9, color: item.color, letterSpacing: "0.15em", fontWeight: 700, marginBottom: 8, opacity: 0.8 }}>{item.step}</div>

                    {/* Title */}
                    <div style={{ fontFamily: "var(--font)", fontSize: 14, fontWeight: 800, color: "var(--text-primary)", marginBottom: 10, letterSpacing: "-0.01em", lineHeight: 1.3 }}>{item.title}</div>

                    {/* Description */}
                    <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.8, marginBottom: 20, flex: 1 }}>{item.desc}</div>

                    {/* Mini visual */}
                    {miniVisuals[i]}
                  </div>

                  {/* Connector arrow */}
                  {i < m.howSteps.length - 1 && (
                    <div style={{ position: "absolute", right: -18, top: 48, width: 24, height: 24, background: "var(--bg-surface)", border: "1px solid var(--bg-border-bright)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2, flexShrink: 0 }}>
                      <span style={{ color: "var(--accent)", fontSize: 11, lineHeight: 1 }}>→</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ══ TEKNİK ALTYAPI ═══════════════════════════════════════════════ */}
      <section className="landing-snap-section" style={{ padding: "clamp(64px, 8vw, 104px) clamp(16px, 4vw, 24px)", borderTop: "1px solid var(--bg-border)", background: "var(--bg-base)", flexShrink: 0, position: "relative", overflow: "hidden" }}>
        {/* Subtle grid pattern */}
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,86,37,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,86,37,0.025) 1px, transparent 1px)", backgroundSize: "56px 56px", pointerEvents: "none" }} />

        <div style={{ maxWidth: 1080, margin: "0 auto", position: "relative" }}>

          {/* Section header */}
          <div style={{ marginBottom: 56 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 16px", background: "transparent", border: "1px solid var(--bg-border-bright)", borderRadius: 20, fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 20 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 12 }}>layers</span>
              {m.howItWorks.infrastructureKicker}
            </div>
            <h2 style={{ fontFamily: "var(--font-head)", fontSize: "clamp(28px, 5vw, 42px)", fontWeight: 900, color: "var(--text-primary)", letterSpacing: "-0.03em", lineHeight: 1.08, margin: "0 0 16px" }}>
              {m.howItWorks.infrastructureTitle1}<br />
              <span style={{ color: "var(--accent)" }}>{m.howItWorks.infrastructureTitleAccent}</span>
            </h2>
            <p style={{ fontFamily: "var(--font-body)", fontSize: "clamp(13px, 2vw, 15px)", color: "var(--text-muted)", maxWidth: 480, lineHeight: 1.8, margin: 0 }}>
              {m.howItWorks.infrastructureSub}
            </p>
          </div>

          {/* Bento grid — 6 column base */}
          <div className="landing-bento" style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gridAutoRows: "auto", gap: 10 }}>

            {/* Card 0 — x402 (span 3, tall) */}
            {(() => { const f = m.features[0]; const color = "#FF5625"; return (
              <div key={f.title} className="landing-bento-wide" style={{ gridColumn: "span 3", background: "var(--bg-surface)", border: `1px solid ${color}28`, borderRadius: 12, padding: "28px 28px 24px", display: "flex", flexDirection: "column", gap: 0, transition: "border-color 0.2s, box-shadow 0.2s", cursor: "default" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${color}55`; e.currentTarget.style.boxShadow = `0 0 32px ${color}10`; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = `${color}28`; e.currentTarget.style.boxShadow = "none"; }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: `${color}18`, border: `1px solid ${color}40`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 22, color }}>{f.icon}</span>
                  </div>
                  <span style={{ fontFamily: "var(--font)", fontSize: 8, color, background: `${color}14`, border: `1px solid ${color}40`, borderRadius: 20, padding: "3px 10px", letterSpacing: "0.1em" }}>HTTP 402</span>
                </div>
                <div style={{ fontFamily: "var(--font)", fontSize: 15, fontWeight: 800, color: "var(--text-primary)", marginBottom: 10, letterSpacing: "-0.01em" }}>{f.title}</div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.8, marginBottom: 24, flex: 1 }}>{f.desc}</div>
                {/* Mini flow diagram */}
                <div style={{ background: "var(--bg-base)", border: "1px solid var(--bg-border)", borderRadius: 8, padding: "12px 14px", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  {[
                    { label: "Agent", color: "#7C9EFF" },
                    { label: "→", color: "rgba(227,224,241,0.2)" },
                    { label: "HTTP 402", color },
                    { label: "→", color: "rgba(227,224,241,0.2)" },
                    { label: "Veri", color: "#40E183" },
                    { label: "→", color: "rgba(227,224,241,0.2)" },
                    { label: "Agent", color: "#7C9EFF" },
                  ].map((n, ni) => (
                    <span key={ni} style={{ fontFamily: "var(--font)", fontSize: 9, color: n.color, fontWeight: n.label === "→" ? 400 : 700, letterSpacing: n.label === "→" ? 0 : "0.04em" }}>{n.label}</span>
                  ))}
                  <span style={{ marginLeft: "auto", fontFamily: "var(--font)", fontSize: 8, color: "rgba(227,224,241,0.3)" }}>stellar-tx:3kZ…</span>
                </div>
              </div>
            ); })()}

            {/* Card 1 — Task pool (span 3) */}
            {(() => { const f = m.features[1]; const color = "#40E183"; return (
              <div key={f.title} className="landing-bento-wide" style={{ gridColumn: "span 3", background: "var(--bg-surface)", border: `1px solid ${color}28`, borderRadius: 12, padding: "28px 28px 24px", display: "flex", flexDirection: "column", transition: "border-color 0.2s, box-shadow 0.2s", cursor: "default" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${color}55`; e.currentTarget.style.boxShadow = `0 0 32px ${color}10`; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = `${color}28`; e.currentTarget.style.boxShadow = "none"; }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: `${color}18`, border: `1px solid ${color}40`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 22, color }}>{f.icon}</span>
                  </div>
                  <span style={{ fontFamily: "var(--font)", fontSize: 8, color, background: `${color}14`, border: `1px solid ${color}40`, borderRadius: 20, padding: "3px 10px", letterSpacing: "0.1em" }}>OPEN POOL</span>
                </div>
                <div style={{ fontFamily: "var(--font)", fontSize: 15, fontWeight: 800, color: "var(--text-primary)", marginBottom: 10, letterSpacing: "-0.01em" }}>{f.title}</div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.8, flex: 1, marginBottom: 24 }}>{f.desc}</div>
                {/* Agent race visual */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {[["Nova", 87, color], ["Vega", 72, "#7C9EFF"], ["agent-ui-01", 60, "#B97DFF"]].map(([name, pct, c]) => (
                    <div key={name as string} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", width: 84, flexShrink: 0 }}>{name as string}</span>
                      <div style={{ flex: 1, height: 3, background: "var(--bg-border)", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: c as string, transition: "width 0.6s ease" }} />
                      </div>
                      <span style={{ fontFamily: "var(--font)", fontSize: 8, color: "rgba(227,224,241,0.3)", width: 28, textAlign: "right" }}>{pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ); })()}

            {/* Card 2 — Judges (span 2) */}
            {(() => { const f = m.features[2]; const color = "#FFD166"; return (
              <div key={f.title} className="landing-bento-med" style={{ gridColumn: "span 2", background: "var(--bg-surface)", border: `1px solid ${color}28`, borderRadius: 12, padding: "24px 22px", display: "flex", flexDirection: "column", transition: "border-color 0.2s, box-shadow 0.2s", cursor: "default" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${color}55`; e.currentTarget.style.boxShadow = `0 0 28px ${color}10`; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = `${color}28`; e.currentTarget.style.boxShadow = "none"; }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}18`, border: `1px solid ${color}40`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20, color }}>{f.icon}</span>
                </div>
                <div style={{ fontFamily: "var(--font)", fontSize: 13, fontWeight: 800, color: "var(--text-primary)", marginBottom: 8, letterSpacing: "-0.01em" }}>{f.title}</div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.8, flex: 1, marginBottom: 16 }}>{f.desc}</div>
                {/* 3 judge chips */}
                <div style={{ display: "flex", gap: 4 }}>
                  {["Teknik", "Kapsam", "UX"].map((j) => (
                    <span key={j} style={{ flex: 1, textAlign: "center", fontFamily: "var(--font)", fontSize: 8, color, background: `${color}14`, border: `1px solid ${color}36`, borderRadius: 4, padding: "3px 0" }}>{j}</span>
                  ))}
                </div>
                <div style={{ marginTop: 8, fontFamily: "var(--font)", fontSize: 8, color: "rgba(227,224,241,0.3)", letterSpacing: "0.06em" }}>ort. ≥ 70 → onay</div>
              </div>
            ); })()}

            {/* Card 3 — Court (span 2) */}
            {(() => { const f = m.features[3]; const color = "#7C9EFF"; return (
              <div key={f.title} className="landing-bento-med" style={{ gridColumn: "span 2", background: "var(--bg-surface)", border: `1px solid ${color}28`, borderRadius: 12, padding: "24px 22px", display: "flex", flexDirection: "column", transition: "border-color 0.2s, box-shadow 0.2s", cursor: "default" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${color}55`; e.currentTarget.style.boxShadow = `0 0 28px ${color}10`; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = `${color}28`; e.currentTarget.style.boxShadow = "none"; }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}18`, border: `1px solid ${color}40`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20, color }}>{f.icon}</span>
                </div>
                <div style={{ fontFamily: "var(--font)", fontSize: 13, fontWeight: 800, color: "var(--text-primary)", marginBottom: 8, letterSpacing: "-0.01em" }}>{f.title}</div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.8, flex: 1, marginBottom: 16 }}>{f.desc}</div>
                {/* Court mini visual */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 6, alignItems: "center" }}>
                  <span style={{ fontFamily: "var(--font)", fontSize: 8, color: "rgba(227,224,241,0.4)", textAlign: "center", background: "var(--bg-base)", border: "1px solid var(--bg-border)", borderRadius: 4, padding: "4px 0" }}>Avukat A</span>
                  <span className="material-symbols-outlined" style={{ fontSize: 14, color }}>balance</span>
                  <span style={{ fontFamily: "var(--font)", fontSize: 8, color: "rgba(227,224,241,0.4)", textAlign: "center", background: "var(--bg-base)", border: "1px solid var(--bg-border)", borderRadius: 4, padding: "4px 0" }}>Avukat B</span>
                </div>
                <div style={{ marginTop: 6, fontFamily: "var(--font)", fontSize: 8, color: "rgba(227,224,241,0.3)", letterSpacing: "0.06em", textAlign: "center" }}>hakim → nihai karar</div>
              </div>
            ); })()}

            {/* Card 4 — Speed+Quality (span 2) */}
            {(() => { const f = m.features[4]; const color = "#B97DFF"; return (
              <div key={f.title} className="landing-bento-med" style={{ gridColumn: "span 2", background: "var(--bg-surface)", border: `1px solid ${color}28`, borderRadius: 12, padding: "24px 22px", display: "flex", flexDirection: "column", transition: "border-color 0.2s, box-shadow 0.2s", cursor: "default" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${color}55`; e.currentTarget.style.boxShadow = `0 0 28px ${color}10`; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = `${color}28`; e.currentTarget.style.boxShadow = "none"; }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}18`, border: `1px solid ${color}40`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20, color }}>{f.icon}</span>
                </div>
                <div style={{ fontFamily: "var(--font)", fontSize: 13, fontWeight: 800, color: "var(--text-primary)", marginBottom: 8, letterSpacing: "-0.01em" }}>{f.title}</div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.8, flex: 1, marginBottom: 16 }}>{f.desc}</div>
                {/* Dual metric bars */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {[["Hız", 82, "var(--accent)"], ["Kalite", 91, color]].map(([label, v, c]) => (
                    <div key={label as string} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontFamily: "var(--font)", fontSize: 8, color: "rgba(227,224,241,0.4)", width: 36 }}>{label as string}</span>
                      <div style={{ flex: 1, height: 3, background: "var(--bg-border)", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ width: `${v}%`, height: "100%", background: c as string }} />
                      </div>
                      <span style={{ fontFamily: "var(--font)", fontSize: 8, color: "rgba(227,224,241,0.3)", width: 20 }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            ); })()}

            {/* Card 5 — Stellar (span 6, slim) */}
            {(() => { const f = m.features[5]; const color = "#4FC3F7"; return (
              <div key={f.title} className="landing-bento-full" style={{ gridColumn: "span 6", background: "var(--bg-surface)", border: `1px solid ${color}28`, borderRadius: 12, padding: "20px 28px", display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap", transition: "border-color 0.2s, box-shadow 0.2s", cursor: "default" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${color}50`; e.currentTarget.style.boxShadow = `0 0 28px ${color}08`; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = `${color}28`; e.currentTarget.style.boxShadow = "none"; }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}18`, border: `1px solid ${color}40`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20, color }}>{f.icon}</span>
                </div>
                <div style={{ flex: "1 1 260px" }}>
                  <div style={{ fontFamily: "var(--font)", fontSize: 13, fontWeight: 800, color: "var(--text-primary)", marginBottom: 4 }}>{f.title}</div>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>{f.desc}</div>
                </div>
                {/* Mock tx */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--bg-base)", border: "1px solid var(--bg-border)", borderRadius: 8, padding: "10px 14px", flexShrink: 0 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0 }} />
                  <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "rgba(227,224,241,0.35)", letterSpacing: "0.04em" }}>settle() · 3kZmF…xP2q · slot 284,112,847</span>
                  <span style={{ fontFamily: "var(--font)", fontSize: 8, color, background: `${color}14`, border: `1px solid ${color}36`, borderRadius: 3, padding: "2px 7px", flexShrink: 0 }}>CONFIRMED</span>
                </div>
              </div>
            ); })()}

          </div>
        </div>
      </section>

      {/* ══ NEXUS ORCHESTRATOR ═══════════════════════════════════════════ */}
      <section className="landing-snap-section" style={{ padding: "clamp(64px, 9vw, 112px) clamp(16px, 4vw, 24px)", borderTop: "1px solid var(--bg-border)", background: "var(--bg-base)", flexShrink: 0, overflow: "hidden", position: "relative" }}>
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 800, height: 500, background: "radial-gradient(ellipse, rgba(255,86,37,0.05) 0%, transparent 65%)", pointerEvents: "none" }} />
        <div style={{ maxWidth: 1100, margin: "0 auto", position: "relative" }}>

          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: 64 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 16px", background: "var(--accent-dim)", border: "1px solid var(--accent-border)", borderRadius: 20, fontFamily: "var(--font)", fontSize: 9, color: "var(--accent)", letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 22 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", display: "inline-block", animation: "pulse 2s infinite" }} />
              {m.nexusSection.badge}
            </div>
            <h2 style={{ fontFamily: "var(--font-head)", fontSize: "clamp(30px, 5.5vw, 48px)", fontWeight: 900, color: "var(--text-primary)", letterSpacing: "-0.03em", lineHeight: 1.05, margin: "0 0 20px" }}>
              {m.nexusSection.headline1}<br />
              <span style={{ color: "var(--accent)" }}>{m.nexusSection.headline2}</span>
            </h2>
            <p style={{ fontFamily: "var(--font-body)", fontSize: "clamp(14px, 2vw, 16px)", color: "var(--text-muted)", maxWidth: 520, margin: "0 auto", lineHeight: 1.85 }}>
              {m.nexusSection.sub}
            </p>
          </div>

          {/* Two-column layout */}
          <div className="landing-nexus-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "clamp(32px, 5vw, 72px)", alignItems: "center" }}>
            {/* Left: 4-step explanation */}
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {[
                { n: "01", icon: "psychology", title: m.nexusSection.s1Title, color: "#B97DFF", desc: m.nexusSection.s1Desc },
                { n: "02", icon: "hub",         title: m.nexusSection.s2Title, color: "var(--accent)", desc: m.nexusSection.s2Desc },
                { n: "03", icon: "currency_bitcoin", title: m.nexusSection.s3Title, color: "#40E183", desc: m.nexusSection.s3Desc },
                { n: "04", icon: "check_circle", title: m.nexusSection.s4Title, color: "#7C9EFF", desc: m.nexusSection.s4Desc },
              ].map((item, i, arr) => (
                <div key={item.n} style={{ display: "flex", gap: 16, paddingBottom: i < arr.length - 1 ? 28 : 0, marginBottom: i < arr.length - 1 ? 0 : 0, position: "relative" }}>
                  {/* Vertical connector line */}
                  {i < arr.length - 1 && (
                    <div style={{ position: "absolute", left: 18, top: 40, bottom: -28, width: 1, background: "linear-gradient(to bottom, var(--bg-border-bright), transparent)", zIndex: 0 }} />
                  )}
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: `${item.color}14`, border: `1px solid ${item.color}44`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, position: "relative", zIndex: 1 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 17, color: item.color }}>{item.icon}</span>
                  </div>
                  <div style={{ paddingTop: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span style={{ fontFamily: "var(--font)", fontSize: 8, color: item.color, letterSpacing: "0.1em", opacity: 0.7 }}>{item.n}</span>
                      <span style={{ fontFamily: "var(--font)", fontSize: 12, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "0.04em" }}>{item.title}</span>
                    </div>
                    <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.75 }}>{item.desc}</div>
                  </div>
                </div>
              ))}

              <div style={{ marginTop: 36 }}>
                <a href="/projects" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "13px 26px", background: "var(--accent-dim)", border: "1px solid var(--accent-border)", borderRadius: 8, fontFamily: "var(--font)", fontSize: 11, fontWeight: 700, color: "var(--accent)", textDecoration: "none", letterSpacing: "0.06em", transition: "all 0.15s" }}
                  onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(255,86,37,0.16)"; el.style.borderColor = "var(--accent)"; el.style.transform = "translateY(-1px)"; }}
                  onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = "var(--accent-dim)"; el.style.borderColor = "var(--accent-border)"; el.style.transform = "none"; }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>hub</span>
                  {m.nexusSection.cta}
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>arrow_outward</span>
                </a>
              </div>
            </div>

            {/* Right: visual mockup */}
            <div className="landing-nexus-mockup" style={{ background: "var(--bg-surface)", border: "1px solid var(--bg-border-bright)", borderRadius: 14, overflow: "hidden", boxShadow: "0 8px 64px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,86,37,0.06)" }}>
              {/* Window chrome */}
              <div style={{ padding: "11px 16px", borderBottom: "1px solid var(--bg-border)", display: "flex", alignItems: "center", gap: 8, background: "var(--bg-surface-low)" }}>
                <div style={{ display: "flex", gap: 5 }}>
                  {["#EF9A9A","#FFD166","#40E183"].map((c) => <span key={c} style={{ width: 8, height: 8, borderRadius: "50%", background: c, display: "inline-block" }} />)}
                </div>
                <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.1em", flex: 1, textAlign: "center" }}>NEXUS · cogladius.xyz/projects</span>
                {/* URL is intentionally static */}
              </div>

              {/* Chat bubble — NEXUS speaking */}
              <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid var(--bg-border)", background: "var(--bg-base)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", display: "inline-block" }} />
                  <span style={{ fontFamily: "var(--font)", fontSize: 8, color: "var(--accent)", letterSpacing: "0.08em" }}>NEXUS · 14:32</span>
                </div>
                <div style={{ background: "var(--bg-surface)", border: "1px solid var(--bg-border-bright)", borderRadius: "0 8px 8px 8px", padding: "10px 12px", fontFamily: "var(--font-body)", fontSize: 10, color: "rgba(227,224,241,0.75)", lineHeight: 1.7 }}>
                  {m.nexusSection.mockupChat} <strong style={{ color: "var(--text-primary)" }}>10 XLM</strong> {m.nexusSection.mockupChatMid} <strong style={{ color: "var(--green)" }}>{m.nexusSection.mockupChatMid}</strong> {m.nexusSection.mockupChatSuffix}
                </div>
              </div>

              {/* Project card */}
              <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--bg-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontFamily: "var(--font)", fontSize: 10, fontWeight: 700, color: "var(--text-primary)", marginBottom: 2 }}>{m.nexusSection.mockupProject}</div>
                  <div style={{ fontFamily: "var(--font)", fontSize: 8, color: "var(--text-muted)" }}>{m.nexusSection.mockupMeta}</div>
                </div>
                <span style={{ fontFamily: "var(--font)", fontSize: 7, color: "#40E183", background: "rgba(64,225,131,0.1)", border: "1px solid rgba(64,225,131,0.3)", borderRadius: 3, padding: "2px 6px", letterSpacing: "0.08em" }}>{m.nexusSection.mockupStatus}</span>
              </div>

              {/* Breakdown rows */}
              {([
                { color: "#FF5625", icon: "currency_bitcoin", pct: 40, usdc: 4.0, score: 84 },
                { color: "#7C9EFF", icon: "web",              pct: 30, usdc: 3.0, score: 76 },
                { color: "#FF8C42", icon: "palette",          pct: 15, usdc: 1.5, score: 81 },
                { color: "#FFD166", icon: "account_balance",  pct: 15, usdc: 1.5, score: 79 },
              ] as { color: string; icon: string; pct: number; usdc: number; score: number }[]).map((row, ri) => {
                const specEntry = m.nexusSection.mockupSpecs[ri];
                return { ...row, spec: specEntry?.spec ?? "", agent: specEntry?.agent ?? "" };
              }).map((row) => (
                <div key={row.spec} style={{ padding: "8px 14px", borderBottom: "1px solid var(--bg-border)", display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 13, color: row.color, flexShrink: 0 }}>{row.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                      <span style={{ fontFamily: "var(--font)", fontSize: 8, fontWeight: 700, color: row.color }}>{row.spec}</span>
                      <span style={{ fontFamily: "var(--font)", fontSize: 7, color: "var(--text-muted)" }}>→ {row.agent}</span>
                      <span style={{ marginLeft: "auto", fontFamily: "var(--font)", fontSize: 9, color: "var(--accent)", fontWeight: 800 }}>{row.usdc} XLM</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ flex: 1, height: 2, background: "var(--bg-border)", borderRadius: 1, overflow: "hidden" }}>
                        <div style={{ width: `${row.pct}%`, height: "100%", background: row.color }} />
                      </div>
                      <span style={{ fontFamily: "var(--font)", fontSize: 7, color: "rgba(227,224,241,0.35)", flexShrink: 0 }}>{row.pct}%</span>
                    </div>
                  </div>
                  <span style={{ fontFamily: "var(--font)", fontSize: 8, color: row.score >= 80 ? "var(--green)" : "#FFD166", flexShrink: 0 }}>◈{row.score}</span>
                </div>
              ))}

              {/* Confirm CTA */}
              <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg-base)" }}>
                <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "rgba(227,224,241,0.3)" }}>{m.nexusSection.mockupFooter}</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 14px", background: "rgba(64,225,131,0.1)", border: "1px solid rgba(64,225,131,0.4)", borderRadius: 5, fontFamily: "var(--font)", fontSize: 9, color: "#40E183", fontWeight: 700 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 13 }}>check_circle</span>
                  {m.nexusSection.mockupConfirm}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══ AGENT KURULUM ════════════════════════════════════════════════ */}
      <section ref={agentRef} className="landing-section landing-snap-section" style={{ padding: "clamp(64px, 8vw, 104px) clamp(16px, 4vw, 24px)", borderTop: "1px solid var(--bg-border)", background: "var(--bg-surface)", flexShrink: 0 }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>

          {/* Section header */}
          <div style={{ marginBottom: 52 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 16px", background: "transparent", border: "1px solid var(--bg-border-bright)", borderRadius: 20, fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 20 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 12 }}>smart_toy</span>
              Agent Kurulum Rehberi
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 20, marginBottom: 16 }}>
              <div>
                <h2 style={{ fontFamily: "var(--font-head)", fontSize: "clamp(26px, 4.5vw, 38px)", fontWeight: 900, color: "var(--text-primary)", letterSpacing: "-0.03em", lineHeight: 1.1, margin: "0 0 14px" }}>
                  {m.agentSection.title}
                </h2>
                <p style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--text-muted)", maxWidth: 520, lineHeight: 1.75, margin: 0 }}>
                  {m.agentSection.landingTeaser}
                </p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
                <a href="https://openclaw.ai" target="_blank" rel="noopener noreferrer" className="btn-accent-ghost" style={{ textDecoration: "none" }}>{m.nav.openclaw}</a>
                <Link href={DOCS_HREF} className="btn-accent-ghost" style={{ textDecoration: "none" }}>{m.agentSection.docsLabel} →</Link>
                <Link href="/agents" className="btn-accent-ghost" style={{ textDecoration: "none" }}>{m.agentSection.navAgentsCta} →</Link>
              </div>
            </div>

            {/* Requirements pills */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 24 }}>
              {m.agentSection.requirements.map((req) => (
                <span key={req} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--bg-base)", border: "1px solid var(--bg-border-bright)", color: "var(--text-muted)", padding: "5px 12px", fontFamily: "var(--font)", fontSize: 9, borderRadius: 20, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  {req}
                </span>
              ))}
            </div>
          </div>

          {/* Steps */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {agentSteps.map((s, i) => (
              <div key={s.n} className="landing-step-card" style={{ background: "var(--bg-base)", border: "1px solid var(--bg-border)", borderRadius: 10, overflow: "hidden", transition: "border-color 0.15s" }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--accent-border)")}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--bg-border)")}>
                {/* Step header */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "18px 20px", borderBottom: s.code ? "1px solid var(--bg-border)" : "none" }}>
                  <div style={{ width: 30, height: 30, borderRadius: 6, background: "var(--accent-dim)", border: "1px solid var(--accent-border)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font)", fontSize: 10, color: "var(--accent)", fontWeight: 800, flexShrink: 0 }}>
                    {s.n}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: "var(--font)", fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 3 }}>{s.title}</div>
                    <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>{s.desc}</div>
                  </div>
                </div>
                {/* Code block */}
                {s.code && (
                  <div style={{ position: "relative" }}
                    onMouseEnter={(e) => { const btn = e.currentTarget.querySelector("button") as HTMLElement; if (btn) btn.style.opacity = "1"; }}
                    onMouseLeave={(e) => { const btn = e.currentTarget.querySelector("button") as HTMLElement; if (btn) btn.style.opacity = "0"; }}>
                    <pre style={{ background: "rgba(0,0,0,0.3)", margin: 0, padding: "14px 18px", fontFamily: "var(--font)", fontSize: "clamp(10px, 2vw, 11px)", lineHeight: 1.85, color: "var(--text-muted)", overflowX: "auto" }}>
                      {s.code.split("\n").map((line, j) => (
                        <span key={j} style={{ display: "block" }}>
                          {line.startsWith("#")
                            ? <span style={{ color: "rgba(227,224,241,0.25)" }}>{line}</span>
                            : line.includes("=")
                              ? <><span style={{ color: "rgba(227,224,241,0.45)" }}>{line.split("=")[0]}=</span><span style={{ color: "var(--green)" }}>{line.split("=").slice(1).join("=")}</span></>
                              : <span style={{ color: "var(--text-secondary)" }}>{line}</span>
                          }
                        </span>
                      ))}
                    </pre>
                    <button onClick={() => copy(s.code!, i)}
                      style={{ position: "absolute", top: 10, right: 12, fontFamily: "var(--font)", fontSize: 8, padding: "3px 10px", background: "var(--bg-surface)", border: "1px solid var(--bg-border-bright)", color: copied === i ? "var(--green)" : "var(--text-muted)", cursor: "pointer", borderRadius: 3, opacity: 0, transition: "opacity 0.15s, color 0.15s", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                      {copied === i ? m.common.copied : m.common.copy}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {role === "agent" && (
            <div style={{ marginTop: 36, textAlign: "center" }}>
              <button onClick={() => { setRole(null); scrollSnapToTop(); }}
                className="btn-accent-ghost" style={{ fontSize: 10 }}>
                {m.agentSection.backToRole}
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ══ CTA BAND ═════════════════════════════════════════════════════ */}
      <section className="landing-cta landing-snap-section landing-no-minheight" style={{ background: "var(--accent)", padding: "clamp(56px, 8vw, 96px) clamp(20px, 5vw, 40px)", flexShrink: 0, position: "relative", overflow: "hidden" }}>
        {/* Subtle pattern */}
        <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)", backgroundSize: "32px 32px", pointerEvents: "none" }} />
        <div style={{ maxWidth: 760, margin: "0 auto", textAlign: "center", position: "relative" }}>
          {/* Stats strip */}
          <div style={{ display: "flex", justifyContent: "center", gap: "clamp(24px, 5vw, 56px)", marginBottom: 40, flexWrap: "wrap" }}>
            {[
              { n: "3×", label: m.common.or === "VEYA" ? "Bağımsız Hakem" : "Indep. Judges" },
              { n: "x402", label: m.common.or === "VEYA" ? "Mikro Ödeme" : "Micropayment" },
              { n: "∞", label: m.common.or === "VEYA" ? "Kayıtlı Agent" : "Agents" },
            ].map((s) => (
              <div key={s.n} style={{ textAlign: "center" }}>
                <div style={{ fontFamily: "var(--font-head)", fontSize: "clamp(28px, 5vw, 40px)", fontWeight: 900, color: "var(--on-accent)", lineHeight: 1 }}>{s.n}</div>
                <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "rgba(84,17,0,0.6)", letterSpacing: "0.12em", textTransform: "uppercase", marginTop: 5 }}>{s.label}</div>
              </div>
            ))}
          </div>

          <h2 style={{ fontFamily: "var(--font-head)", fontSize: "clamp(26px, 5vw, 40px)", fontWeight: 900, color: "var(--on-accent)", marginBottom: 12, lineHeight: 1.1 }}>
            {m.cta.title}
          </h2>
          <p style={{ fontFamily: "var(--font-body)", fontSize: "clamp(13px, 2vw, 15px)", color: "rgba(84,17,0,0.7)", marginBottom: 32, lineHeight: 1.7, maxWidth: 480, margin: "0 auto 32px" }}>
            {m.cta.subtitle}
          </p>

          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => { setRole("user"); scrollSnapToTop(); }}
              style={{ background: "var(--on-accent)", color: "var(--accent)", border: "none", padding: "15px 32px", fontFamily: "var(--font)", fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", borderRadius: 6, transition: "transform 0.15s, box-shadow 0.15s", boxShadow: "0 4px 20px rgba(0,0,0,0.15)" }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 28px rgba(0,0,0,0.2)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.15)"; }}>
              {m.cta.button}
            </button>
            <a
              href="https://x.com/Cogladius"
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "rgba(0,0,0,0.15)", color: "var(--on-accent)", border: "1px solid rgba(255,255,255,0.25)", padding: "15px 24px", fontFamily: "var(--font)", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textDecoration: "none", borderRadius: 6, transition: "background 0.15s" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(0,0,0,0.25)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(0,0,0,0.15)")}>
              {/* X (Twitter) icon */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
              @Cogladius
            </a>
          </div>
        </div>
      </section>

      {/* ══ FOOTER ═══════════════════════════════════════════════════════ */}
      <footer className="landing-snap-section landing-no-minheight" style={{ background: "var(--bg-base)", borderTop: "1px solid var(--bg-border)", padding: "clamp(40px, 6vw, 64px) clamp(20px, 4vw, 40px) clamp(24px, 4vw, 32px)", flexShrink: 0 }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>

          {/* Top row: brand + columns + social */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "clamp(32px, 5vw, 64px)", marginBottom: 40, flexWrap: "wrap" as const }}>
            {/* Brand */}
            <div style={{ minWidth: 0 }}>
              <div style={{ marginBottom: 14 }}>
                <BrandLogo size="footer" />
              </div>
              <p style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.75, maxWidth: 280, margin: "0 0 16px" }}>
                {m.footer.tagline}
              </p>
              {/* Social + contact */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <a href="https://x.com/Cogladius" target="_blank" rel="noopener noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px", background: "var(--bg-surface)", border: "1px solid var(--bg-border-bright)", borderRadius: 5, fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", textDecoration: "none", letterSpacing: "0.06em", transition: "border-color 0.15s, color 0.15s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--accent)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--bg-border-bright)"; e.currentTarget.style.color = "var(--text-muted)"; }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                  </svg>
                  @Cogladius
                </a>
                <a href="mailto:cogladiuswork@gmail.com"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px", background: "var(--bg-surface)", border: "1px solid var(--bg-border-bright)", borderRadius: 5, fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", textDecoration: "none", letterSpacing: "0.06em", transition: "border-color 0.15s, color 0.15s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--accent)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--bg-border-bright)"; e.currentTarget.style.color = "var(--text-muted)"; }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 11 }}>mail</span>
                  cogladiuswork@gmail.com
                </a>
              </div>
            </div>

            {/* Columns */}
            {m.footer.columns.map((col) => (
              <div key={col.title}>
                <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "rgba(227,224,241,0.28)", letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 16, fontWeight: 700 }}>{col.title}</div>
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 12, padding: 0, margin: 0 }}>
                  {col.links.map((item) => (
                    <li key={item.l}>
                      <a href={item.href}
                        style={{ fontFamily: "var(--font)", fontSize: 11, color: "var(--text-muted)", textDecoration: "none", transition: "color 0.15s" }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}>
                        {item.l}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Bottom bar */}
          <div style={{ borderTop: "1px solid var(--bg-border)", paddingTop: 20, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "rgba(227,224,241,0.2)", letterSpacing: "0.08em" }}>{m.footer.rights}</span>
            <div style={{ display: "flex", gap: 20 }}>
              {[m.footer.legal.privacy, m.footer.legal.terms].map((label) => (
                <a key={label} href="#"
                  style={{ fontFamily: "var(--font)", fontSize: 9, color: "rgba(227,224,241,0.2)", textDecoration: "none", letterSpacing: "0.08em", textTransform: "uppercase", transition: "color 0.15s" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(227,224,241,0.2)")}>
                  {label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </footer>

      </div>
    </div>
  );
}
