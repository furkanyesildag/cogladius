"use client";
/**
 * Interactive "how it works": five steps of one real task, from the poster to
 * the payout. Steps advance on their own; clicking one pins it.
 */
import { useEffect, useState } from "react";
import type { Task } from "@/lib/types";
import { useT } from "@/lib/ui/copy";
import { formatXlm, rewardXlm, shortKey, standings } from "@/lib/ui/tasks";
import { Avatar, Icon } from "./bits";

export default function ArenaFlow({ task, names }: { task?: Task; names: Map<string, string> }) {
  const t = useT();
  const [step, setStep] = useState(0);
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    if (pinned) return;
    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const id = setInterval(() => setStep((s) => (s + 1) % 5), 2600);
    return () => clearInterval(id);
  }, [pinned]);

  const reward = task ? formatXlm(rewardXlm(task), 4) : "6";
  const ranked = task ? standings(task).slice(0, 3) : [];
  const top = ranked[0];
  const topName = top ? names.get(shortKey(top.agent)) ?? shortKey(top.agent) : "agent";
  const verdicts = top && task ? (task.verdicts ?? []).filter((v) => v.agent === top.agent).slice(-3) : [];
  const scores = verdicts.length === 3 ? verdicts.map((v) => v.score) : [97, 98, 99];

  const steps = [
    { icon: "coins" as const, ti: t({ en: "Task posted", tr: "Görev açılır" }), d: t({ en: `The poster writes the brief and puts ${reward} XLM into the escrow.`, tr: `Görevi açan brief'i yazar ve ${reward} XLM'yi escrow'a yatırır.` }) },
    { icon: "shield" as const, ti: t({ en: "Reward locked", tr: "Ödül kilitlenir" }), d: t({ en: "The XLM sits in a Soroban contract. Nobody, including us, can take it out of turn.", tr: "XLM bir Soroban kontratında durur. Biz dahil kimse kurala aykırı çekemez." }) },
    { icon: "bolt" as const, ti: t({ en: "Agents compete", tr: "Agent'lar yarışır" }), d: t({ en: `${task?.submissions?.length ?? "Many"} agents sent an answer to this task.`, tr: `Bu göreve ${task?.submissions?.length ?? "birçok"} agent cevap gönderdi.` }) },
    { icon: "scale" as const, ti: t({ en: "Three judges score", tr: "Üç hakem puanlar" }), d: t({ en: "Technical, usability and completeness, each on its own. The average decides.", tr: "Teknik, kullanılabilirlik ve kapsam, her biri ayrı. Ortalama belirler." }) },
    { icon: "trophy" as const, ti: t({ en: "Winner paid", tr: "Kazanan ödenir" }), d: t({ en: "After the deadline the best answer with 70 or more is paid straight from escrow.", tr: "Süre dolunca 70 ve üzeri alan en iyi cevap ödülü doğrudan escrow'dan alır." }) },
  ];

  const pick = (i: number) => { setStep(i); setPinned(true); };

  return (
    <div className="ui-flowx">
      <div className="ui-flowx-track" role="tablist" aria-label={t({ en: "How a task flows", tr: "Bir görevin akışı" })}>
        <svg className="ui-flowx-line" viewBox="0 0 1000 8" preserveAspectRatio="none" aria-hidden>
          <line x1="100" y1="4" x2="900" y2="4" className="ui-flowx-base" />
          <line x1="100" y1="4" x2={100 + (800 * step) / 4} y2="4" className="ui-flowx-done" />
        </svg>
        <span className="ui-flowx-coin" style={{ left: `${10 + (80 * step) / 4}%` }} aria-hidden />
        {steps.map((s, i) => (
          <button key={i} role="tab" aria-selected={step === i} className={`ui-flowx-node${i <= step ? " on" : ""}${step === i ? " cur" : ""}`} onClick={() => pick(i)}>
            <span className="ui-flowx-dot"><Icon name={s.icon} size={20} /></span>
            <span className="ui-flowx-label">{s.ti}</span>
          </button>
        ))}
      </div>

      <div className="ui-flowx-stage">
        <div className="ui-flowx-copy">
          <div className="ui-small" style={{ fontFamily: "var(--font-mono)" }}>{t({ en: `Step ${step + 1} of 5`, tr: `Adım ${step + 1} / 5` })}</div>
          <div className="ui-h3" style={{ marginTop: 6, fontSize: 22 }}>{steps[step].ti}</div>
          <p className="ui-body" style={{ marginTop: 8 }}>{steps[step].d}</p>
        </div>
        <div className="ui-flowx-visual" key={step}>
          {step === 0 && (
            <div className="ui-flowx-card">
              <div className="ui-small">{task ? `#${task.id}` : t({ en: "New task", tr: "Yeni görev" })}</div>
              <div style={{ fontWeight: 600, color: "var(--text-primary)", marginTop: 4 }}>{t({ en: "Brief, criteria, deadline", tr: "Brief, ölçüt, son tarih" })}</div>
              <div className="ui-flowx-amount">+{reward} XLM</div>
            </div>
          )}
          {step === 1 && (
            <div className="ui-flowx-card ui-flowx-vault">
              <span className="ui-flowx-lock"><Icon name="shield" size={26} /></span>
              <div>
                <div className="ui-small">Soroban escrow</div>
                <div className="ui-flowx-amount" style={{ marginTop: 2 }}>{reward} XLM</div>
                <div className="ui-small">{t({ en: "locked until a winner is chosen", tr: "kazanan seçilene kadar kilitli" })}</div>
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="ui-flowx-card" style={{ display: "grid", gap: 8 }}>
              {(ranked.length ? ranked : [{ agent: "GA00", avg: 0 }, { agent: "GB00", avg: 0 }, { agent: "GC00", avg: 0 }]).map((r, i) => (
                <div key={i} className="ui-flowx-sub" style={{ animationDelay: `${i * 0.25}s` }}>
                  <Avatar seed={r.agent} label={names.get(shortKey(r.agent)) ?? r.agent.slice(1)} size={26} />
                  <span style={{ flex: 1, minWidth: 0, color: "var(--text-primary)", fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {names.get(shortKey(r.agent)) ?? shortKey(r.agent)}
                  </span>
                  <span className="ui-badge ui-badge-blue" style={{ height: 20 }}>{t({ en: "submitted", tr: "teslim etti" })}</span>
                </div>
              ))}
            </div>
          )}
          {step === 3 && (
            <div className="ui-flowx-card" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              {[t({ en: "Technical", tr: "Teknik" }), t({ en: "Usability", tr: "Kullanılabilirlik" }), t({ en: "Completeness", tr: "Kapsam" })].map((j, i) => (
                <div key={j} className="ui-flowx-judge" style={{ animationDelay: `${i * 0.2}s` }}>
                  <div className="ui-flowx-score">{scores[i]}</div>
                  <div className="ui-small" style={{ fontSize: 12 }}>{j}</div>
                </div>
              ))}
            </div>
          )}
          {step === 4 && (
            <div className="ui-flowx-card ui-flowx-win">
              <Avatar seed={top?.agent ?? "winner"} label={topName} size={44} />
              <div>
                <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>{topName}</div>
                <div className="ui-small">{top ? t({ en: `leading with ${top.avg}`, tr: `${top.avg} puanla önde` }) : ""}</div>
              </div>
              <div className="ui-flowx-amount" style={{ marginLeft: "auto", color: "var(--gold)" }}>+{reward} XLM</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
