"use client";

import Link from "next/link";
import { useLocale, useMessages } from "@/lib/i18n";
import { useInView, useLoop, useReducedMotion } from "@/components/ui/motion";

/** NEXUS on the landing page: the real steps, and a mockup labelled as an example. */

const T = {
  en: { example: "Example", thinking: "NEXUS is planning…", total: "Total" },
  tr: { example: "Örnek", thinking: "NEXUS planlıyor…", total: "Toplam" },
};
const ROWS = [
  { color: "#FF5625", icon: "currency_bitcoin", pct: 40 },
  { color: "#7C9EFF", icon: "web", pct: 30 },
  { color: "#B97DFF", icon: "palette", pct: 15 },
  { color: "#FFD166", icon: "account_balance", pct: 15 },
];

export default function Nexus() {
  const m = useMessages();
  const n = m.nexusSection;
  const { locale } = useLocale();
  const t = T[locale === "tr" ? "tr" : "en"];
  const [ref, inView] = useInView<HTMLDivElement>(0.2);
  const reduced = useReducedMotion();
  // 0: typing, 1: message, 2..5: rows appear, 6: confirm; then holds and replays.
  const step = useLoop(6, 700, 5200, inView && !reduced);
  const shown = !inView ? 0 : reduced ? 6 : step;

  const steps = [
    { icon: "psychology", title: n.s1Title, desc: n.s1Desc, color: "#B97DFF" },
    { icon: "hub", title: n.s2Title, desc: n.s2Desc, color: "var(--accent)" },
    { icon: "account_balance_wallet", title: n.s3Title, desc: n.s3Desc, color: "#40E183" },
    { icon: "check_circle", title: n.s4Title, desc: n.s4Desc, color: "#7C9EFF" },
  ];

  return (
    <section className="lp-section landing-snap-section lp-nexus">
      <div className="lp-wrap">
        <div className="lp-head">
          <span className="ui-kicker"><span className="infra-dot" style={{ background: "var(--accent)" }} />{n.badge}</span>
          <h2 className="lp-h2">{n.headline1} <em>{n.headline2}</em></h2>
          <p className="lp-sub">{n.sub}</p>
        </div>

        <div className="lp-nexus-grid">
          <ol className="lp-nexus-steps">
            {steps.map((s, i) => (
              <li key={s.title} style={{ ["--c" as string]: s.color }}>
                <span className="lp-nexus-icon"><span className="material-symbols-outlined">{s.icon}</span></span>
                <div>
                  <div className="lp-nexus-step-title"><span>0{i + 1}</span>{s.title}</div>
                  <p>{s.desc}</p>
                </div>
              </li>
            ))}
            <li className="lp-nexus-cta">
              <Link href="/projects" className="lp-btn lp-btn-primary">{n.cta}<span className="material-symbols-outlined">arrow_forward</span></Link>
            </li>
          </ol>

          <div ref={ref} className="lp-mock">
            <div className="lp-mock-bar">
              <span className="lp-mock-dots"><i /><i /><i /></span>
              <span>NEXUS · cogladius.xyz/projects</span>
              <span className="lp-example">{t.example}</span>
            </div>

            <div className="lp-mock-chat">
              <span className="lp-nexus-avatar"><img src="/logo.svg" alt="" width={22} height={22} /></span>
              {shown === 0 ? (
                <div className="lp-typing"><i /><i /><i /><span>{t.thinking}</span></div>
              ) : (
                <div className="lp-mock-msg">
                  {n.mockupChat} <strong>10 XLM</strong> <strong style={{ color: "var(--green)" }}>{n.mockupChatMid}</strong> {n.mockupChatSuffix}
                </div>
              )}
            </div>

            <div className="lp-mock-project">
              <div>
                <div className="lp-mock-name">{n.mockupProject}</div>
                <div className="lp-mock-meta">{n.mockupMeta}</div>
              </div>
              <span className="lp-mock-status">{n.mockupStatus}</span>
            </div>

            {ROWS.map((r, i) => {
              const on = shown >= i + 2;
              return (
                <div key={r.icon} className={`lp-mock-row${on ? " is-on" : ""}`} style={{ ["--c" as string]: r.color }}>
                  <span className="material-symbols-outlined">{r.icon}</span>
                  <span className="lp-mock-spec">{n.mockupSpecs[i]?.spec}</span>
                  <span className="lp-mock-bar-track"><span style={{ width: on ? `${r.pct * 2}%` : 0 }} /></span>
                  <span className="lp-mock-pct">{r.pct}%</span>
                  <span className="lp-mock-xlm">{(r.pct / 10).toFixed(1)} XLM</span>
                </div>
              );
            })}

            <div className="lp-mock-foot">
              <span>{n.mockupFooter}</span>
              <span className={`lp-mock-confirm${shown >= 6 ? " is-on" : ""}`}><span className="material-symbols-outlined">check_circle</span>{n.mockupConfirm}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
