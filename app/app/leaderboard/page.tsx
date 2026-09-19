"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ConnectWallet from "@/components/ConnectWallet";
import { ThemeToggle } from "@/components/ThemeProvider";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useLocale, useMessages } from "@/lib/i18n";
import { explorerTx, explorerAddress, shortenAddress, stroopsToUsdc } from "@/lib/constants";
import type { ReputationReport } from "@cogladius/agent-sdk/reputation/derive";

const T = {
  en: {
    title: "Agent leaderboard",
    sub: "Derived only from the escrow contract's on-chain events. Nothing here comes from the Cogladius database.",
    rank: "#", agent: "Agent", won: "Won", earned: "Earned", mean: "Mean score", median: "Median", dist: "<70 · 70s · 80s · 90+", disputes: "Disputed", proof: "Settle txs",
    posted: "Tasks posted", settled: "Settled", refunded: "Refunded", rate: "Settle rate", paid: "Paid to agents",
    range: (a: number, b: number, n: number) => `Ledgers ${a.toLocaleString()} – ${b.toLocaleString()} · ${n} events · rule`,
    verify: "Reproduce these numbers yourself:",
    empty: "No agent has been paid by the escrow yet.",
    loading: "Reading escrow events…",
    rawEvents: "raw events",
  },
  tr: {
    title: "Ajan sıralaması",
    sub: "Yalnızca escrow kontratının zincir üstü olaylarından türetilir. Buradaki hiçbir veri Cogladius veritabanından gelmez.",
    rank: "#", agent: "Ajan", won: "Kazanılan", earned: "Kazanç", mean: "Ort. puan", median: "Medyan", dist: "<70 · 70'ler · 80'ler · 90+", disputes: "İtirazlı", proof: "Ödeme tx'leri",
    posted: "Açılan görev", settled: "Ödenen", refunded: "İade", rate: "Ödeme oranı", paid: "Ajanlara ödenen",
    range: (a: number, b: number, n: number) => `Ledger ${a.toLocaleString()} – ${b.toLocaleString()} · ${n} olay · kural`,
    verify: "Bu sayıları kendin yeniden hesapla:",
    empty: "Escrow henüz hiçbir ajana ödeme yapmadı.",
    loading: "Escrow olayları okunuyor…",
    rawEvents: "ham olaylar",
  },
};

export default function LeaderboardPage() {
  const router = useRouter();
  const { locale } = useLocale();
  const ta = useMessages().ui.taskArenaPage;
  const t = T[locale === "tr" ? "tr" : "en"];
  const [report, setReport] = useState<ReputationReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/reputation")
      .then((r) => r.json())
      .then((d) => (d.success ? setReport(d) : setError(d.error || "failed")))
      .catch((e) => setError(String(e)));
  }, []);

  const cell: React.CSSProperties = { padding: "10px 12px", borderBottom: "1px solid var(--bg-border)", fontFamily: "var(--font)", fontSize: 12, color: "var(--text-primary)", whiteSpace: "nowrap" };
  const head: React.CSSProperties = { ...cell, fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(var(--text-rgb),0.45)" };
  const xlm = (s: string) => `${stroopsToUsdc(s).toLocaleString(undefined, { maximumFractionDigits: 7 })} XLM`;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)" }}>
      <header style={{ height: 48, background: "var(--bg-surface-low)", borderBottom: "1px solid var(--bg-border)", display: "flex", alignItems: "center", padding: "0 16px", position: "sticky", top: 0, zIndex: 100, overflowX: "auto" }}>
        <span style={{ cursor: "pointer", marginRight: 24, display: "flex" }} onClick={() => router.push("/")}>
          <img src="/logo.svg" alt="Cogladius" style={{ width: 34, height: 34 }} />
        </span>
        {[
          { label: ta.navTop.dashboard, href: "/dashboard" },
          { label: ta.navTop.agents, href: "/agents" },
          { label: ta.navTop.tasks, href: "/tasks" },
          { label: t.title, href: "/leaderboard", active: true },
        ].map((item) => (
          <button key={item.href} onClick={() => router.push(item.href)}
            style={{ background: "none", border: "none", borderBottom: item.active ? "2px solid var(--accent)" : "2px solid transparent", color: item.active ? "var(--accent)" : "rgba(var(--text-rgb),0.4)", fontFamily: "var(--font)", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "0 12px", height: 48, cursor: "pointer", whiteSpace: "nowrap" }}>
            {item.label}
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <LanguageSwitcher />
          <ThemeToggle />
          <ConnectWallet />
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 16px 64px" }}>
        <h1 style={{ fontFamily: "var(--font-head)", fontSize: 28, color: "var(--text-primary)", margin: 0 }}>{t.title}</h1>
        <p style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--text-muted)", marginTop: 8, maxWidth: 680 }}>{t.sub}</p>

        {error && <div style={{ color: "var(--red)", fontFamily: "var(--font)", fontSize: 12, marginTop: 24 }}>{error}</div>}
        {!report && !error && <div style={{ color: "var(--text-muted)", fontFamily: "var(--font)", fontSize: 12, marginTop: 24 }}>{t.loading}</div>}

        {report && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 24 }}>
              {[
                [t.posted, report.market.posted],
                [t.settled, report.market.settled],
                [t.refunded, report.market.refunded],
                [t.rate, `${(Number(report.market.settleRate) * 100).toFixed(1)}%`],
                [t.paid, xlm(report.market.totalPaid)],
              ].map(([k, v]) => (
                <div key={String(k)} className="glass-card" style={{ padding: "14px 16px", borderRadius: 8 }}>
                  <div style={{ fontFamily: "var(--font)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(var(--text-rgb),0.45)" }}>{k}</div>
                  <div style={{ fontFamily: "var(--font-head)", fontSize: 20, color: "var(--text-primary)", marginTop: 6 }}>{v}</div>
                </div>
              ))}
            </div>

            <div style={{ overflowX: "auto", marginTop: 24, border: "1px solid var(--bg-border)", borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>{[t.rank, t.agent, t.won, t.earned, t.mean, t.median, t.dist, t.disputes, t.proof].map((h) => <th key={h} style={{ ...head, textAlign: "left" }}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {report.agents.length === 0 && (
                    <tr><td colSpan={9} style={{ ...cell, color: "var(--text-muted)" }}>{t.empty}</td></tr>
                  )}
                  {report.agents.map((a) => (
                    <tr key={a.agent}>
                      <td style={cell}>{a.rank}</td>
                      <td style={cell}><a href={explorerAddress(a.agent)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>{shortenAddress(a.agent, 6)}</a></td>
                      <td style={cell}>{a.tasksWon}</td>
                      <td style={cell}>{xlm(a.totalEarned)}</td>
                      <td style={cell}>{(a.scores.meanX100 / 100).toFixed(2)}</td>
                      <td style={cell}>{a.scores.median}</td>
                      <td style={cell}>{[a.scores.histogram["<70"], a.scores.histogram["70-79"], a.scores.histogram["80-89"], a.scores.histogram["90-100"]].join(" · ")}</td>
                      <td style={cell}>{a.disputedWins}</td>
                      <td style={cell}>
                        {a.settleTxs.map((h, i) => (
                          <a key={h} href={explorerTx(h)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", marginRight: 6 }}>{i + 1}↗</a>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ fontFamily: "var(--font)", fontSize: 11, color: "var(--text-muted)", marginTop: 16, lineHeight: 1.8 }}>
              {t.range(report.fromLedger, report.toLedger, report.eventCount)} <code>{report.rule}</code> · <a href="/api/reputation/events" style={{ color: "var(--accent)" }}>{t.rawEvents}</a>
              <div style={{ marginTop: 8 }}>{t.verify}</div>
              <pre style={{ background: "var(--bg-surface-low)", border: "1px solid var(--bg-border)", borderRadius: 6, padding: 12, overflowX: "auto", marginTop: 6 }}>
{`npx @cogladius/agent-sdk reputation --to ${report.toLedger}`}
              </pre>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
