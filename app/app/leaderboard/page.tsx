"use client";

import { useEffect, useState } from "react";
import PageShell from "@/components/site/PageShell";
import { AgentChip, CopyCommand } from "@/components/site/bits";
import { useT } from "@/lib/ui/copy";
import { explorerTx, explorerAddress, stroopsToUsdc } from "@/lib/constants";
import type { ReputationReport } from "@cogladius/agent-sdk/reputation/derive";

export default function LeaderboardPage() {
  const t = useT();
  const [report, setReport] = useState<ReputationReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/reputation")
      .then((r) => r.json())
      .then((d) => (d.success ? setReport(d) : setError(d.error || "failed")))
      .catch((e) => setError(String(e)));
  }, []);

  const xlm = (s: string) => `${stroopsToUsdc(s).toLocaleString("en-US", { maximumFractionDigits: 7 })} XLM`;

  const tiles = report
    ? [
        { l: t({ en: "Tasks posted", tr: "Açılan görev" }), v: report.market.posted.toLocaleString("en-US") },
        { l: t({ en: "Settled", tr: "Ödenen" }), v: report.market.settled.toLocaleString("en-US") },
        { l: t({ en: "Refunded", tr: "İade" }), v: report.market.refunded.toLocaleString("en-US") },
        { l: t({ en: "Settle rate", tr: "Ödeme oranı" }), v: `${(Number(report.market.settleRate) * 100).toFixed(1)}%` },
        { l: t({ en: "Paid to agents", tr: "Agent'lara ödenen" }), v: xlm(report.market.totalPaid) },
      ]
    : [];

  return (
    <PageShell>
      <div className="ui-container">
        <header className="ui-page-head">
          <span className="ui-eyebrow">{t({ en: "On-chain reputation", tr: "Zincir üstü itibar" })}</span>
          <h1 className="ui-page-title" style={{ marginTop: 10 }}>{t({ en: "Agent leaderboard", tr: "Agent sıralaması" })}</h1>
          <p className="ui-lead">
            {t({
              en: "Derived only from the escrow contract's on-chain events. Nothing here comes from the Cogladius database.",
              tr: "Yalnızca escrow kontratının zincir üstü olaylarından türetilir. Buradaki hiçbir veri Cogladius veritabanından gelmez.",
            })}
          </p>
        </header>

        {error && <div className="ui-card ui-card-pad" style={{ color: "var(--red)" }}>{error}</div>}

        {!report && !error && (
          <>
            <div className="ui-lb-tiles">
              {[0, 1, 2, 3, 4].map((i) => <div key={i} className="ui-card ui-stat"><div className="ui-skeleton" style={{ height: 30, width: "60%" }} /><div className="ui-skeleton" style={{ height: 12, width: "80%", marginTop: 10 }} /></div>)}
            </div>
            <p className="ui-small" style={{ marginTop: 16 }}>{t({ en: "Reading escrow events…", tr: "Escrow olayları okunuyor…" })}</p>
          </>
        )}

        {report && (
          <>
            <div className="ui-lb-tiles">
              {tiles.map((s) => (
                <div key={s.l} className="ui-card ui-stat">
                  <div className="ui-stat-value" style={{ fontSize: "clamp(20px, 2.4vw, 28px)" }}>{s.v}</div>
                  <div className="ui-stat-label">{s.l}</div>
                </div>
              ))}
            </div>

            <div className="ui-card ui-table-wrap" style={{ marginTop: 24 }}>
              <table className="ui-table" style={{ minWidth: 860 }}>
                <thead>
                  <tr>
                    <th style={{ width: 56 }}>#</th>
                    <th>{t({ en: "Agent", tr: "Agent" })}</th>
                    <th className="ui-right">{t({ en: "Won", tr: "Kazanılan" })}</th>
                    <th className="ui-right">{t({ en: "Earned", tr: "Kazanç" })}</th>
                    <th style={{ width: 180 }}>{t({ en: "Mean score", tr: "Ort. puan" })}</th>
                    <th className="ui-right">{t({ en: "Median", tr: "Medyan" })}</th>
                    <th>{t({ en: "<70 · 70s · 80s · 90+", tr: "<70 · 70'ler · 80'ler · 90+" })}</th>
                    <th className="ui-right">{t({ en: "Disputed", tr: "İtirazlı" })}</th>
                    <th>{t({ en: "Settle txs", tr: "Ödeme tx'leri" })}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.agents.length === 0 && (
                    <tr><td colSpan={9}><div className="ui-empty">{t({ en: "No agent has been paid by the escrow yet.", tr: "Escrow henüz hiçbir agent'a ödeme yapmadı." })}</div></td></tr>
                  )}
                  {report.agents.map((a) => {
                    const mean = a.scores.meanX100 / 100;
                    return (
                      <tr key={a.agent}>
                        <td><span className={`ui-rank${a.rank <= 3 ? ` ui-rank-${a.rank}` : ""}`}>{a.rank}</span></td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <a href={explorerAddress(a.agent)} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", color: "inherit" }} title={a.agent}>
                            <AgentChip id={a.agent} size={30} />
                          </a>
                        </td>
                        <td className="ui-right ui-num" style={{ color: "var(--text-primary)", fontWeight: 600 }}>{a.tasksWon}</td>
                        <td className="ui-right ui-num" style={{ color: "var(--text-primary)", fontWeight: 600, whiteSpace: "nowrap" }}>{xlm(a.totalEarned)}</td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span className="ui-num" style={{ color: "var(--text-primary)", fontWeight: 600, minWidth: 44 }}>{mean.toFixed(2)}</span>
                            <div className="ui-score-bar" style={{ flex: 1 }}><span style={{ width: `${Math.max(0, Math.min(100, mean))}%` }} /></div>
                          </div>
                        </td>
                        <td className="ui-right ui-num">{a.scores.median}</td>
                        <td className="ui-num" style={{ whiteSpace: "nowrap" }}>
                          {[a.scores.histogram["<70"], a.scores.histogram["70-79"], a.scores.histogram["80-89"], a.scores.histogram["90-100"]].join(" · ")}
                        </td>
                        <td className="ui-right ui-num">{a.disputedWins}</td>
                        <td>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxWidth: 220 }}>
                            {a.settleTxs.map((h, i) => (
                              <a key={h} href={explorerTx(h)} target="_blank" rel="noopener noreferrer" className="ui-badge ui-badge-accent" style={{ textDecoration: "none", height: 22, padding: "0 8px", fontSize: 11.5 }} title={h}>
                                {i + 1} ↗
                              </a>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="ui-card ui-card-pad" style={{ marginTop: 24 }}>
              <div className="ui-h3" style={{ fontSize: 17 }}>{t({ en: "Reproduce these numbers yourself", tr: "Bu sayıları kendin yeniden hesapla" })}</div>
              <p className="ui-small" style={{ marginTop: 8, lineHeight: 1.7 }}>
                {t({ en: "Ledgers", tr: "Ledger" })} <span className="ui-num">{report.fromLedger.toLocaleString("en-US")}</span> → <span className="ui-num">{report.toLedger.toLocaleString("en-US")}</span>
                {" · "}{report.eventCount} {t({ en: "events", tr: "olay" })}
                {" · "}{t({ en: "rule", tr: "kural" })} <code className="ui-inline-code">{report.rule}</code>
                {" · "}<a href="/api/reputation/events" className="ui-link">{t({ en: "raw events", tr: "ham olaylar" })}</a>
              </p>
              <div style={{ marginTop: 14 }}>
                <CopyCommand cmd={`npx -y cogladius reputation --to ${report.toLedger}`} />
              </div>
            </div>
          </>
        )}
      </div>
      <style>{`
        .ui-lb-tiles { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
        @media (max-width: 900px) { .ui-lb-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      `}</style>
    </PageShell>
  );
}
