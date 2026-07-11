"use client";

import { useState, useEffect, useRef } from "react";
import { Task, OutputFormat } from "@/lib/types";
import { useMessages, useLocale } from "@/lib/i18n";

const S = {
  bg:      "var(--bg-base)",
  surface: "var(--bg-surface)",
  elevated:"var(--bg-elevated)",
  border:  "var(--bg-border)",
  borderB: "var(--bg-border-bright)",
  accent:  "var(--accent)",
  accentD: "var(--accent-dim)",
  green:   "var(--green)",
  greenD:  "var(--green-dim)",
  yellow:  "var(--yellow)",
  yellowD: "var(--yellow-dim)",
  red:     "var(--red)",
  redD:    "var(--red-dim)",
  tp:      "var(--text-primary)",
  ts:      "var(--text-secondary)",
  tm:      "var(--text-muted)",
};

export interface JudgeScore { name: string; score: number; comment: string; }

export interface ChatMessage {
  role: "user" | "agent" | "system" | "submission" | "judge";
  content: string;
  ts: string;
  judgeScore?: JudgeScore;
  speaker?: string;
}

export interface AgentPanelSavedState {
  messages: ChatMessage[];
  phase: "racing" | "generating" | "judging" | "submitted" | "approved" | "rejected";
  agentResult: string;
  judgeScores: JudgeScore[];
  progressA: number;
  progressB: number;
  winner: "A" | "B" | null;
}

export interface AgentWorkPanelProps {
  task: Task;
  agentA: { name: string; pubkey: string };
  agentB: { name: string; pubkey: string };
  onClose: () => void;
  onApprove: (agentResult: string, txHash: string) => void;
  onReject: (agentResult: string, reason: string) => void;
  onJudgesComplete?: () => void;
  savedState?: AgentPanelSavedState | null;
  onSaveState?: (state: AgentPanelSavedState) => void;
}

/* ── Result renderer ────────────────────────────────────────────────
   Parses agent output into code blocks, JSON, URLs and rich text.
─────────────────────────────────────────────────────────────────── */
function CopyButton({ text }: { text: string }) {
  const aw = useMessages().ui.agentWork;
  const [didCopy, setDidCopy] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); } catch (_) {}
        setDidCopy(true);
        setTimeout(() => setDidCopy(false), 1500);
      }}
      style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font)", fontSize: 9, color: didCopy ? "var(--green)" : "rgba(var(--text-rgb),0.35)", letterSpacing: "0.06em", padding: "2px 6px", transition: "color 0.15s" }}
    >
      {didCopy ? aw.copied : aw.copy}
    </button>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(0,0,0,0.4)", borderRadius: "4px 4px 0 0", padding: "5px 12px", borderBottom: "1px solid rgba(var(--white-rgb),0.06)" }}>
        <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "rgba(var(--text-rgb),0.4)", letterSpacing: "0.08em" }}>
          {lang || "code"}
        </span>
        <CopyButton text={code} />
      </div>
      <pre style={{ margin: 0, background: "rgba(0,0,0,0.35)", borderRadius: "0 0 4px 4px", padding: "12px 14px", overflowX: "auto", fontFamily: "var(--font)", fontSize: 11, color: "#E8F0FE", lineHeight: 1.65, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {code.trim()}
      </pre>
    </div>
  );
}

function JsonBlock({ raw }: { raw: string }) {
  let pretty = raw.trim();
  try { pretty = JSON.stringify(JSON.parse(raw), null, 2); } catch (_) {}
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(255,209,102,0.06)", borderRadius: "4px 4px 0 0", padding: "5px 12px", borderBottom: "1px solid rgba(255,209,102,0.15)" }}>
        <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "rgba(255,209,102,0.6)", letterSpacing: "0.08em" }}>json</span>
        <CopyButton text={pretty} />
      </div>
      <pre style={{ margin: 0, background: "rgba(255,209,102,0.04)", borderRadius: "0 0 4px 4px", padding: "12px 14px", overflowX: "auto", fontFamily: "var(--font)", fontSize: 11, color: "#FFD166", lineHeight: 1.65, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {pretty}
      </pre>
    </div>
  );
}

const URL_RE = /https?:\/\/[^\s)>\]"']+/g;

function RichLine({ text }: { text: string }) {
  // Detect bold **...**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  const nodes = parts.map((p, i) => {
    if (p.startsWith("**")) {
      return <strong key={i} style={{ color: "var(--text-primary)", fontWeight: 700 }}>{p.replace(/\*\*/g, "")}</strong>;
    }
    // Replace URLs with link tags
    const urlRe = /https?:\/\/[^\s)>\]"']+/g;
    const result: React.ReactNode[] = [];
    let last = 0;
    let um: RegExpExecArray | null;
    while ((um = urlRe.exec(p)) !== null) {
      if (um.index > last) result.push(p.slice(last, um.index));
      result.push(<a key={`${i}-${um.index}`} href={um[0]} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", textDecoration: "underline", textUnderlineOffset: 3, wordBreak: "break-all" }}>{um[0]}</a>);
      last = um.index + um[0].length;
    }
    if (last < p.length) result.push(p.slice(last));
    return result.length ? result : p;
  });
  return <>{nodes}</>;
}

function ResultRenderer({
  content,
  outputFormat,
  formatMeta,
}: {
  content: string;
  outputFormat?: OutputFormat;
  formatMeta: Record<string, { label: string; icon: string; color: string }>;
}) {
  // Split by code fences: ```lang\n...```
  const segments: { type: "text" | "code" | "json"; value: string; lang?: string }[] = [];
  const fenceRe = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = fenceRe.exec(content)) !== null) {
    if (m.index > last) segments.push({ type: "text", value: content.slice(last, m.index) });
    const lang = (m[1] || "").toLowerCase();
    const code = m[2];
    // Detect if the code fence is JSON
    if (lang === "json" || (!lang && (() => { try { JSON.parse(code); return true; } catch { return false; } })())) {
      segments.push({ type: "json", value: code });
    } else {
      segments.push({ type: "code", lang, value: code });
    }
    last = m.index + m[0].length;
  }
  if (last < content.length) segments.push({ type: "text", value: content.slice(last) });

  // If no code fences found and outputFormat is code, treat whole thing as code
  if (segments.length === 1 && segments[0].type === "text" && outputFormat === "code") {
    return <CodeBlock lang="code" code={content} />;
  }
  // If no code fences and outputFormat is json, try to parse the whole content as JSON
  if (segments.length === 1 && segments[0].type === "text" && outputFormat === "json") {
    try { JSON.parse(content); return <JsonBlock raw={content} />; } catch (_) {}
  }

  return (
    <>
      {segments.map((seg, si) => {
        if (seg.type === "code") return <CodeBlock key={si} lang={seg.lang ?? ""} code={seg.value} />;
        if (seg.type === "json") return <JsonBlock key={si} raw={seg.value} />;

        // Text segment — render rich
        return (
          <div key={si}>
            {seg.value.split("\n").map((line, li) => {
              if (!line.trim()) return <div key={li} style={{ height: 6 }} />;
              // H1/H2 markdown: # or ##
              if (/^#{1,3}\s/.test(line)) {
                const level = (line.match(/^#+/) ?? [""])[0].length;
                const text = line.replace(/^#+\s/, "");
                return (
                  <div key={li} style={{ fontFamily: "var(--font)", fontSize: level === 1 ? 13 : 11, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "0.04em", marginTop: level === 1 ? 14 : 10, marginBottom: 5, textTransform: level === 1 ? "uppercase" : "none", borderBottom: level === 1 ? "1px solid var(--bg-border)" : "none", paddingBottom: level === 1 ? 5 : 0 }}>
                    <RichLine text={text} />
                  </div>
                );
              }
              // **Bold-only line** → treat as section header
              if (/^\*\*[^*]+\*\*$/.test(line.trim())) {
                return (
                  <div key={li} style={{ fontFamily: "var(--font)", fontSize: 11, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "0.04em", marginTop: 12, marginBottom: 4, textTransform: "uppercase" }}>
                    {line.replace(/\*\*/g, "")}
                  </div>
                );
              }
              // Numbered list or bullet
              const listM = line.match(/^(\d+\.|[-•▸*])\s+(.*)$/);
              if (listM) {
                const isNum = /^\d/.test(listM[1]);
                return (
                  <div key={li} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 5, paddingLeft: 4 }}>
                    <span style={{ fontFamily: "var(--font)", fontSize: 9, fontWeight: 700, color: "var(--accent)", flexShrink: 0, minWidth: 18, marginTop: 3 }}>
                      {isNum ? listM[1] : "▸"}
                    </span>
                    <span style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "rgba(var(--text-rgb),0.78)", lineHeight: 1.75 }}>
                      <RichLine text={listM[2]} />
                    </span>
                  </div>
                );
              }
              // URL line
              if (URL_RE.test(line)) {
                URL_RE.lastIndex = 0;
                return (
                  <p key={li} style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "rgba(var(--text-rgb),0.65)", lineHeight: 1.8, marginBottom: 4 }}>
                    <RichLine text={line} />
                  </p>
                );
              }
              // Normal paragraph
              return (
                <p key={li} style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "rgba(var(--text-rgb),0.65)", lineHeight: 1.8, marginBottom: 4 }}>
                  <RichLine text={line} />
                </p>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

function pad(n: number) { return n.toString().padStart(2, "0"); }
function nowStr() { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }

export default function AgentWorkPanel({
  task, agentA, agentB, onClose, onApprove, onReject, onJudgesComplete, savedState, onSaveState,
}: AgentWorkPanelProps) {
  const sv = savedState;
  const aw = useMessages().ui.agentWork;
  const { locale } = useLocale();

  const formatMeta: Record<string, { label: string; icon: string; color: string }> = {
    text: { label: aw.outputLabels.text, icon: "notes", color: "var(--text-muted)" },
    code: { label: aw.outputLabels.code, icon: "code", color: "#40E183" },
    json: { label: aw.outputLabels.json, icon: "data_object", color: "#FFD166" },
    url: { label: aw.outputLabels.url, icon: "link", color: "#7C9EFF" },
    report: { label: aw.outputLabels.report, icon: "article", color: "#B97DFF" },
  };

  const [phase, setPhase] = useState<AgentPanelSavedState["phase"]>(sv?.phase ?? "racing");
  const [progressA, setProgressA] = useState(sv?.progressA ?? 0);
  const [progressB, setProgressB] = useState(sv?.progressB ?? 0);
  const [winner, setWinner] = useState<"A" | "B" | null>(sv?.winner ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>(sv?.messages ?? []);
  const [agentResult, setAgentResult] = useState(sv?.agentResult ?? "");
  const [judgeScores, setJudgeScores] = useState<JudgeScore[]>(sv?.judgeScores ?? []);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [approving, setApproving] = useState(false);
  const [apiWarning, setApiWarning] = useState<string | null>(null);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Kaydet
  useEffect(() => {
    if (onSaveState && phase !== "racing") {
      onSaveState({ messages, phase, agentResult, judgeScores, progressA, progressB, winner });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, messages.length, judgeScores.length]);

  // Scroll
  useEffect(() => { chatBottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, rejectMode]);

  // ── Racing phase ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (sv) return; // Kaydedilmiş durum varsa sıfırdan başlatma

    // Rastgele kazananı önceden belirle
    const winnerChoice: "A" | "B" = Math.random() < 0.5 ? "A" : "B";
    // Kazanan 18-28s, kaybeden 22-35s (kazanan her zaman önce biter)
    const winnerSec  = 18 + Math.random() * 10;
    const loserSec   = winnerSec + 4 + Math.random() * 8;

    // Initial messages
    setTimeout(() => addMsg({ role: "agent", content: aw.chat.acceptedWithDesc(task.description.slice(0, 60)), ts: nowStr(), speaker: agentA.name }), 200);
    setTimeout(() => addMsg({ role: "agent", content: aw.chat.acceptedParallel, ts: nowStr(), speaker: agentB.name }), 700);

    // Progress tickers
    const ivA = setInterval(() => {
      setProgressA((p) => {
        const max = winnerChoice === "A" ? 95 : 90;
        if (p >= max) { clearInterval(ivA); return max; }
        return Math.min(max, p + (max / (winnerSec * 2)));
      });
    }, 500);

    const ivB = setInterval(() => {
      setProgressB((p) => {
        const max = winnerChoice === "B" ? 95 : 90;
        if (p >= max) { clearInterval(ivB); return max; }
        return Math.min(max, p + (max / (loserSec * 2)));
      });
    }, 500);

    // Mid messages
    const mid1 = setTimeout(() => {
      if (phaseRef.current !== "racing") return;
      addMsg({ role: "agent", content: aw.chat.scanningSources, ts: nowStr(), speaker: agentA.name });
    }, winnerSec * 300);

    const mid2 = setTimeout(() => {
      if (phaseRef.current !== "racing") return;
      addMsg({ role: "agent", content: aw.chat.compilingCriteria, ts: nowStr(), speaker: agentB.name });
    }, loserSec * 280);

    // Winner finishes first
    const winnerTimer = setTimeout(() => {
      if (phaseRef.current !== "racing") return;
      clearInterval(ivA); clearInterval(ivB);
      if (winnerChoice === "A") { setProgressA(100); setProgressB(88); }
      else                      { setProgressB(100); setProgressA(88); }
      setWinner(winnerChoice);
      setPhase("generating");
      const winnerAgent = winnerChoice === "A" ? agentA : agentB;
      const loserAgent  = winnerChoice === "A" ? agentB : agentA;
      addMsg({ role: "system", content: aw.chat.winnerGenerating(winnerAgent.name), ts: nowStr() });
      addMsg({ role: "agent", content: aw.chat.loserLost, ts: nowStr(), speaker: loserAgent.name });

      // Generate result via API
      fetch("/api/agent-work", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskDescription: task.description, criteria: task.criteria, agentName: winnerAgent.name, taskId: task.id }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (!data.success || !data.result) {
            // No real LLM output available — be honest, do not fabricate.
            setApiWarning(data.error || aw.apiMockWarning);
            addMsg({ role: "system", content: data.error || aw.apiMockWarning, ts: nowStr() });
            setPhase("submitted");
            return;
          }
          const result: string = data.result;
          setAgentResult(result);
          addMsg({ role: "submission", content: result, ts: nowStr(), speaker: winnerAgent.name });
          setPhase("judging");
          runJudges(result);
        })
        .catch(() => {
          setApiWarning(aw.apiMockWarning);
          addMsg({ role: "system", content: aw.apiMockWarning, ts: nowStr() });
          setPhase("submitted");
        });
    }, winnerSec * 1000);

    return () => { clearInterval(ivA); clearInterval(ivB); clearTimeout(mid1); clearTimeout(mid2); clearTimeout(winnerTimer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, locale]);

  function addMsg(m: ChatMessage) { setMessages((prev) => [...prev, m]); }

  async function runJudges(result: string) {
    let scores: JudgeScore[];
    try {
      const res = await fetch("/api/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskDescription: task.description, criteria: task.criteria, agentResult: result }),
      });
      const data = await res.json();
      if (!data.success || !Array.isArray(data.scores)) {
        setApiWarning(data.error || aw.apiMockWarning);
        addMsg({ role: "system", content: data.error || aw.apiMockWarning, ts: nowStr() });
        setPhase("submitted");
        onJudgesComplete?.();
        return;
      }
      scores = data.scores as JudgeScore[];
    } catch {
      setApiWarning(aw.apiMockWarning);
      setPhase("submitted");
      onJudgesComplete?.();
      return;
    }
    // Reveal the real judge scores one by one (display pacing only).
    scores.forEach((js, i) => {
      setTimeout(() => {
        setJudgeScores((prev) => [...prev, js]);
        addMsg({ role: "judge", content: `${js.name}: ${js.score}/100`, ts: nowStr(), judgeScore: js });
        if (i === scores.length - 1) {
          const avg = Math.round(scores.reduce((s, j) => s + j.score, 0) / scores.length);
          setTimeout(() => {
            addMsg({ role: "system", content: aw.chat.judgesSummary(avg), ts: nowStr() });
            setPhase("submitted");
            onJudgesComplete?.();
          }, 400);
        }
      }, (i + 1) * 900);
    });
  }

  async function sendMessage() {
    if (!input.trim() || sending || phase === "approved") return;
    const userMsg = input.trim();
    setInput("");
    addMsg({ role: "user", content: userMsg, ts: nowStr() });
    setSending(true);
    const chatAgent = winner === "B" ? agentB : agentA;
    try {
      const res = await fetch("/api/agent-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskDescription: task.description, criteria: task.criteria, userMessage: userMsg, chatHistory: messages.filter((m) => m.role === "user" || m.role === "agent"), agentName: chatAgent.name, taskId: task.id }),
      });
      const data = await res.json();
      addMsg({ role: "agent", content: data.reply, ts: nowStr(), speaker: chatAgent.name });
    } catch {
      addMsg({ role: "agent", content: aw.connectionError, ts: nowStr(), speaker: chatAgent.name });
    } finally { setSending(false); }
  }

  async function handleApprove() {
    setApproving(true);
    // The reward is released by the real on-chain settle (dashboard → /api/stellar/settle).
    setPhase("approved");
    addMsg({ role: "system", content: aw.systemApproved((task.rewardUsdc ?? 0).toFixed(4), "on-chain"), ts: nowStr() });
    onApprove(agentResult, "");
    setApproving(false);
  }

  function handleRejectSubmit() {
    if (!rejectReason.trim()) return;
    setPhase("rejected");
    addMsg({ role: "system", content: aw.systemRejected, ts: nowStr() });
    onReject(agentResult, rejectReason.trim());
  }

  const winnerAgent = winner === "B" ? agentB : agentA;
  const loserAgent  = winner === "B" ? agentA : agentB;
  const avgScore = judgeScores.length > 0 ? Math.round(judgeScores.reduce((s, j) => s + j.score, 0) / judgeScores.length) : null;

  return (
    <div style={{ background: S.surface, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* ── Header: iki agent yarış çubuğu ───────────────────── */}
      <div style={{ borderBottom: `1px solid ${S.border}`, padding: "10px 14px", flexShrink: 0 }}>

        {/* Agent A */}
        <AgentBar
          name={agentA.name} pubkey={agentA.pubkey}
          progress={progressA}
          isWinner={winner === "A"}
          isLoser={winner !== null && winner !== "A"}
          phase={phase}
          bar={{
            late: aw.barLate,
            generating: aw.barGenerating,
            judging: aw.barJudging,
            delivered: aw.barDelivered,
            working: aw.barWorking,
            workingEllipsis: aw.barWorkingEllipsis,
          }}
        />
        <div style={{ height: 8 }} />
        {/* Agent B */}
        <AgentBar
          name={agentB.name} pubkey={agentB.pubkey}
          progress={progressB}
          isWinner={winner === "B"}
          isLoser={winner !== null && winner !== "B"}
          phase={phase}
          bar={{
            late: aw.barLate,
            generating: aw.barGenerating,
            judging: aw.barJudging,
            delivered: aw.barDelivered,
            working: aw.barWorking,
            workingEllipsis: aw.barWorkingEllipsis,
          }}
        />

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginTop: 8 }}>
          <span style={{ color: S.tm }}>
            {aw.headerTaskLine(task.id)}<span style={{ color: S.accent }}>{(task.rewardUsdc ?? 0).toFixed(4)} XLM</span>
            {avgScore !== null && <span style={{ marginLeft: 10, color: avgScore >= 70 ? S.green : S.yellow }}>{aw.judgeAvgSuffix(avgScore)}</span>}
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: S.tm, cursor: "pointer", fontSize: 13, lineHeight: 1 }}>×</button>
        </div>
        {phase === "racing" && (
          <div style={{ fontSize: 9, color: S.tm, marginTop: 3 }}>
            {aw.racingHint}
          </div>
        )}
        {apiWarning && (
          <div style={{ marginTop: 8, background: S.yellowD, border: `1px solid ${S.yellow}`, padding: "5px 10px", fontSize: 10, color: S.yellow, lineHeight: 1.5 }}>
            ⚠ {aw.mockModePrefix} {apiWarning}
            <div style={{ color: S.tm, fontSize: 9, marginTop: 2 }}>{aw.mockModeHint}</div>
          </div>
        )}
      </div>

      {/* ── Chat ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 7 }}>
        {messages.map((m, i) => {
          if (m.role === "submission") {
            const fmt = task.outputFormat;
            const fmeta = fmt ? formatMeta[fmt] : null;
            return (
              <div key={i} style={{ animation: "fadeIn 0.3s ease" }}>
                {/* Submission header */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg-surface-high)", border: `1px solid ${S.accent}`, borderBottom: "none", padding: "7px 14px", borderRadius: "4px 4px 0 0" }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: S.accent, display: "inline-block", flexShrink: 0 }} />
                  <span style={{ fontFamily: "var(--font)", fontSize: 9, fontWeight: 700, color: S.accent, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    {m.speaker ?? winnerAgent.name}
                  </span>
                  <span style={{ fontFamily: "var(--font)", fontSize: 8, color: "rgba(var(--text-rgb),0.3)", letterSpacing: "0.05em" }}>{aw.submissionDelivered}</span>
                  {fmeta && (
                    <span style={{ marginLeft: 4, display: "inline-flex", alignItems: "center", gap: 4, background: `${fmeta.color}14`, border: `1px solid ${fmeta.color}44`, borderRadius: 3, padding: "1px 7px", fontFamily: "var(--font)", fontSize: 8, color: fmeta.color, letterSpacing: "0.06em" }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 10 }}>{fmeta.icon}</span>
                      {fmeta.label}
                    </span>
                  )}
                  <span style={{ marginLeft: "auto", fontFamily: "var(--font)", fontSize: 8, color: "rgba(var(--text-rgb),0.25)" }}>{m.ts}</span>
                  <CopyButton text={m.content} />
                </div>
                {/* Submission body — smart rendering */}
                <div style={{ background: S.bg, border: `1px solid ${S.accent}`, borderTop: "1px solid rgba(255,86,37,0.12)", borderRadius: "0 0 4px 4px", padding: "14px 16px", maxHeight: 380, overflowY: "auto" }}>
                  <ResultRenderer content={m.content} outputFormat={fmt} formatMeta={formatMeta} />
                </div>
              </div>
            );
          }
          if (m.role === "judge" && m.judgeScore) {
            const js = m.judgeScore;
            const c = js.score >= 80 ? S.green : js.score >= 60 ? S.yellow : S.red;
            const barW = `${js.score}%`;
            return (
              <div key={i} style={{ animation: "fadeIn 0.3s ease", background: "var(--bg-surface-high)", border: `1px solid var(--bg-border)`, borderLeft: `2px solid ${c}`, borderRadius: "0 3px 3px 0", padding: "7px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontFamily: "var(--font)", fontSize: 9, fontWeight: 700, color: S.yellow, letterSpacing: "0.06em", textTransform: "uppercase" }}>◈ {js.name}</span>
                  <span style={{ marginLeft: "auto", fontFamily: "var(--font)", fontSize: 11, fontWeight: 800, color: c }}>{js.score}<span style={{ fontSize: 8, color: "rgba(var(--text-rgb),0.3)", fontWeight: 400 }}>/100</span></span>
                  <span style={{ fontFamily: "var(--font)", fontSize: 8, color: "rgba(var(--text-rgb),0.25)" }}>{m.ts}</span>
                </div>
                <div style={{ background: "var(--bg-border)", height: 2, marginBottom: 5, overflow: "hidden" }}>
                  <div style={{ width: barW, height: "100%", background: c, transition: "width 0.8s ease" }} />
                </div>
                <span style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "rgba(var(--text-rgb),0.5)" }}>{js.comment}</span>
              </div>
            );
          }
          if (m.role === "system") {
            const isSuccess = m.content.startsWith("✓");
            const isDanger = m.content.startsWith("✗") || /mahkeme|court\s+process/i.test(m.content);
            const color     = isSuccess ? S.green : isDanger ? S.red : S.ts;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderTop: `1px solid ${S.border}`, animation: "fadeIn 0.3s ease" }}>
                <span style={{ fontFamily: "var(--font)", fontSize: 8, color: "rgba(var(--text-rgb),0.2)", flexShrink: 0 }}>{m.ts}</span>
                <span style={{ fontFamily: "var(--font)", fontSize: 10, color }}>{m.content}</span>
              </div>
            );
          }
          // agent or user bubble
          const isUser = m.role === "user";
          const agentColor = (m.speaker === agentB.name) ? "var(--blue)" : S.accent;
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start", animation: "fadeIn 0.2s ease" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                {!isUser && <span style={{ width: 5, height: 5, borderRadius: "50%", background: agentColor, display: "inline-block" }} />}
                <span style={{ fontFamily: "var(--font)", fontSize: 9, color: isUser ? "rgba(var(--text-rgb),0.3)" : agentColor }}>
                  {isUser ? aw.youLabel : m.speaker ?? agentA.name}
                </span>
                <span style={{ fontFamily: "var(--font)", fontSize: 8, color: "rgba(var(--text-rgb),0.2)" }}>{m.ts}</span>
              </div>
              <div style={{ background: isUser ? S.accentD : "var(--bg-surface-high)", border: `1px solid ${isUser ? "rgba(255,86,37,0.3)" : S.borderB}`, borderRadius: isUser ? "4px 4px 0 4px" : "0 4px 4px 4px", padding: "8px 12px", maxWidth: "88%", fontFamily: "var(--font-body)", fontSize: 11, color: S.tp, lineHeight: 1.7 }}>
                {m.content}
              </div>
            </div>
          );
        })}

        {/* Reject form */}
        {rejectMode && phase !== "rejected" && (
          <div style={{ marginTop: 4, background: S.redD, border: `1px solid ${S.red}`, padding: "12px 14px", borderRadius: 4, animation: "fadeIn 0.2s ease" }}>
            <div style={{ fontSize: 10, color: S.red, letterSpacing: "0.08em", marginBottom: 8 }}>{aw.rejectTitle}</div>
            <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder={aw.rejectPlaceholder} rows={3} autoFocus
              style={{ width: "100%", resize: "vertical", background: S.bg, border: "1px solid rgba(239,68,68,0.4)", color: S.tp, padding: "8px 10px", fontSize: 11, fontFamily: "var(--font)", lineHeight: 1.7, outline: "none", boxSizing: "border-box" }} />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={() => setRejectMode(false)} style={{ background: "none", border: `1px solid ${S.border}`, color: S.ts, padding: "5px 12px", fontSize: 10, cursor: "pointer", fontFamily: "var(--font)" }}>{aw.cancel}</button>
              <button onClick={handleRejectSubmit} disabled={!rejectReason.trim()} style={{ flex: 1, background: "none", border: `1px solid ${S.red}`, color: S.red, padding: "5px 12px", fontSize: 10, cursor: "pointer", fontFamily: "var(--font)", opacity: !rejectReason.trim() ? 0.4 : 1 }}>
                {aw.rejectSubmit}
              </button>
            </div>
          </div>
        )}
        <div ref={chatBottomRef} />
      </div>

      {/* ── Input ────────────────────────────────────────────── */}
      {phase !== "approved" && phase !== "rejected" && (
        <div style={{ borderTop: `1px solid ${S.border}`, padding: "8px 14px", display: "flex", gap: 8, flexShrink: 0 }}>
          <input value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder={phase === "racing" ? aw.inputPlaceholderRacing : aw.inputPlaceholderWinner}
            style={{ flex: 1, background: S.bg, border: `1px solid ${S.borderB}`, color: S.tp, padding: "6px 10px", fontSize: 11, fontFamily: "var(--font)", outline: "none" }}
            disabled={sending} />
          <button onClick={sendMessage} disabled={sending || !input.trim()}
            style={{ background: "none", border: `1px solid ${S.borderB}`, color: S.ts, padding: "6px 12px", fontSize: 10, cursor: "pointer", fontFamily: "var(--font)", opacity: !input.trim() ? 0.3 : 1 }}>
            {sending ? "···" : aw.send}
          </button>
        </div>
      )}

      {/* ── Approve / Reject ─────────────────────────────────── */}
      {phase === "submitted" && !rejectMode && (
        <div style={{ borderTop: `1px solid ${S.border}`, padding: "10px 14px", display: "flex", gap: 8, flexShrink: 0 }}>
          <button onClick={() => setRejectMode(true)}
            style={{ flex: 1, background: "none", border: `1px solid ${S.red}`, color: S.red, padding: "9px 14px", fontSize: 11, cursor: "pointer", fontFamily: "var(--font)" }}>
            {aw.rejectButton}
          </button>
          <button onClick={handleApprove} disabled={approving}
            style={{ flex: 2, background: "none", border: `1px solid ${S.green}`, color: S.green, padding: "9px 14px", fontSize: 11, cursor: approving ? "default" : "pointer", fontFamily: "var(--font)", opacity: approving ? 0.6 : 1 }}>
            {approving ? aw.approving((task.rewardUsdc ?? 0).toFixed(4)) : aw.approveSend((task.rewardUsdc ?? 0).toFixed(4))}
          </button>
        </div>
      )}

      {phase === "approved" && (
        <div style={{ borderTop: `1px solid ${S.border}`, padding: "10px 14px", textAlign: "center", flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: S.green }}>{aw.taskComplete(winnerAgent.name)}</span>
        </div>
      )}
    </div>
  );
}

// ── Sub-component: tek agent progress bar ────────────────────────
function AgentBar({ name, pubkey, progress, isWinner, isLoser, phase, bar }: {
  name: string; pubkey: string; progress: number;
  isWinner: boolean; isLoser: boolean; phase: string;
  bar: {
    late: string;
    generating: string;
    judging: string;
    delivered: string;
    working: string;
    workingEllipsis: string;
  };
}) {
  const S2 = {
    green:  "var(--green)",
    yellow: "var(--yellow)",
    red:    "var(--red)",
    accent: "var(--accent)",
    blue:   "var(--blue)",
    tm:     "var(--text-muted)",
    ts:     "var(--text-secondary)",
    tp:     "var(--text-primary)",
    border: "var(--bg-border)",
  };

  const isAlpha = name.includes("alpha") || name.includes("nova");
  const barColor = isLoser ? S2.tm : isWinner ? S2.green : (isAlpha ? S2.accent : S2.blue);
  const dotColor = isLoser ? S2.tm : isWinner ? S2.green : S2.yellow;
  const label = isLoser ? bar.late : isWinner ?
    (phase === "generating" ? bar.generating : phase === "judging" ? bar.judging : phase === "submitted" || phase === "approved" || phase === "rejected" ? bar.delivered : bar.working)
    : bar.workingEllipsis;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{
          width: 6, height: 6, borderRadius: "50%", background: dotColor, display: "inline-block", flexShrink: 0,
          animation: !isLoser && !isWinner ? "pulse 2s infinite" : "none",
        }} />
        <span style={{ fontSize: 11, color: isLoser ? S2.tm : S2.tp }}>{name}</span>
        {pubkey && <span style={{ fontSize: 9, color: S2.tm }}>{pubkey.slice(0, 6)}…{pubkey.slice(-4)}</span>}
        <span style={{ marginLeft: "auto", fontSize: 10, color: isLoser ? S2.tm : barColor }}>{label}</span>
        <span style={{ fontSize: 9, color: S2.tm }}>{Math.floor(progress)}%</span>
      </div>
      <div style={{ background: "var(--bg-border)", height: 2, overflow: "hidden" }}>
        <div style={{ width: `${progress}%`, height: "100%", background: barColor, transition: "width 0.5s ease", opacity: isLoser ? 0.35 : 1 }} />
      </div>
    </div>
  );
}
