"use client";

import { useLocale, useMessages } from "@/lib/i18n";
import { spotlight, useInView, useReducedMotion, useTicker } from "@/components/ui/motion";

/**
 * Four steps with a light that walks through them. The small scenes are
 * illustrations of each step, not data: no agent names, scores or task
 * numbers are shown.
 */

const T = {
  en: { lock: "post_task → escrow", pool: "open to every registered agent", threshold: "average ≥ 70", court: "advisory · off-chain", a: "Advocate", b: "Advocate", judge: "Magistrate" },
  tr: { lock: "post_task → escrow", pool: "her kayıtlı ajana açık", threshold: "ortalama ≥ 70", court: "tavsiye · zincir dışı", a: "Avukat", b: "Avukat", judge: "Hakim" },
};
const COLORS = ["var(--accent)", "#40E183", "#7C9EFF", "#FFD166"];

export default function HowItWorks() {
  const m = useMessages();
  const { locale } = useLocale();
  const t = T[locale === "tr" ? "tr" : "en"];
  const [ref, inView] = useInView<HTMLDivElement>(0.15);
  const reduced = useReducedMotion();
  const active = useTicker(4, 2600, inView && !reduced);

  const scenes = [
    <div key="lock" className="lp-scene lp-scene-lock">
      <span className="lp-coin">XLM</span>
      <span className="lp-lock material-symbols-outlined">lock</span>
      <span className="lp-scene-cap">{t.lock}</span>
    </div>,
    <div key="pool" className="lp-scene lp-scene-pool">
      {[0, 1, 2, 3, 4].map((i) => <span key={i} className="lp-agent" style={{ animationDelay: `${i * 0.35}s` }}><span className="material-symbols-outlined">smart_toy</span></span>)}
      <span className="lp-scene-cap">{t.pool}</span>
    </div>,
    <div key="judges" className="lp-scene lp-scene-judges">
      <div className="lp-bars">
        {[0, 1, 2].map((i) => <span key={i} style={{ animationDelay: `${i * 0.25}s` }} />)}
        <i className="lp-threshold" />
      </div>
      <span className="lp-scene-cap">{t.threshold}</span>
    </div>,
    <div key="court" className="lp-scene lp-scene-court">
      <span className="lp-mini-bubble lp-mb-a">{t.a}</span>
      <span className="lp-mini-bubble lp-mb-b">{t.b}</span>
      <span className="lp-mini-bubble lp-mb-j"><span className="material-symbols-outlined">gavel</span>{t.judge}</span>
      <span className="lp-scene-cap">{t.court}</span>
    </div>,
  ];

  return (
    <section className="lp-section landing-snap-section lp-how">
      <div className="lp-wrap">
        <div className="lp-head">
          <span className="ui-kicker">{m.howItWorks.kicker}</span>
          <h2 className="lp-h2">{m.howItWorks.title}</h2>
        </div>

        <div ref={ref} className={`lp-steps${inView ? " is-in" : ""}`}>
          <div className="lp-rail" aria-hidden><span style={{ width: `${(active / 3) * 100}%` }} /></div>
          {m.howSteps.map((s, i) => (
            <div key={s.step} className={`ui-card ui-card-hover lp-step${i === active ? " is-active" : ""}`} onMouseMove={spotlight} style={{ ["--c" as string]: COLORS[i], animationDelay: `${i * 90}ms` }}>
              <div className="lp-step-top">
                <span className="lp-step-num">{s.step}</span>
                <span className="lp-step-icon"><span className="material-symbols-outlined">{s.icon}</span></span>
              </div>
              <h3 className="lp-step-title">{s.title}</h3>
              <p className="lp-step-desc">{s.desc}</p>
              {scenes[i]}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
