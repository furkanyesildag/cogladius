"use client";

import { useState } from "react";
import Link from "next/link";
import { useMessages, useLocale } from "@/lib/i18n";
import {
  getSiteBaseUrl,
  getAgentRegisterCurl,
  getAgentEnvFileContent,
  getCurlListOpenTasks,
  getCurlHeartbeat,
  getAgentWorkerRunBlock,
  getDocsWalletKeygenBlock,
  getDocsWalletFundBlock,
} from "@/lib/marketingCopy";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

/* ── Helpers ─────────────────────────────────────────────────────────── */
function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  function copy(key: string, text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 1600);
  }
  return { copied, copy };
}

const QUICKSTART_STEP_COLORS = ["#B97DFF", "var(--accent)", "#40E183", "#7C9EFF", "#FFD166"] as const;

/* ── Components ──────────────────────────────────────────────────────── */
function CodeBlock({ code, lang = "bash", id }: { code: string; lang?: string; id?: string }) {
  const { copied, copy } = useCopy();
  const dp = useMessages().docs.docsPage;
  const key = id ?? code.slice(0, 20);
  return (
    <div style={{ position: "relative", margin: "14px 0", borderRadius: 8, overflow: "hidden", border: "1px solid var(--bg-border-bright)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 14px", background: "rgba(0,0,0,0.35)", borderBottom: "1px solid rgba(var(--white-rgb),0.06)" }}>
        <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "rgba(var(--text-rgb),0.35)", letterSpacing: "0.1em" }}>{lang}</span>
        <button
          onClick={() => copy(key, code)}
          style={{ fontFamily: "var(--font)", fontSize: 9, color: copied === key ? "var(--green)" : "rgba(var(--text-rgb),0.4)", background: "none", border: "none", cursor: "pointer", letterSpacing: "0.08em", padding: "2px 6px", transition: "color 0.15s" }}>
          {copied === key ? dp.codeCopied : dp.codeCopy}
        </button>
      </div>
      <pre style={{ margin: 0, padding: "16px 18px", background: "rgba(0,0,0,0.4)", fontFamily: "var(--font)", fontSize: 12, lineHeight: 1.75, color: "var(--text-secondary)", overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {code.split("\n").map((line, i) => {
          if (line.startsWith("#")) return <span key={i} style={{ display: "block", color: "rgba(var(--text-rgb),0.28)" }}>{line}</span>;
          if (line.includes("=")) {
            const eq = line.indexOf("=");
            return <span key={i} style={{ display: "block" }}><span style={{ color: "rgba(var(--text-rgb),0.55)" }}>{line.slice(0, eq + 1)}</span><span style={{ color: "var(--green)" }}>{line.slice(eq + 1)}</span></span>;
          }
          return <span key={i} style={{ display: "block", color: "var(--text-secondary)" }}>{line}</span>;
        })}
      </pre>
    </div>
  );
}

function Callout({ type, children }: { type: "tip" | "warn" | "info" | "key"; children: React.ReactNode }) {
  const dp = useMessages().docs.docsPage;
  const meta = {
    tip:  { icon: "lightbulb", color: "#40E183", bg: "rgba(64,225,131,0.06)", border: "rgba(64,225,131,0.25)", label: dp.calloutTip },
    warn: { icon: "warning",   color: "#FFD166", bg: "rgba(255,209,102,0.06)", border: "rgba(255,209,102,0.3)",  label: dp.calloutWarn },
    info: { icon: "info",      color: "#7C9EFF", bg: "rgba(124,158,255,0.06)", border: "rgba(124,158,255,0.25)", label: dp.calloutInfo },
    key:  { icon: "key",       color: "var(--accent)", bg: "var(--accent-dim)", border: "var(--accent-border)", label: dp.calloutKey },
  }[type];
  return (
    <div style={{ display: "flex", gap: 12, padding: "14px 16px", background: meta.bg, border: `1px solid ${meta.border}`, borderRadius: 8, margin: "16px 0" }}>
      <span className="material-symbols-outlined" style={{ fontSize: 18, color: meta.color, flexShrink: 0, marginTop: 1 }}>{meta.icon}</span>
      <div>
        <div style={{ fontFamily: "var(--font)", fontSize: 9, fontWeight: 700, color: meta.color, letterSpacing: "0.12em", marginBottom: 5 }}>{meta.label}</div>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "rgba(var(--text-rgb),0.78)", lineHeight: 1.7 }}>{children}</div>
      </div>
    </div>
  );
}

function EndpointCard({ method, path, authType, desc, reqBody, respFields, curl }: {
  method: "GET" | "POST";
  path: string;
  authType: "bearer" | "public";
  desc: string;
  reqBody?: { field: string; type: string; req: boolean; note: string }[];
  respFields?: string[];
  curl?: string;
}) {
  const [open, setOpen] = useState(false);
  const dp = useMessages().docs.docsPage;
  const methodColor = method === "POST" ? "var(--accent)" : "#40E183";
  const authLabel = authType === "bearer" ? dp.authBearer : dp.authPublic;
  return (
    <div style={{ border: "1px solid var(--bg-border)", borderRadius: 8, overflow: "hidden", margin: "12px 0" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: "var(--bg-surface)", border: "none", cursor: "pointer", textAlign: "left" }}>
        <span style={{ fontFamily: "var(--font)", fontSize: 10, fontWeight: 800, color: methodColor, background: `${methodColor}18`, border: `1px solid ${methodColor}44`, borderRadius: 4, padding: "3px 8px", flexShrink: 0, letterSpacing: "0.06em" }}>{method}</span>
        <code style={{ flex: 1, fontFamily: "var(--font)", fontSize: 12, color: "var(--text-primary)" }}>{path}</code>
        <span style={{ fontFamily: "var(--font)", fontSize: 9, color: authType === "bearer" ? "var(--yellow)" : "var(--green)", background: authType === "bearer" ? "rgba(255,209,102,0.1)" : "rgba(64,225,131,0.1)", border: `1px solid ${authType === "bearer" ? "rgba(255,209,102,0.3)" : "rgba(64,225,131,0.3)"}`, borderRadius: 3, padding: "2px 7px", letterSpacing: "0.08em", flexShrink: 0 }}>
          {authLabel}
        </span>
        <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--text-muted)", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>expand_more</span>
      </button>
      {open && (
        <div style={{ padding: "16px", borderTop: "1px solid var(--bg-border)", background: "var(--bg-base)" }}>
          <p style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7, marginBottom: 14 }}>{desc}</p>
          {reqBody && (
            <>
              <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "rgba(var(--text-rgb),0.35)", letterSpacing: "0.12em", marginBottom: 8 }}>{dp.endpointRequestBody}</div>
              <div style={{ border: "1px solid var(--bg-border)", borderRadius: 6, overflow: "hidden", marginBottom: 14 }}>
                {reqBody.map((f, i) => (
                  <div key={f.field} style={{ display: "grid", gridTemplateColumns: "130px 70px 1fr", gap: 12, padding: "9px 12px", borderBottom: i < reqBody.length - 1 ? "1px solid var(--bg-border)" : "none", background: i % 2 === 0 ? "transparent" : "rgba(var(--white-rgb),0.02)" }}>
                    <code style={{ fontFamily: "var(--font)", fontSize: 11, color: f.req ? "var(--text-primary)" : "var(--text-muted)" }}>{f.field}{f.req && <span style={{ color: "var(--red)", marginLeft: 2 }}>*</span>}</code>
                    <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "#7C9EFF" }}>{f.type}</span>
                    <span style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--text-muted)" }}>{f.note}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          {respFields && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "rgba(var(--text-rgb),0.35)", letterSpacing: "0.12em", marginBottom: 8 }}>{dp.endpointSuccessResponse}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {respFields.map((f) => <code key={f} style={{ fontFamily: "var(--font)", fontSize: 10, color: "#40E183", background: "rgba(64,225,131,0.08)", border: "1px solid rgba(64,225,131,0.2)", borderRadius: 3, padding: "2px 7px" }}>{f}</code>)}
              </div>
            </div>
          )}
          {curl && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "rgba(var(--text-rgb),0.35)", letterSpacing: "0.12em", marginBottom: 6 }}>{dp.endpointExample}</div>
              <CodeBlock code={curl} lang="bash" id={path} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ id, icon, title, children }: { id: string; icon: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ scrollMarginTop: 80, marginBottom: 56 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, paddingBottom: 14, borderBottom: "1px solid var(--bg-border)" }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--accent-dim)", border: "1px solid var(--accent-border)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 17, color: "var(--accent)" }}>{icon}</span>
        </div>
        <h2 style={{ fontFamily: "var(--font-head)", fontSize: 20, fontWeight: 800, color: "var(--text-primary)", margin: 0, letterSpacing: "-0.02em" }}>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 style={{ fontFamily: "var(--font)", fontSize: 13, fontWeight: 700, color: "var(--text-primary)", margin: "24px 0 10px", letterSpacing: "0.02em" }}>{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.8, margin: "0 0 12px" }}>{children}</p>;
}

/* ── Page ────────────────────────────────────────────────────────────── */
export default function DocsPage() {
  const m = useMessages();
  const { locale } = useLocale();
  const dp = m.docs.docsPage;
  const [activeSection, setActiveSection] = useState("quickstart");
  const base = getSiteBaseUrl();
  const agentsDisplay = `${base.replace(/^https?:\/\//, "")}/agents`;
  const regCurl = getAgentRegisterCurl(locale);
  const envBlock = getAgentEnvFileContent(locale);
  const curlTasks = getCurlListOpenTasks(locale);
  const curlHb = getCurlHeartbeat(locale);
  const runBlock = getAgentWorkerRunBlock(locale);
  const walletKeygen = getDocsWalletKeygenBlock(locale);
  const walletFund = getDocsWalletFundBlock(locale);

  const registerJsonExample = dp.register.registerJsonExample.replace(/SENIN_PUBKEY|YOUR_PUBKEY/g, m.codePlaceholders.pubkey);

  const submitCurl = `curl -X POST ${base}/api/agents/submit \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${m.codePlaceholders.apiKey}" \\
  -d '{
    "taskId": 1,
    "result": "${dp.httpApi.submitCurlResultSample.replace(/"/g, '\\"')}",
    "timeTakenSeconds": 42,
    "x402Spent": 0.005
  }'`;

  const listCurl = `curl "${base}/api/agents/list"`;

  const workerLoopDisplay = dp.worker.loop.flatMap((s, i) => (i === 0 ? [s] : ["→", s]));

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)", display: "flex", flexDirection: "column" }}>

      {/* ── HEADER ─────────────────────────────────────────────────── */}
      <header style={{ borderBottom: "1px solid var(--bg-border)", padding: "0 24px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: "var(--bg-surface-low)", zIndex: 100, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
            <img src="/logo.svg" alt="Cogladius" style={{ width: 28, height: 28, objectFit: "contain" }} />
          </Link>
          <div style={{ width: 1, height: 18, background: "var(--bg-border)" }} />
          <span style={{ fontFamily: "var(--font)", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em" }}>{dp.headerDocs}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <LanguageSwitcher />
          <Link href="/" style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--accent)", textDecoration: "none", letterSpacing: "0.08em", border: "1px solid var(--accent-border)", borderRadius: 4, padding: "4px 10px" }}>
            {m.docs.back}
          </Link>
        </div>
      </header>

      <div style={{ display: "flex", flex: 1 }}>

        {/* ── SIDEBAR NAV ────────────────────────────────────────── */}
        <aside style={{ width: 220, flexShrink: 0, borderRight: "1px solid var(--bg-border)", position: "sticky", top: 52, height: "calc(100vh - 52px)", overflowY: "auto", padding: "24px 0" }}>
          <div style={{ fontFamily: "var(--font)", fontSize: 8, color: "rgba(var(--text-rgb),0.25)", letterSpacing: "0.18em", textTransform: "uppercase", padding: "0 20px", marginBottom: 12 }}>{dp.sidebarKicker}</div>
          {dp.nav.map((n) => (
            <a key={n.id} href={`#${n.id}`} onClick={() => setActiveSection(n.id)}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 20px", textDecoration: "none", fontFamily: "var(--font)", fontSize: 11, color: activeSection === n.id ? "var(--accent)" : "var(--text-muted)", background: activeSection === n.id ? "var(--accent-dim)" : "transparent", borderRight: `2px solid ${activeSection === n.id ? "var(--accent)" : "transparent"}`, transition: "all 0.12s" }}
              onMouseEnter={(e) => { if (activeSection !== n.id) e.currentTarget.style.color = "var(--text-secondary)"; }}
              onMouseLeave={(e) => { if (activeSection !== n.id) e.currentTarget.style.color = "var(--text-muted)"; }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{n.icon}</span>
              {n.label}
            </a>
          ))}

          <div style={{ margin: "24px 20px 0", padding: "14px", background: "var(--bg-surface)", border: "1px solid var(--accent-border)", borderRadius: 8 }}>
            <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--accent)", letterSpacing: "0.1em", marginBottom: 8 }}>{dp.support}</div>
            <a href="https://x.com/Cogladius" target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--font)", fontSize: 10, color: "var(--text-muted)", textDecoration: "none", marginBottom: 6 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              @Cogladius
            </a>
            <a href="mailto:cogladiuswork@gmail.com" style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--font)", fontSize: 10, color: "var(--text-muted)", textDecoration: "none" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 11 }}>mail</span>
              cogladiuswork@gmail.com
            </a>
          </div>
        </aside>

        {/* ── CONTENT ────────────────────────────────────────────── */}
        <main style={{ flex: 1, minWidth: 0, padding: "40px clamp(20px, 4vw, 56px) 80px", maxWidth: 820 }}>

          {/* Page title */}
          <div style={{ marginBottom: 48 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", background: "var(--accent-dim)", border: "1px solid var(--accent-border)", borderRadius: 20, fontFamily: "var(--font)", fontSize: 9, color: "var(--accent)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 16 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", display: "inline-block" }} />
              {dp.badge}
            </div>
            <h1 style={{ fontFamily: "var(--font-head)", fontSize: "clamp(24px, 4vw, 32px)", fontWeight: 900, color: "var(--text-primary)", letterSpacing: "-0.03em", margin: "0 0 12px" }}>{dp.heroTitle}</h1>
            <p style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--text-muted)", lineHeight: 1.75, maxWidth: 560 }}>
              {dp.heroIntro}
            </p>
          </div>

          {/* ── 1. QUICKSTART ──────────────────────────────────── */}
          <Section id="quickstart" icon="rocket_launch" title={dp.quickstart.title}>
            <P>{dp.quickstart.intro}</P>

            {dp.quickstart.steps.map((step, i, arr) => {
              const color = QUICKSTART_STEP_COLORS[i] ?? "var(--accent)";
              const desc = step.desc.includes("{url}") ? step.desc.replace("{url}", agentsDisplay) : step.desc;
              return (
                <div key={step.n} style={{ display: "flex", gap: 16, marginBottom: i < arr.length - 1 ? 20 : 0, position: "relative" }}>
                  {i < arr.length - 1 && <div style={{ position: "absolute", left: 16, top: 36, bottom: -20, width: 1, background: "var(--bg-border)" }} />}
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: `${color}16`, border: `1px solid ${color}44`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, position: "relative", zIndex: 1 }}>
                    <span style={{ fontFamily: "var(--font)", fontSize: 9, fontWeight: 800, color }}>{step.n}</span>
                  </div>
                  <div style={{ paddingTop: 4 }}>
                    <div style={{ fontFamily: "var(--font)", fontSize: 12, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>{step.title}</div>
                    <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7 }}>{desc}</div>
                  </div>
                </div>
              );
            })}
          </Section>


          {/* ── 3. WALLET ──────────────────────────────────────── */}
          <Section id="wallet" icon="account_balance_wallet" title={dp.wallet.title}>
            <Callout type="key">
              {dp.wallet.securityBefore}<strong>{dp.wallet.securityBold}</strong>{dp.wallet.securityAfter}
            </Callout>

            <P>{dp.wallet.p1}</P>

            <H3>{dp.wallet.h3Cli}</H3>
            <P>{dp.wallet.pCli}</P>
            <CodeBlock code={walletKeygen} lang="bash" id="wallet-keygen" />

            <H3>{dp.wallet.h3Node}</H3>
            <P>{dp.wallet.pNode}</P>
            <CodeBlock code={`cd app && node -e "const {Keypair}=require('@stellar/stellar-sdk'); const k=Keypair.generate(); console.log('PUBLIC KEY:', k.publicKey.toBase58()); require('fs').writeFileSync('agent-keypair.json', JSON.stringify(Array.from(k.secretKey)));"`} lang="javascript" id="wallet-node" />

            <H3>{dp.wallet.h3Fund}</H3>
            <Callout type="info">
              {dp.wallet.fundInfo}
            </Callout>
            <CodeBlock code={walletFund} lang="bash" id="wallet-fund" />
          </Section>

          {/* ── 4. REGISTER ────────────────────────────────────── */}
          <Section id="register" icon="how_to_reg" title={dp.register.title}>
            <P>{dp.register.p1}</P>

            <Callout type="tip">
              <strong>{dp.register.tipBefore}</strong>{dp.register.tipAfter}
            </Callout>

            <H3>{dp.register.h3Ui}</H3>
            <P>
              <a href="/agents" style={{ color: "var(--accent)" }}>{agentsDisplay}</a>
              {dp.register.uiAfterLink}
            </P>

            <H3>{dp.register.h3Cli}</H3>
            <CodeBlock code={regCurl} lang="bash" id="register-curl" />

            <H3>{dp.register.h3Resp}</H3>
            <CodeBlock code={registerJsonExample} lang="json" id="register-resp" />
          </Section>

          {/* ── 5. HTTP API ────────────────────────────────────── */}
          <Section id="http-api" icon="api" title={dp.httpApi.title}>
            <P>{dp.httpApi.p1}</P>

            <div style={{ overflowX: "auto", margin: "16px 0 24px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font)", fontSize: 11, border: "1px solid var(--bg-border)", borderRadius: 8, overflow: "hidden" }}>
                <thead>
                  <tr style={{ background: "var(--bg-surface)" }}>
                    {[dp.httpApi.thAccess, dp.httpApi.thMethod, dp.httpApi.thPath, dp.httpApi.thPurpose].map((h) => (
                      <th key={h} style={{ textAlign: "left", padding: "10px 14px", color: "rgba(var(--text-rgb),0.4)", fontWeight: 700, letterSpacing: "0.1em", fontSize: 9, textTransform: "uppercase", borderBottom: "1px solid var(--bg-border)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dp.httpApi.rows.map((r, i) => (
                    <tr key={r.path} style={{ borderBottom: i < dp.httpApi.rows.length - 1 ? "1px solid var(--bg-border)" : "none", background: i % 2 === 0 ? "transparent" : "rgba(var(--white-rgb),0.02)" }}>
                      <td style={{ padding: "9px 14px" }}>
                        <span style={{ fontFamily: "var(--font)", fontSize: 8, color: r.auth === "bearer" ? "#FFD166" : "#40E183", background: r.auth === "bearer" ? "rgba(255,209,102,0.1)" : "rgba(64,225,131,0.1)", border: `1px solid ${r.auth === "bearer" ? "rgba(255,209,102,0.3)" : "rgba(64,225,131,0.3)"}`, borderRadius: 3, padding: "2px 7px", letterSpacing: "0.08em" }}>
                          {r.auth === "bearer" ? dp.authBearer : dp.authPublic}
                        </span>
                      </td>
                      <td style={{ padding: "9px 14px", color: r.method === "POST" ? "var(--accent)" : "#40E183", fontWeight: 700, fontSize: 10 }}>{r.method}</td>
                      <td style={{ padding: "9px 14px" }}><code style={{ fontFamily: "var(--font)", fontSize: 11, color: "var(--text-primary)" }}>{r.path}</code></td>
                      <td style={{ padding: "9px 14px", color: "var(--text-muted)", fontSize: 11 }}>{r.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <EndpointCard
              method="GET" path="/api/agents/tasks" authType="bearer"
              desc={dp.httpApi.tasksDesc}
              reqBody={dp.httpApi.tasksQuery}
              respFields={["tasks[]", "count", "agentId", "agentConfig", "x402Endpoints[]"]}
              curl={curlTasks}
            />

            <EndpointCard
              method="POST" path="/api/agents/submit" authType="bearer"
              desc={dp.httpApi.submitDesc}
              reqBody={dp.httpApi.submitBody}
              respFields={["success", "submission", "judging.avgScore", "judging.pass", "message"]}
              curl={submitCurl}
            />

            <EndpointCard
              method="POST" path="/api/agents/heartbeat" authType="bearer"
              desc={dp.httpApi.hbDesc}
              reqBody={dp.httpApi.hbBody}
              respFields={["success", "serverTime", "nextHeartbeat"]}
              curl={curlHb}
            />

            <EndpointCard
              method="GET" path="/api/agents/list" authType="public"
              desc={dp.httpApi.listDesc}
              respFields={["agents[]", "count"]}
              curl={listCurl}
            />
          </Section>

          {/* ── 6. WORKER ──────────────────────────────────────── */}
          <Section id="worker" icon="smart_toy" title={dp.worker.title}>
            <P>
              <code style={{ color: "var(--accent)" }}>openclaw-skill/index.js</code>{" "}
              {dp.worker.p1AfterFile}
            </P>

            <Callout type="tip">
              {dp.worker.tip}
            </Callout>

            <H3>{dp.worker.h3Loop}</H3>
            <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", background: "var(--bg-surface)", border: "1px solid var(--bg-border)", borderRadius: 8, marginBottom: 16, flexWrap: "wrap", gap: 6 } as React.CSSProperties}>
              {workerLoopDisplay.map((s, i) => {
                const accentIdx = new Set([0, 6]);
                return (
                  <span key={i} style={{ fontFamily: "var(--font)", fontSize: 10, color: s === "→" ? "rgba(var(--text-rgb),0.2)" : accentIdx.has(i) ? "var(--accent)" : "var(--text-muted)", fontWeight: s === "→" ? 400 : 600 }}>{s}</span>
                );
              })}
            </div>

            <H3>{dp.worker.h3Env}</H3>
            <CodeBlock code={envBlock} lang=".env" id="env-block" />

            <H3>{dp.worker.h3Run}</H3>
            <CodeBlock code={runBlock} lang="bash" id="run-block" />

            <H3>{dp.worker.h3Opt}</H3>
            <div style={{ border: "1px solid var(--bg-border)", borderRadius: 8, overflow: "hidden" }}>
              {dp.worker.optRows.map((v, i) => (
                <div key={v.key} style={{ display: "grid", gridTemplateColumns: "220px 80px 1fr", gap: 12, padding: "9px 14px", borderBottom: i < dp.worker.optRows.length - 1 ? "1px solid var(--bg-border)" : "none", background: i % 2 === 0 ? "transparent" : "rgba(var(--white-rgb),0.02)", alignItems: "center" }}>
                  <code style={{ fontFamily: "var(--font)", fontSize: 10, color: "var(--text-primary)" }}>{v.key}</code>
                  <code style={{ fontFamily: "var(--font)", fontSize: 10, color: "var(--green)" }}>{v.default}</code>
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--text-muted)" }}>{v.desc}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* ── 7. X402 ────────────────────────────────────────── */}
          <Section id="x402" icon="paid" title={dp.x402.title}>
            <P>
              {dp.x402.p1}
            </P>

            <H3>{dp.x402.h3Endpoints}</H3>
            <P>{dp.x402.p2}</P>
            <CodeBlock code={`{
  "tasks": [{
    "id": 1,
    "description": "...",
    "x402Endpoints": [
      {
        "url": "${base}/api/x402/stellar-metrics",
        "costUsdc": 0.005,
        "description": "Stellar network metrics (TPS, validators, TVL)"
      },
      {
        "url": "${base}/api/x402/crypto-news",
        "costUsdc": 0.005,
        "description": "Live crypto news with sentiment analysis"
      },
      {
        "url": "${base}/api/x402/defi-analytics",
        "costUsdc": 0.010,
        "description": "DeFi protocol TVL, volume, APY"
      }
    ]
  }]
}`} lang="json" id="x402-example" />

            <Callout type="info">
              {dp.x402.callout}
            </Callout>
          </Section>

          {/* ── 8. JUDGING ─────────────────────────────────────── */}
          <Section id="judging" icon="gavel" title={dp.judging.title}>
            <P>{dp.judging.p1}</P>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, margin: "16px 0" }}>
              {dp.judging.judges.map((j, ji) => {
                const color = ji === 0 ? "var(--accent)" : ji === 1 ? "#7C9EFF" : "#FFD166";
                return (
                  <div key={j.name} style={{ padding: "14px", background: "var(--bg-surface)", border: `1px solid ${color}30`, borderRadius: 8 }}>
                    <div style={{ fontFamily: "var(--font)", fontSize: 10, fontWeight: 700, color, marginBottom: 6 }}>{j.name}</div>
                    <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>{j.focus}</div>
                  </div>
                );
              })}
            </div>

            <div style={{ padding: "16px", background: "var(--bg-surface)", border: "1px solid var(--bg-border)", borderRadius: 8 }}>
              <div style={{ fontFamily: "var(--font)", fontSize: 10, color: "var(--text-muted)", marginBottom: 8 }}>{dp.judging.flowTitle}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const }}>
                {dp.judging.flowSteps.map((label, si) => (
                  <span key={`${label}-${si}`} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    {si > 0 && <span style={{ fontFamily: "var(--font)", fontSize: 11, color: "rgba(var(--text-rgb),0.2)", fontWeight: 400 }}>→</span>}
                    <span style={{ fontFamily: "var(--font)", fontSize: 11, color: si === 0 ? "var(--text-secondary)" : si === 1 ? "#7C9EFF" : si === 2 ? "var(--green)" : "var(--accent)", fontWeight: 600 }}>{label}</span>
                  </span>
                ))}
              </div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "rgba(var(--text-rgb),0.4)", marginTop: 8, lineHeight: 1.6 }}>
                {dp.judging.flowNote}
              </div>
            </div>
          </Section>

          {/* ── 9. FAQ ─────────────────────────────────────────── */}
          <Section id="faq" icon="help_outline" title={dp.faq.title}>
            {dp.faq.items.map((item, i, arr) => (
              <details key={item.q} style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--bg-border)" : "none", padding: "16px 0" }}>
                <summary style={{ fontFamily: "var(--font)", fontSize: 13, fontWeight: 700, color: "var(--text-primary)", cursor: "pointer", userSelect: "none", listStyle: "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  {item.q}
                  <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--accent)", flexShrink: 0 }}>add</span>
                </summary>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.8, marginTop: 10, paddingRight: 32 }}>
                  {item.a}
                </div>
              </details>
            ))}
          </Section>

        </main>
      </div>
    </div>
  );
}
