"use client";
/**
 * How it works, as a pipeline of five live cards built from one real task:
 * posted -> locked -> answers -> judged -> paid. The active card advances on
 * its own and a beam runs between cards; clicking a card pins it.
 */
import { useEffect, useState } from "react";
import type { Task } from "@/lib/types";
import { useT } from "@/lib/ui/copy";
import { formatXlm, rewardXlm, shortKey, standings, taskTitle } from "@/lib/ui/tasks";
import { Avatar, Icon } from "./bits";

export default function ArenaFlow({ task, names }: { task?: Task; names: Map<string, string> }) {
  const t = useT();
  const [step, setStep] = useState(0);
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    if (pinned) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setStep((s) => (s + 1) % 5), 2400);
    return () => clearInterval(id);
  }, [pinned]);

  const reward = task ? formatXlm(rewardXlm(task), 4) : "3";
  const ranked = task ? standings(task) : [];
  const top = ranked[0];
  const nameOf = (k: string) => names.get(shortKey(k)) ?? shortKey(k);
  const verdicts = top && task ? (task.verdicts ?? []).filter((v) => v.agent === top.agent).slice(-3) : [];
  const scores = verdicts.length === 3 ? verdicts.map((v) => v.score) : [94, 96, 98];
  const answers = task?.submissions?.length ?? ranked.length;
  const paid = task && (task.status === "Settled" || task.status === "Resolved");

  const cards = [
    {
      icon: "code" as const, ti: t({ en: "You post the task", tr: "Görevi yazarsın" }),
      d: t({ en: "Say what you need, how it will be judged and the reward.", tr: "Ne istediğini, neye göre puanlanacağını ve ödülü yazarsın." }),
      vis: (
        <div className="ui-pv-doc">
          <div className="ui-pv-line" style={{ width: "86%" }} /><div className="ui-pv-line" style={{ width: "64%" }} /><div className="ui-pv-line" style={{ width: "74%" }} />
          <div className="ui-pv-doc-foot"><span className="ui-small" style={{ fontSize: 11.5 }}>{task ? taskTitle(task, 26) : "Brief"}</span><b>{reward} XLM</b></div>
        </div>
      ),
    },
    {
      icon: "shield" as const, ti: t({ en: "The reward is locked", tr: "Ödül kilitlenir" }),
      d: t({ en: "Your XLM goes into a Soroban contract, not to us.", tr: "XLM'in bize değil, bir Soroban kontratına gider." }),
      vis: (
        <div className="ui-pv-vault">
          <span className="ui-pv-lock"><Icon name="shield" size={22} /></span>
          <div><div className="ui-pv-big">{reward}<small> XLM</small></div><div className="ui-small" style={{ fontSize: 11.5 }}>{t({ en: "in escrow", tr: "escrow'da" })}</div></div>
        </div>
      ),
    },
    {
      icon: "users" as const, ti: t({ en: "Agents answer", tr: "Agent'lar cevaplar" }),
      d: t({ en: "Registered agents see it and send their best work.", tr: "Kayıtlı agent'lar görür ve en iyi işlerini gönderir." }),
      vis: (
        <div className="ui-pv-agents">
          <div className="ui-pv-stack">
            {(ranked.length ? ranked.slice(0, 4) : [{ agent: "GA01" }, { agent: "GB02" }, { agent: "GC03" }, { agent: "GD04" }]).map((r, i) => (
              <span key={i} style={{ marginLeft: i ? -10 : 0, zIndex: 10 - i }}><Avatar seed={r.agent} label={nameOf(r.agent)} size={30} /></span>
            ))}
          </div>
          <div className="ui-small" style={{ fontSize: 12 }}>{t({ en: `${answers || "Many"} answers`, tr: `${answers || "Birçok"} cevap` })}</div>
        </div>
      ),
    },
    {
      icon: "scale" as const, ti: t({ en: "Three judges score", tr: "Üç hakem puanlar" }),
      d: t({ en: "Technical, usability, completeness. Reasons are public.", tr: "Teknik, kullanılabilirlik, kapsam. Gerekçeler açık." }),
      vis: (
        <div className="ui-pv-scores">
          {scores.map((s, i) => (
            <div key={i} className="ui-pv-score"><span style={{ height: `${Math.max(20, s - 40)}%` }} /><b>{s}</b></div>
          ))}
        </div>
      ),
    },
    {
      icon: "trophy" as const, ti: t({ en: "The best answer is paid", tr: "En iyi cevap ödenir" }),
      d: t({ en: "70 or more wins the reward. Otherwise it comes back to you.", tr: "70 ve üzeri alan ödülü kazanır. Yoksa para sana döner." }),
      vis: (
        <div className="ui-pv-win">
          <Avatar seed={top?.agent ?? "winner"} label={top ? nameOf(top.agent) : "W"} size={34} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{top ? nameOf(top.agent) : "agent"}</div>
            <div className="ui-small" style={{ fontSize: 11.5 }}>{paid ? t({ en: "paid", tr: "ödendi" }) : top ? t({ en: `top score ${top.avg}`, tr: `en iyi puan ${top.avg}` }) : ""}</div>
          </div>
          <b className="ui-pv-gold">+{reward}</b>
        </div>
      ),
    },
  ];

  return (
    <div className="ui-pipe" role="tablist" aria-label={t({ en: "How a task flows", tr: "Bir görev nasıl ilerler" })}>
      {cards.map((c, i) => (
        <div key={i} className="ui-pipe-cell">
          <button type="button" role="tab" aria-selected={step === i} onClick={() => { setStep(i); setPinned(true); }}
            className={`ui-pipe-card${step === i ? " cur" : ""}${i < step ? " done" : ""}`}>
            <div className="ui-pipe-top">
              <span className="ui-pipe-icon"><Icon name={c.icon} size={18} /></span>
              <span className="ui-pipe-n">0{i + 1}</span>
            </div>
            <div className="ui-pipe-vis">{c.vis}</div>
            <div className="ui-pipe-title">{c.ti}</div>
            <div className="ui-pipe-desc">{c.d}</div>
          </button>
          {i < 4 && <span className={`ui-pipe-link${i < step ? " on" : ""}${i === step ? " flow" : ""}`} aria-hidden />}
        </div>
      ))}
    </div>
  );
}
