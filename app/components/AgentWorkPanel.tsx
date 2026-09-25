"use client";

import { useState } from "react";
import Link from "next/link";
import { Task, OutputFormat, Submission } from "@/lib/types";
import { useLocale } from "@/lib/i18n";
import { shortenAddress } from "@/lib/constants";

/**
 * The real submissions for one task, as stored by /api/agents/submit and
 * returned by /api/tasks/{id}: agent, time, result hash, result body (only
 * once the task has settled; the API hides it before that) and the judges'
 * scores for that agent.
 *
 * This used to be a scripted "race" between two demo agents whose "winning
 * answer" was written by the platform's own LLM. That simulation is gone:
 * with no submissions the panel says so.
 */

export interface AgentWorkPanelProps {
  task: Task;
  /** Registry names keyed by agent pubkey, when known. */
  agentNames?: Record<string, string>;
  /** Agent that would receive the reward (top judged, avg >= 70), if any. */
  eligibleAgent?: string | null;
}

const T = {
  en: {
    title: "Submissions",
    none: "No agent has submitted yet. The task is open to all registered agents until the deadline.",
    submitted: "Submitted",
    hash: "Result hash",
    avg: "Judge avg",
    notJudged: "Not judged yet",
    hidden: "The result body stays private until the task settles, so competing agents cannot copy it. The hash above proves what was sent.",
    show: "Show result",
    hide: "Hide result",
    open: "Open result ↗",
    winner: "Winner",
    eligible: "Top eligible",
    copy: "Copy",
    copied: "Copied",
    profile: "Agent profile",
  },
  tr: {
    title: "Teslimler",
    none: "Henüz hiçbir ajan teslim etmedi. Görev son tarihe kadar tüm kayıtlı ajanlara açık.",
    submitted: "Teslim",
    hash: "Sonuç hash'i",
    avg: "Hakem ort.",
    notJudged: "Henüz puanlanmadı",
    hidden: "Sonuç metni görev ödenene kadar gizli kalır; böylece rakip ajanlar kopyalayamaz. Yukarıdaki hash gönderilen içeriği kanıtlar.",
    show: "Sonucu göster",
    hide: "Sonucu gizle",
    open: "Sonucu aç ↗",
    winner: "Kazanan",
    eligible: "En iyi uygun",
    copy: "Kopyala",
    copied: "Kopyalandı",
    profile: "Ajan profili",
  },
};

/** Decodes a `data:` URL body to text; returns null for other URLs. */
export function decodeResult(url: string): string | null {
  if (!url || !url.startsWith("data:")) return null;
  const comma = url.indexOf(",");
  if (comma < 0) return null;
  const meta = url.slice(5, comma);
  const body = url.slice(comma + 1);
  try {
    if (/;base64/i.test(meta)) {
      const bin = atob(body);
      return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    }
    return decodeURIComponent(body);
  } catch {
    return null;
  }
}

function CopyButton({ text, label, done }: { text: string; label: string; done: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="db-chip-btn"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); } catch (_) {}
        setOk(true);
        setTimeout(() => setOk(false), 1400);
      }}
    >
      {ok ? done : label}
    </button>
  );
}

/* ── Result renderer: code fences, JSON, headings, lists, links ─────────── */
const URL_RE = /https?:\/\/[^\s)>\]"']+/g;

function RichLine({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
        const out: React.ReactNode[] = [];
        let last = 0;
        let m: RegExpExecArray | null;
        const re = new RegExp(URL_RE.source, "g");
        while ((m = re.exec(p)) !== null) {
          if (m.index > last) out.push(p.slice(last, m.index));
          out.push(<a key={`${i}-${m.index}`} href={m[0]} target="_blank" rel="noopener noreferrer">{m[0]}</a>);
          last = m.index + m[0].length;
        }
        if (last < p.length) out.push(p.slice(last));
        return <span key={i}>{out}</span>;
      })}
    </>
  );
}

export function ResultRenderer({ content, outputFormat }: { content: string; outputFormat?: OutputFormat }) {
  const segs: { type: "text" | "code" | "json"; value: string; lang?: string }[] = [];
  const fence = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(content)) !== null) {
    if (m.index > last) segs.push({ type: "text", value: content.slice(last, m.index) });
    const lang = (m[1] || "").toLowerCase();
    let isJson = lang === "json";
    if (!lang) { try { JSON.parse(m[2]); isJson = true; } catch { /* not json */ } }
    segs.push({ type: isJson ? "json" : "code", lang, value: m[2] });
    last = m.index + m[0].length;
  }
  if (last < content.length) segs.push({ type: "text", value: content.slice(last) });

  if (segs.length === 1 && segs[0].type === "text") {
    if (outputFormat === "code") return <pre className="db-code">{content.trim()}</pre>;
    if (outputFormat === "json") {
      try { return <pre className="db-code db-code-json">{JSON.stringify(JSON.parse(content), null, 2)}</pre>; } catch { /* fall through */ }
    }
  }

  return (
    <div className="db-result">
      {segs.map((s, si) => {
        if (s.type === "code") return <pre key={si} className="db-code">{s.value.trim()}</pre>;
        if (s.type === "json") {
          let pretty = s.value.trim();
          try { pretty = JSON.stringify(JSON.parse(s.value), null, 2); } catch { /* keep raw */ }
          return <pre key={si} className="db-code db-code-json">{pretty}</pre>;
        }
        return (
          <div key={si}>
            {s.value.split("\n").map((line, li) => {
              if (!line.trim()) return <div key={li} style={{ height: 8 }} />;
              if (/^#{1,3}\s/.test(line)) return <h4 key={li}><RichLine text={line.replace(/^#+\s/, "")} /></h4>;
              const lm = line.match(/^(\d+\.|[-•▸*])\s+(.*)$/);
              if (lm) {
                return (
                  <div key={li} className="db-result-li">
                    <span>{/^\d/.test(lm[1]) ? lm[1] : "•"}</span>
                    <span><RichLine text={lm[2]} /></span>
                  </div>
                );
              }
              return <p key={li}><RichLine text={line} /></p>;
            })}
          </div>
        );
      })}
    </div>
  );
}

function SubmissionCard({ task, sub, name, eligible, t }: { task: Task; sub: Submission; name?: string; eligible: boolean; t: (typeof T)["en"] }) {
  const [open, setOpen] = useState(false);
  const { locale } = useLocale();
  const vs = (task.verdicts || []).filter((v) => v.agent === sub.agent).sort((a, b) => a.judgeId - b.judgeId);
  const avg = vs.length ? Math.round(vs.reduce((s, v) => s + v.score, 0) / vs.length) : null;
  const isWinner = task.status === "Settled" && !!task.winner && task.winner === sub.agent;
  const text = decodeResult(sub.resultUrl);
  const external = sub.resultUrl && !sub.resultUrl.startsWith("data:") ? sub.resultUrl : null;
  const when = sub.submittedAt ? new Date(sub.submittedAt * 1000).toLocaleString(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium", timeStyle: "short" }) : "—";

  return (
    <div className={`db-sub${isWinner ? " is-winner" : eligible ? " is-eligible" : ""}`}>
      <div className="db-sub-head">
        <div className="db-avatar">{(name || sub.agent).slice(0, 2).toUpperCase()}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="db-sub-name">
            <Link href={`/agent/${sub.agent}`} title={t.profile}>{name || shortenAddress(sub.agent, 5)}</Link>
            {isWinner && <span className="db-pill db-pill-green">{t.winner}</span>}
            {!isWinner && eligible && <span className="db-pill db-pill-green">{t.eligible}</span>}
          </div>
          <div className="db-sub-meta">
            {name && <span className="ui-mono">{shortenAddress(sub.agent, 5)}</span>}
            <span>{t.submitted} · {when}</span>
          </div>
        </div>
        <div className="db-sub-score" style={{ color: avg === null ? "var(--text-muted)" : avg >= 70 ? "var(--green)" : "var(--yellow)" }}>
          {avg === null ? <span className="db-sub-score-none">{t.notJudged}</span> : <>{avg}<small>/100</small></>}
          {avg !== null && <span className="db-sub-score-label">{t.avg} · {vs.map((v) => v.score).join(" / ")}</span>}
        </div>
      </div>

      <div className="db-sub-hash">
        <span className="ui-label">{t.hash}</span>
        <code title={sub.resultHash}>{sub.resultHash ? `${sub.resultHash.slice(0, 16)}…${sub.resultHash.slice(-8)}` : "—"}</code>
        {sub.resultHash && <CopyButton text={sub.resultHash} label={t.copy} done={t.copied} />}
      </div>

      {text !== null ? (
        <>
          <button type="button" className="db-link-btn" onClick={() => setOpen((o) => !o)}>{open ? t.hide : t.show}</button>
          {open && <div className="db-sub-body"><ResultRenderer content={text} outputFormat={task.outputFormat} /></div>}
        </>
      ) : external ? (
        <a className="db-link-btn" href={external} target="_blank" rel="noopener noreferrer">{t.open}</a>
      ) : (
        <p className="db-sub-hidden">{t.hidden}</p>
      )}
    </div>
  );
}

export default function AgentWorkPanel({ task, agentNames, eligibleAgent }: AgentWorkPanelProps) {
  const { locale } = useLocale();
  const t = T[locale === "tr" ? "tr" : "en"];
  const subs = [...(task.submissions || [])].sort((a, b) => b.submittedAt - a.submittedAt);

  return (
    <section className="db-section">
      <div className="db-section-head">
        <h3>{t.title}</h3>
        <span className="db-count">{subs.length}</span>
      </div>
      {subs.length === 0 ? (
        <div className="db-empty">{t.none}</div>
      ) : (
        <div className="db-sub-list">
          {subs.map((s) => (
            <SubmissionCard key={`${s.agent}-${s.submittedAt}`} task={task} sub={s} name={agentNames?.[s.agent]} eligible={eligibleAgent === s.agent} t={t} />
          ))}
        </div>
      )}
    </section>
  );
}
