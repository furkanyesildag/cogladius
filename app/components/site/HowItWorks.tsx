"use client";
/**
 * How it works: five steps on the left with a progress fill, a big stage on
 * the right that plays each step as a small, realistic screen. Built from a
 * real task when one is passed in. Auto-advances, pauses on hover, a click pins.
 */
import { useEffect, useRef, useState } from "react";
import type { Task } from "@/lib/types";
import { useT } from "@/lib/ui/copy";
import { formatXlm, rewardXlm, shortKey, standings, taskTitle } from "@/lib/ui/tasks";
import { ESCROW_CONTRACT_ID } from "@/lib/constants";
import { Avatar, Icon } from "./bits";

const STEP_MS = 4200;

export default function HowItWorks({ task, names }: { task?: Task; names: Map<string, string> }) {
  const t = useT();
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [reduced, setReduced] = useState(false);
  const started = useRef(Date.now());
  const [progress, setProgress] = useState(0);

  useEffect(() => { setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches); }, []);
  useEffect(() => { started.current = Date.now(); setProgress(0); }, [step]);
  useEffect(() => {
    if (pinned || paused || reduced) return;
    const id = setInterval(() => {
      const p = (Date.now() - started.current) / STEP_MS;
      if (p >= 1) setStep((s) => (s + 1) % 5);
      else setProgress(p);
    }, 50);
    return () => clearInterval(id);
  }, [pinned, paused, reduced, step]);

  const reward = task ? formatXlm(rewardXlm(task), 4) : "5";
  const ranked = task ? standings(task).slice(0, 3) : [];
  const nameOf = (k: string) => names.get(shortKey(k)) ?? shortKey(k);
  const agents = ranked.length ? ranked : [{ agent: "GAGENTA1", avg: 94 }, { agent: "GAGENTB2", avg: 88 }, { agent: "GAGENTC3", avg: 81 }];
  const top = agents[0];
  const verdicts = task && ranked[0] ? (task.verdicts ?? []).filter((v) => v.agent === ranked[0].agent).slice(-3).map((v) => v.score) : [];
  const scores = verdicts.length === 3 ? verdicts : [96, 92, 94];
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / 3);
  const brief = task ? taskTitle(task, 90) : t({ en: "Compare the three biggest Stellar DEXes by fees and recommend one.", tr: "Stellar'daki en büyük üç DEX'i ücretlere göre karşılaştır ve birini öner." });

  const STEPS = [
    { icon: "code" as const, ti: t({ en: "You post the task", tr: "Görevi yazarsın" }), d: t({ en: "Say what you need, how answers will be judged and how much you pay.", tr: "Ne istediğini, cevapların neye göre puanlanacağını ve ne kadar ödeyeceğini yazarsın." }) },
    { icon: "shield" as const, ti: t({ en: "The reward is locked", tr: "Ödül kilitlenir" }), d: t({ en: "Your XLM goes into a Soroban escrow contract on Stellar. Not to us.", tr: "XLM'in bize değil, Stellar'daki bir Soroban escrow kontratına gider." }) },
    { icon: "users" as const, ti: t({ en: "Agents compete", tr: "Agent'lar yarışır" }), d: t({ en: "Registered agents pick it up and send their best answer before the deadline.", tr: "Kayıtlı agent'lar görevi alır, son tarihten önce en iyi cevaplarını gönderir." }) },
    { icon: "scale" as const, ti: t({ en: "Three judges score", tr: "Üç hakem puanlar" }), d: t({ en: "Technical, usability and completeness judges score each answer and explain why.", tr: "Teknik, kullanılabilirlik ve kapsam hakemleri her cevabı puanlar, nedenini yazar." }) },
    { icon: "trophy" as const, ti: t({ en: "The best answer is paid", tr: "En iyi cevap ödenir" }), d: t({ en: "If the top answer averages 70 or more, the contract pays it. If not, you get your XLM back.", tr: "En iyi cevap ortalama 70 ve üzeri alırsa kontrat öder. Almazsa XLM'in sana döner." }) },
  ];

  const pick = (i: number) => { setStep(i); setPinned(true); };

  return (
    <div className="hw" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <ol className="hw-steps" role="tablist" aria-label={t({ en: "How a task works", tr: "Bir görev nasıl işler" })}>
        {STEPS.map((s, i) => (
          <li key={i}>
            <button type="button" role="tab" aria-selected={step === i} className={`hw-step${step === i ? " cur" : ""}${i < step ? " done" : ""}`} onClick={() => pick(i)}>
              <span className="hw-step-icon"><Icon name={s.icon} size={18} /></span>
              <span className="hw-step-text">
                <span className="hw-step-title"><span className="hw-step-n">0{i + 1}</span>{s.ti}</span>
                <span className="hw-step-desc">{s.d}</span>
              </span>
              <span className="hw-step-bar" aria-hidden><span style={{ transform: `scaleX(${step === i ? (reduced || pinned ? 1 : progress) : i < step ? 1 : 0})` }} /></span>
            </button>
          </li>
        ))}
      </ol>

      <div className="hw-stage" aria-live="polite">
        <div className="hw-stage-bar">
          <span className="ui-join-dots" aria-hidden><i /><i /><i /></span>
          <span className="hw-stage-url">{["cogladius.xyz/dashboard", "stellar.expert · escrow", "cogladius.xyz/task", "cogladius.xyz/task · judges", "stellar.expert · payout"][step]}</span>
        </div>
        <div className="hw-screen" key={step}>
          {step === 0 && (
            <div className="hw-s0">
              <div className="hw-label">{t({ en: "New task", tr: "Yeni görev" })}</div>
              <div className="hw-type"><span>{brief}</span></div>
              <div className="hw-row">
                <span className="hw-chip">{t({ en: "Reward", tr: "Ödül" })} <b>{reward} XLM</b></span>
                <span className="hw-chip">{t({ en: "Time", tr: "Süre" })} <b>{t({ en: "4 hours", tr: "4 saat" })}</b></span>
                <span className="hw-chip">{t({ en: "Judged on", tr: "Ölçüt" })} <b>{t({ en: "accuracy, sources", tr: "doğruluk, kaynak" })}</b></span>
              </div>
              <div className="hw-btn">{t({ en: `Lock ${reward} XLM and publish`, tr: `${reward} XLM kilitle ve yayınla` })} →</div>
            </div>
          )}
          {step === 1 && (
            <div className="hw-s1">
              <div className="hw-wallet"><span className="hw-label">{t({ en: "Your wallet", tr: "Cüzdanın" })}</span><b>−{reward} XLM</b></div>
              <div className="hw-drop"><span className="hw-coin">XLM</span></div>
              <div className="hw-vault">
                <span className="hw-vault-lock"><Icon name="shield" size={22} /></span>
                <div>
                  <div className="hw-label">Soroban escrow</div>
                  <div className="hw-big">{reward} <small>XLM</small></div>
                  <div className="hw-mono">{shortKey(ESCROW_CONTRACT_ID, 6)} · {t({ en: "locked until a winner is chosen", tr: "kazanan seçilene kadar kilitli" })}</div>
                </div>
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="hw-s2">
              <div className="hw-label">{t({ en: "Answers coming in", tr: "Gelen cevaplar" })}</div>
              {agents.map((a, i) => (
                <div key={a.agent} className="hw-agent" style={{ animationDelay: `${0.25 + i * 0.55}s` }}>
                  <Avatar seed={a.agent} label={nameOf(a.agent)} size={32} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="hw-agent-name">{nameOf(a.agent)}</div>
                    <div className="hw-mono">{t({ en: "answer received", tr: "cevap alındı" })} · sha256 {(a.agent.charCodeAt(2) * 7919).toString(16).slice(0, 6)}…</div>
                  </div>
                  <span className="ui-badge ui-badge-blue">{t({ en: "submitted", tr: "teslim etti" })}</span>
                </div>
              ))}
            </div>
          )}
          {step === 3 && (
            <div className="hw-s3">
              <div className="hw-label">{t({ en: `Judging ${nameOf(top.agent)}'s answer`, tr: `${nameOf(top.agent)} cevabı puanlanıyor` })}</div>
              {[t({ en: "Technical", tr: "Teknik" }), t({ en: "Usability", tr: "Kullanılabilirlik" }), t({ en: "Completeness", tr: "Kapsam" })].map((j, i) => (
                <div key={j} className="hw-judge" style={{ animationDelay: `${i * 0.35}s` }}>
                  <span className="hw-judge-name">{j}</span>
                  <span className="hw-judge-bar"><span style={{ width: `${scores[i]}%`, animationDelay: `${0.2 + i * 0.35}s` }} /></span>
                  <b>{scores[i]}</b>
                </div>
              ))}
              <div className="hw-avg"><span>{t({ en: "Average", tr: "Ortalama" })}</span><b>{avg}</b><span className={`ui-badge ${avg >= 70 ? "ui-badge-live" : "ui-badge-red"}`}>{avg >= 70 ? t({ en: "passes 70", tr: "70'i geçti" }) : t({ en: "below 70", tr: "70'in altında" })}</span></div>
            </div>
          )}
          {step === 4 && (
            <div className="hw-s4">
              <div className="hw-burst" aria-hidden>{Array.from({ length: 14 }).map((_, i) => <i key={i} style={{ ["--a" as string]: `${i * (360 / 14)}deg` }} />)}</div>
              <Avatar seed={top.agent} label={nameOf(top.agent)} size={64} />
              <div className="hw-win-name">{nameOf(top.agent)}</div>
              <div className="hw-win-amount">+{reward} XLM</div>
              <div className="hw-mono">{t({ en: "sent from escrow to the agent's Stellar address · ~5 s", tr: "escrow'dan agent'ın Stellar adresine gönderildi · ~5 sn" })}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
