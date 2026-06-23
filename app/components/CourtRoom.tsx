"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Task } from "@/lib/types";
import { useMessages } from "@/lib/i18n";

const S = {
  bg: "var(--bg-base)",
  surface: "var(--bg-surface)",
  border: "var(--bg-border)",
  borderB: "var(--bg-border-bright)",
  accent: "var(--accent)",
  accentD: "var(--accent-dim)",
  green: "var(--green)",
  greenD: "var(--green-dim)",
  yellow: "var(--yellow)",
  red: "var(--red)",
  blue: "var(--blue)",
  blueD: "var(--blue-dim)",
  tp: "var(--text-primary)",
  ts: "var(--text-secondary)",
  tm: "var(--text-muted)",
};

interface Statement {
  speaker: "poster_lawyer" | "openclaw_lawyer" | "judge";
  text: string;
}

interface TrialData {
  statements: Statement[];
  verdict: {
    ruling: "poster_wins" | "openclaw_wins";
    reasoning: string;
    action: string;
  };
}

interface CourtRoomProps {
  task: Task;
  onClose: () => void;
  onVerdict?: (ruling: "poster_wins" | "openclaw_wins") => void;
  prefillAgentResult?: string;
  prefillDisputeReason?: string;
}

export default function CourtRoom({ task, onClose, onVerdict, prefillAgentResult, prefillDisputeReason }: CourtRoomProps) {
  const c = useMessages().ui.court;
  const [phase, setPhase] = useState<"idle" | "loading" | "error" | "running" | "verdict">("idle");
  const [trial, setTrial] = useState<TrialData | null>(null);
  const [shownStatements, setShownStatements] = useState<Statement[]>([]);
  const [progress, setProgress] = useState({ poster: 0, openclaw: 0, judge: 0 });
  const [disputeReason, setDisputeReason] = useState(prefillDisputeReason ?? "");
  const [agentResult, setAgentResult] = useState(prefillAgentResult ?? "");
  const [formError, setFormError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const verdictReported = useRef(false);
  const autoStartKey = useRef<string | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  useEffect(() => () => clearTimers(), []);

  useEffect(() => {
    if (prefillAgentResult && prefillAgentResult !== agentResult) {
      setAgentResult(prefillAgentResult);
    }
  }, [prefillAgentResult, agentResult]);

  const runStatements = useCallback(
    (data: TrialData) => {
      clearTimers();
      const stmts = data.statements;
      let idx = 0;

      const showNext = () => {
        if (idx >= stmts.length) {
          const t = setTimeout(() => {
            setPhase("verdict");
            if (onVerdict && !verdictReported.current) {
              verdictReported.current = true;
              onVerdict(data.verdict.ruling);
            }
          }, 800);
          timersRef.current.push(t);
          return;
        }

        const stmt = stmts[idx];
        setShownStatements((prev) => [...prev, stmt]);

        setProgress((prev) => {
          const next = { ...prev };
          if (stmt.speaker === "poster_lawyer") next.poster = Math.min(100, next.poster + 40);
          if (stmt.speaker === "openclaw_lawyer") next.openclaw = Math.min(100, next.openclaw + 40);
          if (stmt.speaker === "judge") next.judge = Math.min(100, next.judge + 60);
          return next;
        });

        idx++;
        const delay = 600 + stmt.text.length * 18;
        const t = setTimeout(showNext, delay);
        timersRef.current.push(t);
      };

      const t0 = setTimeout(showNext, 400);
      timersRef.current.push(t0);
    },
    [onVerdict]
  );

  const startTrial = useCallback(
    async (fromAuto = false) => {
      const dReason = fromAuto && prefillDisputeReason ? prefillDisputeReason : disputeReason;
      const aResult = fromAuto && prefillAgentResult != null ? prefillAgentResult : agentResult;
      if (!fromAuto && !dReason.trim()) {
        setFormError(c.errorValidation);
        return;
      }
      if (fromAuto && !dReason.trim()) {
        setPhase("error");
        setLoadError(c.errorGeneric);
        return;
      }
      setFormError(null);
      setLoadError(null);
      setShownStatements([]);
      setProgress({ poster: 0, openclaw: 0, judge: 0 });
      setPhase("loading");
      try {
        const res = await fetch("/api/court", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskDescription: task.description,
            criteria: task.criteria,
            agentResult: aResult,
            disputeReason: dReason,
          }),
        });
        if (!res.ok) throw new Error("bad response");
        const data: TrialData = await res.json();
        if (!data?.statements?.length || !data?.verdict) throw new Error("invalid");
        setTrial(data);
        setPhase("running");
        verdictReported.current = false;
        runStatements(data);
      } catch {
        setPhase("error");
        setLoadError(c.errorGeneric);
      }
    },
    [
      c.errorGeneric,
      c.errorValidation,
      agentResult,
      disputeReason,
      prefillAgentResult,
      prefillDisputeReason,
      task.criteria,
      task.description,
      runStatements,
    ]
  );

  useEffect(() => {
    if (!prefillDisputeReason?.trim() || !prefillAgentResult?.trim()) return;
    const k = `court-auto-${task.id}`;
    if (autoStartKey.current === k) return;
    autoStartKey.current = k;
    void startTrial(true);
  }, [prefillDisputeReason, prefillAgentResult, task.id, startTrial]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [shownStatements, phase]);

  const stackPct = (p: number) => (p === 0 ? 0.28 : 1);
  const ProgressBar = ({ pct, color }: { pct: number; color: string }) => (
    <div className="kl-court-progress-track">
      <div
        className="kl-court-progress-fill"
        style={{
          width: `${pct}%`,
          background: color,
          opacity: stackPct(pct),
        }}
      />
    </div>
  );

  const stake = ((task.rewardUsdc ?? 0) * 0.2).toFixed(4);
  const shortDesc = task.description.length > 120 ? `${task.description.slice(0, 120)}…` : task.description;
  const speakerLabel = (s: Statement["speaker"]) => c.speaker[s];

  return (
    <div className="kl-court">
      <header className="kl-court__header">
        <div className="kl-court__header-left">
          <div className="kl-court__header-icon" aria-hidden>
            <span className="material-symbols-outlined">gavel</span>
          </div>
          <div>
            <div className="kl-court__header-kicker">{c.headerKicker}</div>
            <h2 className="kl-court__header-title">{c.headerTitle(task.id)}</h2>
          </div>
        </div>
        <div className="kl-court__header-badges">
          <span className="kl-court__pill">
            <span className="material-symbols-outlined" style={{ fontSize: 12, opacity: 0.7 }}>fiber_manual_record</span>
            {c.liveSession}
          </span>
          <button type="button" className="kl-icon-btn-ghost" title={c.close} aria-label={c.close} onClick={onClose}>
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>close</span>
          </button>
        </div>
      </header>

      <div className="kl-court__taskline">
        <span className="kl-court__taskline-label">{c.taskLabel}</span>
        <p className="kl-court__taskline-text">{shortDesc}</p>
      </div>

      <div className="kl-court__bench">
        {[
          { key: "poster" as const, label: c.partPoster, color: S.accent, pct: progress.poster },
          { key: "judge" as const, label: c.partJudge, color: S.yellow, pct: progress.judge },
          { key: "openclaw" as const, label: c.partOpenclaw, color: S.blue, pct: progress.openclaw },
        ].map(({ key, label, color, pct }) => {
          const status =
            pct === 0 ? c.progress.idle : pct === 100 ? c.progress.done : c.progress.active;
          return (
            <div key={key} className="kl-court__participant">
              <div className="kl-court__participant-head">
                <span className="kl-court__participant-dot" style={{ background: color, boxShadow: `0 0 10px ${color}55` }} />
                <span className="kl-court__participant-name" style={{ color: S.ts }}>
                  {label}
                </span>
              </div>
              <ProgressBar pct={pct} color={color} />
              <div className="kl-court__participant-stat" style={{ color: pct > 0 ? color : S.tm }}>
                {status}
              </div>
            </div>
          );
        })}
      </div>

      {phase === "idle" && (
        <div className="kl-court__form">
          {formError && <div className="kl-court__alert" role="alert">{formError}</div>}
          <div className="kl-court__preface">
            <div className="kl-court__preface-title">{c.prefaceTitle}</div>
            <p className="kl-court__preface-text">{c.preface}</p>
          </div>

          <label className="kl-court__label" htmlFor="court-agent-out">{c.fieldAgent}</label>
          <textarea
            id="court-agent-out"
            className="kl-court__textarea"
            value={agentResult}
            onChange={(e) => setAgentResult(e.target.value)}
            placeholder={c.phAgent}
            rows={3}
            spellCheck
          />

          <label className="kl-court__label" htmlFor="court-dispute">{c.fieldDispute}</label>
          <textarea
            id="court-dispute"
            className="kl-court__textarea"
            value={disputeReason}
            onChange={(e) => setDisputeReason(e.target.value)}
            placeholder={c.phDispute}
            rows={3}
            spellCheck
            required
          />

          <div className="kl-court__stake">
            <div className="kl-court__stake-row">
              <span>{c.stakeLine(stake)}</span>
            </div>
            <div className="kl-court__stake-row kl-court__stake-row--pos">
              <span>{c.stakeWin}</span>
              <span className="kl-court__stake-em">{c.stakeWinDetail}</span>
            </div>
          </div>

          <button type="button" className="kl-court__cta" onClick={() => void startTrial(false)}>
            <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 6 }}>chat</span>
            {c.startTrial}
          </button>
        </div>
      )}

      {phase === "loading" && (
        <div className="kl-court__loading" aria-live="polite" aria-busy>
          <div className="kl-court__spinner" />
          <div className="kl-court__loading-title">{c.loadingTitle}</div>
          <div className="kl-court__loading-sub">{c.loadingSub}</div>
        </div>
      )}

      {phase === "error" && (
        <div className="kl-court__error" role="alert">
          <span className="material-symbols-outlined kl-court__error-icon">error_outline</span>
          <p>{loadError || c.errorGeneric}</p>
          <button
            type="button"
            className="kl-court__retry"
            onClick={() => {
              setPhase("idle");
              setLoadError(null);
            }}
          >
            {c.retry}
          </button>
        </div>
      )}

      {(phase === "running" || phase === "verdict") && (
        <div className="kl-court__transcriptwrap">
          <div className="kl-court__transcript-hdr">
            <span className="material-symbols-outlined" style={{ fontSize: 14, color: S.tm }}>description</span>
            {c.transcript}
          </div>
          <div className="kl-court__transcript">
            {shownStatements.map((s, i) => {
              const isJudge = s.speaker === "judge";
              const isPoster = s.speaker === "poster_lawyer";
              return (
                <div
                  key={i}
                  className={
                    isJudge
                      ? "kl-court__bubble-wrap kl-court__bubble-wrap--judge"
                      : isPoster
                        ? "kl-court__bubble-wrap kl-court__bubble-wrap--left"
                        : "kl-court__bubble-wrap kl-court__bubble-wrap--right"
                  }
                >
                  <div className="kl-court__bubble-meta" style={{ color: isJudge ? S.yellow : isPoster ? S.accent : S.blue }}>
                    {speakerLabel(s.speaker)}
                  </div>
                  <div
                    className={
                      isJudge
                        ? "kl-court__bubble kl-court__bubble--judge"
                        : isPoster
                          ? "kl-court__bubble kl-court__bubble--poster"
                          : "kl-court__bubble kl-court__bubble--defense"
                    }
                  >
                    {s.text}
                  </div>
                </div>
              );
            })}

            {phase === "verdict" && trial && (
              <div className="kl-court__verdict">
                <div className="kl-court__verdict-stamp" aria-hidden>
                  <span className="material-symbols-outlined">contract</span>
                </div>
                <div className="kl-court__verdict-hdr">{c.verdict}</div>
                <div
                  className={
                    trial.verdict.ruling === "poster_wins"
                      ? "kl-court__verdict-ruling kl-court__verdict-ruling--poster"
                      : "kl-court__verdict-ruling kl-court__verdict-ruling--openclaw"
                  }
                >
                  {trial.verdict.ruling === "poster_wins" ? c.rulingPoster : c.rulingOpenclaw}
                </div>
                <p className="kl-court__verdict-reason">{trial.verdict.reasoning}</p>
                <p className="kl-court__verdict-action">{trial.verdict.action}</p>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>
      )}
    </div>
  );
}
