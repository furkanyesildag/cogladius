"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Task } from "@/lib/types";
import { useLocale } from "@/lib/i18n";

/**
 * Agent Court: an off-chain LLM roleplay (poster's counsel, agent's counsel,
 * magistrate) produced by /api/court. It has no stake, moves no funds and
 * writes nothing on-chain; its "ruling" is a simulated opinion only. The UI
 * says so up front and on the verdict.
 */

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

const T = {
  en: {
    kicker: "Agent Court",
    title: (id: number) => `Simulated trial · task #${id}`,
    sim: "AI-generated simulation",
    simLong: "An LLM plays both counsels and a magistrate. There is no stake, nothing is refunded or paid, and nothing is written on-chain. Use it to stress-test a disagreement, not to settle one.",
    close: "Close",
    task: "Task",
    fieldAgent: "Agent output (reference)",
    phAgent: "Paste the agent's result or the relevant part…",
    fieldDispute: "What is wrong with it? *",
    phDispute: "Which criteria were missed, or why the work is insufficient…",
    start: "Run simulated trial",
    loading: "Generating the transcript…",
    error: "Could not start the simulation. Check your connection and try again.",
    errorValidation: "Add a few words describing the disagreement.",
    retry: "Try again",
    transcript: "Transcript",
    speakers: { poster_lawyer: "Poster's counsel", openclaw_lawyer: "Agent's counsel", judge: "Magistrate" },
    verdict: "Simulated ruling",
    rulingPoster: "Leans towards the poster",
    rulingAgent: "Leans towards the agent",
    suggested: "Suggested remedy (not executed)",
    notExecuted: "This opinion has no effect. Payment still follows the escrow rules: the poster releases a passing submission, or anyone can request release after the deadline.",
    again: "Run again",
  },
  tr: {
    kicker: "Ajan Mahkemesi",
    title: (id: number) => `Simüle duruşma · görev #${id}`,
    sim: "Yapay zekâ simülasyonu",
    simLong: "Bir LLM iki avukatı ve hâkimi canlandırır. Teminat yoktur, iade ya da ödeme yapılmaz ve zincire hiçbir şey yazılmaz. Bir anlaşmazlığı çözmek için değil, sınamak için kullan.",
    close: "Kapat",
    task: "Görev",
    fieldAgent: "Ajan çıktısı (referans)",
    phAgent: "Ajanın sonucunu ya da ilgili kısmı yapıştır…",
    fieldDispute: "Sorun ne? *",
    phDispute: "Hangi kriterler karşılanmadı ya da iş neden yetersiz…",
    start: "Simüle duruşmayı başlat",
    loading: "Tutanak üretiliyor…",
    error: "Simülasyon başlatılamadı. Bağlantını kontrol edip tekrar dene.",
    errorValidation: "Anlaşmazlığı birkaç kelimeyle anlat.",
    retry: "Tekrar dene",
    transcript: "Tutanak",
    speakers: { poster_lawyer: "Görev sahibinin avukatı", openclaw_lawyer: "Ajanın avukatı", judge: "Hâkim" },
    verdict: "Simüle karar",
    rulingPoster: "Görev sahibine yakın",
    rulingAgent: "Ajana yakın",
    suggested: "Önerilen çözüm (uygulanmaz)",
    notExecuted: "Bu görüşün hiçbir etkisi yoktur. Ödeme yine escrow kurallarına uyar: görev sahibi geçen bir teslimi öder ya da son tarihten sonra herkes ödemeyi talep edebilir.",
    again: "Yeniden çalıştır",
  },
};

export default function CourtRoom({ task, onClose, onVerdict, prefillAgentResult, prefillDisputeReason }: CourtRoomProps) {
  const { locale } = useLocale();
  const t = T[locale === "tr" ? "tr" : "en"];
  const [phase, setPhase] = useState<"idle" | "loading" | "error" | "running" | "verdict">("idle");
  const [trial, setTrial] = useState<TrialData | null>(null);
  const [shown, setShown] = useState<Statement[]>([]);
  const [disputeReason, setDisputeReason] = useState(prefillDisputeReason ?? "");
  const [agentResult, setAgentResult] = useState(prefillAgentResult ?? "");
  const [formError, setFormError] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reported = useRef(false);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => () => clearTimers(), []);

  useEffect(() => {
    if (prefillAgentResult && !agentResult) setAgentResult(prefillAgentResult);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillAgentResult]);

  const play = useCallback((data: TrialData) => {
    clearTimers();
    let i = 0;
    const next = () => {
      if (i >= data.statements.length) {
        timers.current.push(setTimeout(() => {
          setPhase("verdict");
          if (onVerdict && !reported.current) { reported.current = true; onVerdict(data.verdict.ruling); }
        }, 500));
        return;
      }
      const s = data.statements[i++];
      setShown((p) => [...p, s]);
      // Pacing for readability only.
      timers.current.push(setTimeout(next, Math.min(2600, 500 + s.text.length * 8)));
    };
    timers.current.push(setTimeout(next, 300));
  }, [onVerdict]);

  async function start() {
    if (!disputeReason.trim()) { setFormError(t.errorValidation); return; }
    setFormError(null);
    setShown([]);
    setPhase("loading");
    try {
      const res = await fetch("/api/court", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskDescription: task.description, criteria: task.criteria, agentResult, disputeReason }),
      });
      if (!res.ok) throw new Error("bad response");
      const data: TrialData = await res.json();
      if (!data?.statements?.length || !data?.verdict) throw new Error("invalid");
      setTrial(data);
      reported.current = false;
      setPhase("running");
      play(data);
    } catch {
      setPhase("error");
    }
  }

  const color = (s: Statement["speaker"]) => (s === "judge" ? "#FFD166" : s === "poster_lawyer" ? "var(--accent)" : "#7C9EFF");

  return (
    <section className="db-court">
      <div className="db-court-head">
        <div>
          <span className="db-court-kicker">{t.kicker}</span>
          <h3>{t.title(task.id)}</h3>
        </div>
        <span className="db-sim-badge">{t.sim}</span>
        <button type="button" className="db-icon-btn" aria-label={t.close} title={t.close} onClick={onClose}>✕</button>
      </div>
      <p className="db-court-note">{t.simLong}</p>

      {(phase === "idle" || phase === "error") && (
        <div className="db-court-form">
          {phase === "error" && <div className="db-alert db-alert-red" role="alert">{t.error}</div>}
          {formError && <div className="db-alert db-alert-red" role="alert">{formError}</div>}
          <label className="ui-label" htmlFor="court-agent-out">{t.fieldAgent}</label>
          <textarea id="court-agent-out" className="ui-input" rows={3} value={agentResult} onChange={(e) => setAgentResult(e.target.value)} placeholder={t.phAgent} />
          <label className="ui-label" htmlFor="court-dispute">{t.fieldDispute}</label>
          <textarea id="court-dispute" className="ui-input" rows={3} value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} placeholder={t.phDispute} />
          <div>
            <button type="button" className="btn-ghost" onClick={() => void start()}>{phase === "error" ? t.retry : t.start}</button>
          </div>
        </div>
      )}

      {phase === "loading" && (
        <div className="db-court-loading" aria-live="polite"><span className="db-spinner" />{t.loading}</div>
      )}

      {(phase === "running" || phase === "verdict") && (
        <div className="db-court-transcript">
          <div className="ui-label" style={{ marginBottom: 10 }}>{t.transcript}</div>
          {shown.map((s, i) => (
            <div key={i} className={`db-bubble db-bubble-${s.speaker}`}>
              <div className="db-bubble-who" style={{ color: color(s.speaker) }}>{t.speakers[s.speaker]}</div>
              <div className="db-bubble-text">{s.text}</div>
            </div>
          ))}
          {phase === "verdict" && trial && (
            <div className="db-verdict">
              <div className="db-verdict-top">
                <span className="ui-label">{t.verdict}</span>
                <span className="db-sim-badge">{t.sim}</span>
              </div>
              <div className="db-verdict-ruling">{trial.verdict.ruling === "poster_wins" ? t.rulingPoster : t.rulingAgent}</div>
              <p>{trial.verdict.reasoning}</p>
              {trial.verdict.action && (
                <p className="db-verdict-action"><span className="ui-label">{t.suggested}</span><br />{trial.verdict.action}</p>
              )}
              <p className="db-verdict-foot">{t.notExecuted}</p>
              <button type="button" className="btn-ghost" onClick={() => { clearTimers(); setPhase("idle"); setShown([]); setTrial(null); }}>{t.again}</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
