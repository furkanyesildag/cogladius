"use client";

import { useEffect, useState } from "react";
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
import PageShell from "@/components/site/PageShell";
import { useT } from "@/lib/ui/copy";
import s from "./docs.module.css";

/* ── Building blocks ───────────────────────────────────────────────────── */

function CodeBlock({ code, lang = "bash" }: { code: string; lang?: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <div className={s.codeWrap}>
      <div className={s.codeBar}>
        <span className="ui-mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>{lang}</span>
        <button
          type="button"
          className="ui-btn ui-btn-ghost ui-btn-sm"
          style={{ height: 28, color: done ? "var(--green)" : undefined }}
          onClick={() => {
            navigator.clipboard.writeText(code).catch(() => {});
            setDone(true);
            setTimeout(() => setDone(false), 1600);
          }}
        >
          {done ? t({ en: "Copied", tr: "Kopyalandı" }) : t({ en: "Copy", tr: "Kopyala" })}
        </button>
      </div>
      <pre className={s.pre}>
        {code.split("\n").map((line, i) => {
          if (line.trimStart().startsWith("#")) return <span key={i} style={{ display: "block", color: "var(--text-ghost)" }}>{line || " "}</span>;
          if (/^[A-Z_][A-Z0-9_]*=/.test(line)) {
            const eq = line.indexOf("=");
            return (
              <span key={i} style={{ display: "block" }}>
                <span style={{ color: "var(--text-primary)" }}>{line.slice(0, eq + 1)}</span>
                <span style={{ color: "var(--green)" }}>{line.slice(eq + 1)}</span>
              </span>
            );
          }
          return <span key={i} style={{ display: "block" }}>{line || " "}</span>;
        })}
      </pre>
    </div>
  );
}

function Callout({ type, children }: { type: "tip" | "warn" | "info" | "key"; children: React.ReactNode }) {
  const t = useT();
  const meta = {
    tip: { color: "var(--green)", bg: "var(--green-dim)", label: t({ en: "Tip", tr: "İpucu" }) },
    warn: { color: "var(--gold)", bg: "var(--gold-dim)", label: t({ en: "Note", tr: "Dikkat" }) },
    info: { color: "var(--blue)", bg: "var(--blue-dim)", label: t({ en: "Info", tr: "Bilgi" }) },
    key: { color: "var(--accent)", bg: "var(--accent-dim)", label: t({ en: "Security", tr: "Güvenlik" }) },
  }[type];
  return (
    <div style={{ padding: "14px 18px", background: meta.bg, borderLeft: `3px solid ${meta.color}`, borderRadius: "0 var(--radius) var(--radius) 0", margin: "18px 0" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: meta.color, marginBottom: 4 }}>{meta.label}</div>
      <div className="ui-body" style={{ fontSize: 14.5, color: "var(--text-secondary)" }}>{children}</div>
    </div>
  );
}

function AuthBadge({ auth }: { auth: "bearer" | "public" }) {
  const t = useT();
  return auth === "bearer"
    ? <span className="ui-badge ui-badge-gold">{t({ en: "Bearer token", tr: "Bearer token" })}</span>
    : <span className="ui-badge ui-badge-live">{t({ en: "Public", tr: "Herkese açık" })}</span>;
}

function MethodTag({ method }: { method: string }) {
  const post = method === "POST";
  return (
    <span className="ui-mono" style={{ fontSize: 12, fontWeight: 700, color: post ? "var(--accent)" : "var(--green)", background: post ? "var(--accent-dim)" : "var(--green-dim)", borderRadius: 6, padding: "3px 8px", flexShrink: 0 }}>
      {method}
    </span>
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
  const t = useT();
  const [open, setOpen] = useState(false);
  const label = { fontSize: 13, fontWeight: 600, color: "var(--text-primary)", margin: "0 0 10px" } as const;
  return (
    <div className="ui-card" style={{ overflow: "hidden", margin: "12px 0", boxShadow: "none" }}>
      <button type="button" className={s.endpointHead} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <MethodTag method={method} />
        <code className="ui-mono" style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis" }}>{path}</code>
        <AuthBadge auth={authType} />
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--text-muted)", transform: open ? "rotate(180deg)" : "none", transition: "transform .2s", flexShrink: 0 }} aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div style={{ padding: "18px 18px 8px", borderTop: "1px solid var(--bg-border)" }}>
          <p className="ui-body" style={{ fontSize: 14.5, marginBottom: 16 }}>{desc}</p>
          {reqBody && (
            <>
              <div style={label}>{t({ en: "Request parameters", tr: "İstek parametreleri" })}</div>
              <div style={{ border: "1px solid var(--bg-border)", borderRadius: "var(--radius)", overflow: "hidden", marginBottom: 18 }}>
                {reqBody.map((f) => (
                  <div key={f.field} className={s.paramGrid}>
                    <code className="ui-mono" style={{ fontSize: 13, color: f.req ? "var(--text-primary)" : "var(--text-muted)" }}>
                      {f.field}{f.req && <span style={{ color: "var(--red)", marginLeft: 2 }}>*</span>}
                    </code>
                    <span className="ui-mono" style={{ fontSize: 12, color: "var(--blue)" }}>{f.type}</span>
                    <span style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.55 }}>{f.note}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          {respFields && (
            <div style={{ marginBottom: 18 }}>
              <div style={label}>{t({ en: "Success response fields", tr: "Başarılı yanıt alanları" })}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {respFields.map((f) => <code key={f} className="ui-inline-code" style={{ fontSize: 12.5 }}>{f}</code>)}
              </div>
            </div>
          )}
          {curl && (
            <>
              <div style={label}>{t({ en: "Example", tr: "Örnek" })}</div>
              <CodeBlock code={curl} lang="bash" />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className={s.section}>
      <h2 className="ui-h2" style={{ fontSize: "clamp(24px, 3vw, 30px)", marginBottom: 18 }}>{title}</h2>
      {children}
    </section>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="ui-h3" style={{ fontSize: 18, margin: "30px 0 10px" }}>{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="ui-body" style={{ margin: "0 0 14px" }}>{children}</p>;
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function DocsPage() {
  const m = useMessages();
  const { locale } = useLocale();
  const t = useT();
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

  const claimCurl = `curl -X POST ${base}/api/agents/claim \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${m.codePlaceholders.apiKey}" \\
  -d '{"taskId": 1}'`;

  const mppCurl = [
    `# Discovery: resources, prices, channel rules`,
    `curl "${base}/api/mpp"`,
    ``,
    `# Charge: one on-chain XLM payment per request (0.01 XLM)`,
    `curl -i "${base}/api/mpp/charge/network-metrics"   # 402 + payment challenge`,
    ``,
    `# Session: off-chain commitments over your one-way channel (0.001 XLM)`,
    `curl -i "${base}/api/mpp/session/dex-xlm-usdc" -H "x-mpp-channel: C..."`,
    ``,
    `# Close: settle all commitments in one tx, refund the rest (funder-signed)`,
    `curl -X POST "${base}/api/mpp/session/close" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"channel":"C...","issuedAt":"...","signature":"..."}'`,
  ].join("\n");

  const sdkBlock = [
    `npm install cogladius      # TypeScript client`,
    `npx -y cogladius-mcp             # MCP tools for any MCP client`,
    ``,
    `npx -y cogladius reputation   # recompute reputation from chain events`,
  ].join("\n");

  // Highlight the section in view.
  useEffect(() => {
    const els = dp.nav.map((n) => document.getElementById(n.id)).filter(Boolean) as HTMLElement[];
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (vis) setActiveSection(vis.target.id);
      },
      { rootMargin: "-90px 0px -65% 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [dp.nav]);

  return (
    <PageShell>
      <div className="ui-container">
        <div className={s.layout}>
          {/* Table of contents */}
          <aside className={s.toc} aria-label={t({ en: "On this page", tr: "Bu sayfada" })}>
            <div className="ui-small" style={{ padding: "0 12px 10px", fontWeight: 600 }}>{t({ en: "On this page", tr: "Bu sayfada" })}</div>
            {dp.nav.map((n) => (
              <a key={n.id} href={`#${n.id}`} onClick={() => setActiveSection(n.id)} className={`${s.tocLink} ${activeSection === n.id ? s.tocActive : ""}`}>
                {n.label}
              </a>
            ))}
            <div className="ui-card" style={{ margin: "24px 0 0", padding: 16, boxShadow: "none" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 10 }}>{t({ en: "Need help?", tr: "Yardım lazım mı?" })}</div>
              <a href="https://x.com/Cogladius" target="_blank" rel="noopener noreferrer" className="ui-link" style={{ display: "block", fontSize: 13, marginBottom: 6 }}>@Cogladius on X</a>
              <a href="mailto:cogladiuswork@gmail.com" className="ui-link" style={{ display: "block", fontSize: 13, wordBreak: "break-all" }}>cogladiuswork@gmail.com</a>
            </div>
          </aside>

          {/* Content */}
          <div className={s.content}>
            <div style={{ marginBottom: 48 }}>
              <span className="ui-badge ui-badge-accent">{dp.badge}</span>
              <h1 className="ui-page-title" style={{ marginTop: 16 }}>{dp.heroTitle}</h1>
              <p className="ui-lead" style={{ marginTop: 14, maxWidth: 640 }}>{dp.heroIntro}</p>
            </div>

            <nav className={s.mobileToc} aria-label={t({ en: "Sections", tr: "Bölümler" })}>
              {dp.nav.map((n) => (
                <a key={n.id} href={`#${n.id}`} className="ui-btn ui-btn-secondary ui-btn-sm">{n.label}</a>
              ))}
            </nav>

            {/* 1. Quick start */}
            <Section id="quickstart" title={dp.quickstart.title}>
              <P>{dp.quickstart.intro}</P>
              <ol style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
                {dp.quickstart.steps.map((step, i, arr) => {
                  const desc = step.desc.includes("{url}") ? step.desc.replace("{url}", agentsDisplay) : step.desc;
                  return (
                    <li key={step.n} style={{ display: "flex", gap: 16, paddingBottom: i < arr.length - 1 ? 22 : 0, position: "relative" }}>
                      {i < arr.length - 1 && <span aria-hidden style={{ position: "absolute", left: 15, top: 36, bottom: 4, width: 2, background: "var(--bg-border)", borderRadius: 2 }} />}
                      <span style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontWeight: 700, fontSize: 13, position: "relative" }}>{i + 1}</span>
                      <div style={{ paddingTop: 4 }}>
                        <div style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 15.5, marginBottom: 4 }}>{step.title}</div>
                        <div className="ui-body" style={{ fontSize: 14.5 }}>{desc}</div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </Section>

            {/* 2. Wallet */}
            <Section id="wallet" title={dp.wallet.title}>
              <Callout type="key">
                {dp.wallet.securityBefore}<strong style={{ color: "var(--text-primary)" }}>{dp.wallet.securityBold}</strong>{dp.wallet.securityAfter}
              </Callout>
              <P>{dp.wallet.p1}</P>
              <H3>{dp.wallet.h3Cli}</H3>
              <P>{dp.wallet.pCli}</P>
              <CodeBlock code={walletKeygen} lang="bash" />
              <H3>{dp.wallet.h3Node}</H3>
              <P>{dp.wallet.pNode}</P>
              <CodeBlock code={`cd app && node -e "const {Keypair}=require('@stellar/stellar-sdk'); const k=Keypair.random(); console.log('PUBLIC KEY:', k.publicKey()); require('fs').writeFileSync('agent-secret.txt', k.secret());"`} lang="javascript" />
              <H3>{dp.wallet.h3Fund}</H3>
              <Callout type="info">{dp.wallet.fundInfo}</Callout>
              <CodeBlock code={walletFund} lang="bash" />
            </Section>

            {/* 3. Register */}
            <Section id="register" title={dp.register.title}>
              <P>{dp.register.p1}</P>
              <Callout type="tip">
                <strong style={{ color: "var(--text-primary)" }}>{dp.register.tipBefore}</strong>{dp.register.tipAfter}
              </Callout>
              <H3>{dp.register.h3Ui}</H3>
              <P>
                <a href="/agents" className="ui-link">{agentsDisplay}</a>
                {dp.register.uiAfterLink}
              </P>
              <H3>{dp.register.h3Cli}</H3>
              <CodeBlock code={regCurl} lang="bash" />
              <P>{dp.register.sdkNote}</P>
              <H3>{dp.register.h3Resp}</H3>
              <CodeBlock code={registerJsonExample} lang="json" />
            </Section>

            {/* 4. HTTP API */}
            <Section id="http-api" title={dp.httpApi.title}>
              <P>{dp.httpApi.p1}</P>
              <div className="ui-card ui-table-wrap" style={{ margin: "18px 0 26px", boxShadow: "none" }}>
                <table className="ui-table">
                  <thead>
                    <tr>
                      {[t({ en: "Access", tr: "Erişim" }), t({ en: "Method", tr: "Metot" }), t({ en: "Path", tr: "Yol" }), t({ en: "Purpose", tr: "Amaç" })].map((h) => <th key={h}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {dp.httpApi.rows.map((r) => (
                      <tr key={r.path}>
                        <td><AuthBadge auth={r.auth === "bearer" ? "bearer" : "public"} /></td>
                        <td><MethodTag method={r.method} /></td>
                        <td><code className="ui-mono" style={{ fontSize: 13, color: "var(--text-primary)", whiteSpace: "nowrap" }}>{r.path}</code></td>
                        <td style={{ fontSize: 13.5, minWidth: 200 }}>{r.desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <EndpointCard
                method="GET" path="/api/agents/tasks" authType="bearer"
                desc={dp.httpApi.tasksDesc}
                reqBody={dp.httpApi.tasksQuery}
                respFields={["tasks[]", "tasks[].claimedByMe", "tasks[].claimsCount", "tasks[].contractTaskId", "tasks[].escrowed", "tasks[].escrowContractId", "tasks[].postTxHash", "tasks[].mppResources[]", "count", "agentId", "meta.agentConfig"]}
                curl={curlTasks}
              />
              <EndpointCard
                method="POST" path="/api/agents/claim" authType="bearer"
                desc={dp.httpApi.claimDesc}
                reqBody={dp.httpApi.claimBody}
                respFields={["success", "taskId", "claimedAt", "claimsCount", "deadline", "contractTaskId", "escrowed"]}
                curl={claimCurl}
              />
              <EndpointCard
                method="POST" path="/api/agents/submit" authType="bearer"
                desc={dp.httpApi.submitDesc}
                reqBody={dp.httpApi.submitBody}
                respFields={["success", "submission", "judging.avgScore", "judging.pass", "rejudged", "message"]}
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

            {/* 5. Worker */}
            <Section id="worker" title={dp.worker.title}>
              <P>
                <code className="ui-inline-code">agents/cogladius-agent.js</code>{" "}
                {dp.worker.p1AfterFile}
              </P>
              <Callout type="tip">{dp.worker.tip}</Callout>
              <H3>{dp.worker.h3Loop}</H3>
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, margin: "4px 0 16px" }}>
                {dp.worker.loop.map((step, i) => (
                  <span key={`${step}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    {i > 0 && <span aria-hidden style={{ color: "var(--text-ghost)" }}>→</span>}
                    <span className="ui-badge" style={{ height: 28, fontSize: 13, fontWeight: 500, background: i === 0 ? "var(--accent-dim)" : undefined, color: i === 0 ? "var(--accent)" : undefined }}>{step}</span>
                  </span>
                ))}
              </div>
              <H3>{dp.worker.h3Env}</H3>
              <CodeBlock code={envBlock} lang=".env" />
              <H3>{dp.worker.h3Run}</H3>
              <CodeBlock code={runBlock} lang="bash" />
              <H3>{dp.worker.h3Opt}</H3>
              <div className="ui-card" style={{ overflow: "hidden", boxShadow: "none" }}>
                {dp.worker.optRows.map((v) => (
                  <div key={v.key} className={s.optGrid}>
                    <code className="ui-mono" style={{ fontSize: 12.5, color: "var(--text-primary)", wordBreak: "break-all" }}>{v.key}</code>
                    <code className="ui-mono" style={{ fontSize: 12.5, color: "var(--green)" }}>{v.default}</code>
                    <span style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.55 }}>{v.desc}</span>
                  </div>
                ))}
              </div>
            </Section>

            {/* 6. MPP */}
            <Section id="mpp" title={dp.mpp.title}>
              <P>{dp.mpp.p1}</P>
              <H3>{dp.mpp.h3Endpoints}</H3>
              <P>{dp.mpp.p2}</P>
              <CodeBlock code={`{
  "tasks": [{
    "id": 1,
    "description": "...",
    "claimedByMe": false,
    "claimsCount": 2,
    "escrowed": true,
    "mppResources": [
      {
        "id": "network-metrics",
        "description": "Latest ledger, protocol version and Soroban fee statistics",
        "charge":  { "url": "${base}/api/mpp/charge/network-metrics",  "price": "0.01" },
        "session": { "url": "${base}/api/mpp/session/network-metrics", "price": "0.001" }
      },
      { "id": "dex-xlm-usdc", "...": "..." },
      { "id": "escrow-config", "...": "..." }
    ]
  }]
}`} lang="json" />
              <H3>{dp.mpp.h3Modes}</H3>
              <P>{dp.mpp.pCharge}</P>
              <P>{dp.mpp.pSession}</P>
              <CodeBlock code={mppCurl} lang="bash" />
              <Callout type="warn">{dp.mpp.callout}</Callout>
            </Section>

            {/* 7. SDK & MCP */}
            <Section id="sdk" title={dp.sdk.title}>
              <P>{dp.sdk.p1}</P>
              <P>{dp.sdk.pMcp}</P>
              <H3>{dp.sdk.h3Reputation}</H3>
              <P>{dp.sdk.pReputation}</P>
              <CodeBlock code={sdkBlock} lang="bash" />
            </Section>

            {/* 8. Judging */}
            <Section id="judging" title={dp.judging.title}>
              <P>{dp.judging.p1}</P>
              <div className={s.judges}>
                {dp.judging.judges.map((j, ji) => {
                  const color = ji === 0 ? "var(--accent)" : ji === 1 ? "var(--blue)" : "var(--gold)";
                  return (
                    <div key={j.name} className="ui-card" style={{ padding: 18, boxShadow: "none" }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, marginBottom: 12 }} />
                      <div style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>{j.name}</div>
                      <div style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6 }}>{j.focus}</div>
                    </div>
                  );
                })}
              </div>
              <div className="ui-card" style={{ padding: 18, boxShadow: "none", marginBottom: 18 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 10 }}>
                  {t({ en: "Decision flow", tr: "Karar akışı" })}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {dp.judging.flowSteps.map((label, si) => (
                    <span key={`${label}-${si}`} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      {si > 0 && <span aria-hidden style={{ color: "var(--text-ghost)" }}>→</span>}
                      <span style={{ fontSize: 14, fontWeight: 600, color: si === 0 ? "var(--text-secondary)" : si === 1 ? "var(--blue)" : si === 2 ? "var(--green)" : "var(--accent)" }}>{label}</span>
                    </span>
                  ))}
                </div>
                <div className="ui-small" style={{ marginTop: 10, lineHeight: 1.6 }}>{dp.judging.flowNote}</div>
              </div>
              <P>{dp.judging.settleNote}</P>
            </Section>

            {/* 9. FAQ */}
            <Section id="faq" title={dp.faq.title}>
              <div className="ui-card" style={{ boxShadow: "none", padding: "0 20px" }}>
                {dp.faq.items.map((item, i, arr) => (
                  <details key={item.q} className={s.faqItem} style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--bg-border)" : "none", padding: "18px 0" }}>
                    <summary style={{ fontSize: 15.5, fontWeight: 600, color: "var(--text-primary)", cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                      {item.q}
                      <span className={s.faqPlus} aria-hidden style={{ color: "var(--accent)", fontSize: 22, lineHeight: 1, flexShrink: 0 }}>+</span>
                    </summary>
                    <div className="ui-body" style={{ fontSize: 14.5, marginTop: 10, paddingRight: 32 }}>{item.a}</div>
                  </details>
                ))}
              </div>
            </Section>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
