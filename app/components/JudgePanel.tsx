"use client";

import { Verdict } from "@/lib/types";
import { useLocale } from "@/lib/i18n";
import { shortenAddress } from "@/lib/constants";

/**
 * Real judge verdicts for one task, grouped by the agent they score.
 *
 * Three judges (one LLM, three prompts) score each submission off-chain; only
 * the average, signed by the platform verdict key, is checked on-chain at
 * release (it must be >= 70). Nothing here is simulated: with no verdicts the
 * panel says so.
 *
 * Styled inline on purpose: it is used by the dashboard and the task page,
 * which load different page stylesheets.
 */

interface JudgePanelProps {
  verdicts: Verdict[];
  taskId: number;
  isEvaluating?: boolean;
  /** Registry names keyed by agent pubkey, when known. */
  agentNames?: Record<string, string>;
}

const T = {
  en: {
    title: (id: number) => `Judge verdicts · task #${id}`,
    scoring: "Scoring…",
    judges: [
      { name: "Technical", focus: "Accuracy & depth" },
      { name: "Usability", focus: "Clarity & usefulness" },
      { name: "Scope", focus: "Scope & completeness" },
    ],
    avg: "Average",
    pass: "Passes (≥ 70)",
    fail: "Below 70",
    none: "No verdicts yet. Judges score each submission after an agent submits.",
    waiting: "Waiting for judge scores…",
    note: "Scored off-chain by three AI judges; only the signed average is checked on-chain at release.",
    reasoning: "Reasoning",
  },
  tr: {
    title: (id: number) => `Hakem kararları · görev #${id}`,
    scoring: "Puanlanıyor…",
    judges: [
      { name: "Teknik", focus: "Doğruluk ve derinlik" },
      { name: "Kullanılabilirlik", focus: "Açıklık ve fayda" },
      { name: "Kapsam", focus: "Kapsam ve bütünlük" },
    ],
    avg: "Ortalama",
    pass: "Geçti (≥ 70)",
    fail: "70'in altında",
    none: "Henüz karar yok. Hakemler, bir ajan teslim ettikten sonra her teslimi puanlar.",
    waiting: "Hakem puanları bekleniyor…",
    note: "Üç yapay zekâ hakemi zincir dışında puanlar; ödeme anında zincirde yalnızca imzalı ortalama doğrulanır.",
    reasoning: "Gerekçe",
  },
};

const COLORS = ["#40e183", "#7C9EFF", "#B97DFF"];

function Ring({ score, color }: { score: number | null; color: string }) {
  const size = 58;
  const r = size / 2 - 5;
  const circ = 2 * Math.PI * r;
  const fill = score === null ? 0 : (Math.max(0, Math.min(100, score)) / 100) * circ;
  return (
    <div style={{ width: size, height: size, position: "relative", flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)", display: "block" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-border-bright)" strokeWidth="4" />
        {score !== null && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
            strokeDasharray={`${fill} ${circ}`} style={{ transition: "stroke-dasharray 1s cubic-bezier(.2,.8,.2,1)" }} />
        )}
      </svg>
      <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-head)", fontSize: 17, fontWeight: 700, color: score === null ? "var(--text-muted)" : "var(--text-primary)" }}>
        {score === null ? "—" : score}
      </span>
    </div>
  );
}

export default function JudgePanel({ verdicts, taskId, isEvaluating = false, agentNames }: JudgePanelProps) {
  const { locale } = useLocale();
  const t = T[locale === "tr" ? "tr" : "en"];

  // One group per evaluated agent, best average first.
  const groups = Array.from(
    verdicts.reduce((m, v) => m.set(v.agent, [...(m.get(v.agent) || []), v]), new Map<string, Verdict[]>())
  )
    .map(([agent, vs]) => ({ agent, vs, avg: Math.round(vs.reduce((s, v) => s + v.score, 0) / vs.length) }))
    .sort((a, b) => b.avg - a.avg);

  return (
    <div style={{ borderRadius: 18, border: "1px solid var(--bg-border-bright)", background: "var(--bg-surface)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--bg-border-bright)", background: "var(--bg-surface-low)" }}>
        <span style={{ fontFamily: "var(--font-head)", fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>{t.title(taskId)}</span>
        {isEvaluating && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font)", fontSize: 11, color: "var(--yellow)" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--yellow)" }} />
            {t.scoring}
          </span>
        )}
      </div>

      {groups.length === 0 && (
        <div style={{ padding: "26px 18px", textAlign: "center", fontFamily: "var(--font-body)", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
          {isEvaluating ? t.waiting : t.none}
        </div>
      )}

      {groups.map((g, gi) => {
        const passes = g.avg >= 70;
        const name = agentNames?.[g.agent];
        return (
          <div key={g.agent} style={{ padding: "16px 18px", borderTop: gi > 0 ? "1px solid var(--bg-border-bright)" : "none" }}>
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
              <span style={{ fontFamily: "var(--font-head)", fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{name || shortenAddress(g.agent, 5)}</span>
              {name && <span style={{ fontFamily: "var(--font)", fontSize: 11, color: "var(--text-muted)" }}>{shortenAddress(g.agent, 5)}</span>}
              <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontFamily: "var(--font)", fontSize: 11, color: "var(--text-muted)" }}>{t.avg}</span>
                <span style={{ fontFamily: "var(--font-head)", fontSize: 22, fontWeight: 700, color: passes ? "var(--green)" : "var(--yellow)", letterSpacing: "-0.03em" }}>{g.avg}</span>
                <span style={{ fontFamily: "var(--font)", fontSize: 11, padding: "3px 9px", borderRadius: 999, color: passes ? "var(--green)" : "var(--yellow)", background: passes ? "var(--green-dim)" : "var(--yellow-dim)", border: `1px solid ${passes ? "rgba(64,225,131,.3)" : "rgba(232,160,32,.3)"}` }}>
                  {passes ? t.pass : t.fail}
                </span>
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              {[1, 2, 3].map((id) => {
                const v = g.vs.find((x) => x.judgeId === id);
                const j = t.judges[id - 1];
                return (
                  <div key={id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 14, background: "var(--bg-surface-low)", border: "1px solid var(--bg-border)" }}>
                    <Ring score={v ? v.score : null} color={COLORS[id - 1]} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: "var(--font-head)", fontSize: 13, fontWeight: 600, color: COLORS[id - 1] }}>{j.name}</div>
                      <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-muted)" }}>{j.focus}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            {g.vs.some((v) => v.reasoning) && (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
                {[...g.vs].sort((a, b) => a.judgeId - b.judgeId).filter((v) => v.reasoning).map((v) => (
                  <details key={v.judgeId} style={{ fontFamily: "var(--font-body)", fontSize: 13 }}>
                    <summary style={{ cursor: "pointer", color: "var(--text-primary)", padding: "4px 0" }}>
                      <span style={{ color: COLORS[v.judgeId - 1] || "var(--accent)", fontWeight: 600 }}>{t.judges[v.judgeId - 1]?.name ?? v.judgeName}</span>
                      <span style={{ color: "var(--text-muted)" }}> · {t.reasoning}</span>
                    </summary>
                    <p style={{ margin: "6px 0 4px", padding: "10px 14px", color: "var(--text-muted)", lineHeight: 1.7, borderLeft: `2px solid ${COLORS[v.judgeId - 1] || "var(--accent)"}`, background: "var(--bg-surface-low)", borderRadius: "0 10px 10px 0", whiteSpace: "pre-wrap" }}>
                      {v.reasoning}
                    </p>
                  </details>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {groups.length > 0 && (
        <div style={{ padding: "10px 18px 14px", fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>{t.note}</div>
      )}
    </div>
  );
}
