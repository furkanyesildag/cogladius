"use client";

import { Verdict } from "@/lib/types";
import { useMessages } from "@/lib/i18n";

interface JudgePanelProps {
  verdicts: Verdict[];
  taskId: number;
  isEvaluating?: boolean;
}

const JUDGE_STYLES = [
  { color: "var(--green)", icon: "code" as const },
  { color: "var(--blue)", icon: "accessibility" as const },
  { color: "var(--accent)", icon: "rule" as const },
];

function ScoreRing({ score, color, size = 80 }: { score: number; color: string; size?: number }) {
  const R    = (size / 2) - 8;
  const circ = 2 * Math.PI * R;
  const fill = (score / 100) * circ;
  const cx = size / 2;
  const cy = size / 2;

  return (
    <div style={{ width: size, height: size, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
        style={{ position: "absolute", top: 0, left: 0, transform: "rotate(-90deg)" }}>
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="rgba(52,52,64,0.6)" strokeWidth="4" />
        <circle cx={cx} cy={cy} r={R} fill="none"
          stroke={color} strokeWidth="4"
          strokeDasharray={`${fill} ${circ}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 1.2s ease" }}
        />
      </svg>
      <span style={{ position: "relative", zIndex: 1, fontFamily: "var(--font)", fontSize: size > 70 ? 20 : 14, fontWeight: 800, color, lineHeight: 1 }}>
        {score}
      </span>
    </div>
  );
}

function SpinRing({ color, size = 80 }: { color: string; size?: number }) {
  const R  = (size / 2) - 8;
  const cx = size / 2;
  const cy = size / 2;
  return (
    <div style={{ width: size, height: size, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
        style={{ position: "absolute", top: 0, left: 0, animation: "spin 1.2s linear infinite" }}>
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="rgba(52,52,64,0.5)" strokeWidth="4" />
        <circle cx={cx} cy={cy} r={R} fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={`${0.35 * 2 * Math.PI * R} ${2 * Math.PI * R}`} strokeLinecap="round" />
      </svg>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default function JudgePanel({ verdicts, taskId, isEvaluating = false }: JudgePanelProps) {
  const u = useMessages().ui;
  const avgScore = verdicts.length > 0
    ? Math.round(verdicts.reduce((s, v) => s + v.score, 0) / verdicts.length)
    : null;
  const passes = avgScore !== null && avgScore >= 70;

  return (
    <div style={{ background: "var(--bg-surface-low)", border: "1px solid var(--bg-border)", borderRadius: 8, overflow: "hidden" }}>

      {/* Header */}
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--bg-border)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg-surface-high)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--accent)" }}>gavel</span>
          <span style={{ fontFamily: "var(--font)", fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.12em", textTransform: "uppercase" }}>
            {u.judgePanelTitle(taskId)}
          </span>
        </div>
        {isEvaluating && (
          <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--yellow)", letterSpacing: "0.08em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
            <span className="pulse-dot pulse-dot-amber" style={{ width: 5, height: 5 }} />
            {u.judgePanelEval}
          </span>
        )}
      </div>

      {/* Judge grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: "var(--bg-border)" }}>
        {[1, 2, 3].map((judgeId) => {
          const d = u.judgeCardDetail[judgeId - 1];
          const st = JUDGE_STYLES[judgeId - 1];
          const info = { name: d.name, focus: d.focus, color: st.color, icon: st.icon };
          const verdict = verdicts.find((v) => v.judgeId === judgeId);

          return (
            <div key={judgeId}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "20px 12px 16px", background: verdict ? `rgba(${judgeId === 1 ? "64,225,131" : judgeId === 2 ? "173,198,255" : "255,86,37"},0.04)` : "var(--bg-surface-low)" }}>

              <span className="material-symbols-outlined" style={{ fontSize: 16, color: info.color, opacity: 0.7 }}>{info.icon}</span>

              {verdict
                ? <ScoreRing score={verdict.score} color={info.color} size={80} />
                : isEvaluating
                  ? <SpinRing color={info.color} size={80} />
                  : <div style={{ width: 80, height: 80, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font)", fontSize: 24, color: "var(--text-ghost)" }}>—</div>
              }

              <div style={{ textAlign: "center" }}>
                <div style={{ fontFamily: "var(--font)", fontSize: 10, color: info.color, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 3, fontWeight: 700 }}>
                  {info.name}
                </div>
                <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-ghost)" }}>{info.focus}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Average score */}
      {avgScore !== null && (
        <div style={{ margin: "12px 14px", padding: "12px 16px", background: passes ? "var(--green-dim)" : "var(--yellow-dim)", border: `1px solid ${passes ? "rgba(64,225,131,0.25)" : "rgba(232,160,32,0.25)"}`, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>{u.judgePanel.averageScore}</div>
            <div style={{ fontFamily: "var(--font)", fontSize: 28, fontWeight: 800, color: passes ? "var(--green)" : "var(--yellow)", lineHeight: 1 }}>
              {avgScore}<span style={{ fontSize: 14, fontWeight: 400, opacity: 0.6 }}>/100</span>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "var(--font)", fontSize: 13, color: passes ? "var(--green)" : "var(--yellow)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {passes ? u.judgePanel.passed : u.judgePanel.failed}
            </div>
            <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", marginTop: 4 }}>
              {passes ? u.judgePanel.eligibleApproval : u.judgePanel.threshold}
            </div>
          </div>
        </div>
      )}

      {/* Reasoning */}
      {verdicts.length > 0 && (
        <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
          {verdicts.map((v) => {
            const d = u.judgeCardDetail[v.judgeId - 1];
            const st = JUDGE_STYLES[v.judgeId - 1];
            const info = d && st ? { name: d.name, color: st.color, icon: st.icon } : null;
            return (
              <details key={v.judgeId} style={{ fontFamily: "var(--font)", fontSize: 11 }}>
                <summary style={{ cursor: "pointer", color: info?.color, outline: "none", userSelect: "none", padding: "4px 0", display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 12 }}>{info?.icon}</span>
                  {info?.name}: {v.reasoning.substring(0, 52)}...
                </summary>
                <p style={{ marginTop: 6, padding: "8px 12px", color: "var(--text-muted)", lineHeight: 1.7, borderLeft: `2px solid ${info?.color}`, background: "var(--bg-base)", borderRadius: "0 4px 4px 0" }}>
                  {v.reasoning}
                </p>
              </details>
            );
          })}
        </div>
      )}

      {verdicts.length === 0 && !isEvaluating && (
        <div style={{ padding: "20px 14px", textAlign: "center", fontFamily: "var(--font)", fontSize: 11, color: "var(--text-ghost)" }}>
          {u.judgePanel.waitingSubmissions}
        </div>
      )}
    </div>
  );
}
