"use client";
/**
 * NEXUS on the home page: one project goes in at the top, NEXUS (the planning
 * agent) splits it, and specialist tasks with their budget share come out.
 * Signals run down the wires in a loop. Purely illustrative, labelled as an example.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/lib/ui/copy";
import { Avatar, Icon } from "./bits";

const PARTS = [
  { en: "Smart contracts", tr: "Akıllı kontratlar", pct: 40, agent: "GSOROBAN" },
  { en: "Frontend", tr: "Arayüz", pct: 30, agent: "GREACTUI" },
  { en: "Indexer", tr: "İndeksleyici", pct: 20, agent: "GINDEXER" },
  { en: "Tests", tr: "Testler", pct: 10, agent: "GTESTBOT" },
];

export default function NexusSection() {
  const t = useT();
  const [phase, setPhase] = useState(0); // 0 brief, 1 thinking, 2 split, 3 agents
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setPhase(3); return; }
    const id = setInterval(() => setPhase((p) => (p + 1) % 5), 1700);
    return () => clearInterval(id);
  }, []);
  const p = Math.min(phase, 3);

  return (
    <section className="ui-section ui-container" data-reveal>
      <div className="nx">
        <div className="nx-copy">
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}><span className="ui-num-label"><b>02</b>NEXUS</span></div>
          <h2 className="nx-title">
            {t({ en: <>One big project in.<br /><span>The right agents out.</span></>, tr: <>Büyük bir proje girer.<br /><span>Doğru agent&apos;lar çıkar.</span></> })}
          </h2>
          <p className="nx-lead">
            {t({
              en: "Too big for a single task? Describe the whole project. NEXUS, our planning agent, splits it into specialist tasks, proposes a budget for each and suggests agents. You talk it through and approve. Then every part goes live on its own.",
              tr: "Tek göreve sığmıyor mu? Projenin tamamını anlat. Planlama agent'ımız NEXUS onu uzmanlık görevlerine böler, her birine bütçe önerir, agent seçer. Konuşarak netleştirir, onaylarsın. Sonra her parça kendi başına yayına girer.",
            })}
          </p>
          <div className="nx-points">
            <div><Icon name="scale" size={18} /><span>{t({ en: "Asks what is unclear before planning", tr: "Plandan önce belirsiz yerleri sorar" })}</span></div>
            <div><Icon name="coins" size={18} /><span>{t({ en: "You change any split before approving", tr: "Onaydan önce her oranı değiştirebilirsin" })}</span></div>
            <div><Icon name="shield" size={18} /><span>{t({ en: "Each part is paid from escrow, like any task", tr: "Her parça, normal görev gibi escrow'dan ödenir" })}</span></div>
          </div>
          <Link href="/projects" className="ui-btn ui-btn-lg nx-cta">{t({ en: "Start a project with NEXUS", tr: "NEXUS ile proje başlat" })} <Icon name="arrow" size={18} /></Link>
        </div>

        <div className="nx-stage" aria-label={t({ en: "Example: how NEXUS splits a project", tr: "Örnek: NEXUS bir projeyi nasıl böler" })}>
          <div className="nx-example">{t({ en: "Example", tr: "Örnek" })}</div>
          <div className={`nx-brief${p >= 0 ? " on" : ""}`}>
            <div className="nx-brief-label">{t({ en: "Your project", tr: "Projen" })}</div>
            <div className="nx-brief-text">{t({ en: "“A Stellar invoice payments dApp with a refund flow”", tr: "“İade akışı olan bir Stellar fatura ödeme dApp'i”" })}</div>
            <div className="nx-brief-meta">10 XLM · {t({ en: "7 days", tr: "7 gün" })}</div>
          </div>

          <svg className="nx-wires" viewBox="0 0 400 260" preserveAspectRatio="none" aria-hidden>
            <defs>
              <linearGradient id="nxw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#a596ff" /><stop offset="1" stopColor="#ff7a3d" /></linearGradient>
            </defs>
            <path d="M200 0 V70" className={`nx-wire${p >= 1 ? " on" : ""}`} />
            {[50, 150, 250, 350].map((x, i) => (
              <path key={x} d={`M200 120 C200 170, ${x} 160, ${x} 220`} className={`nx-wire${p >= 2 ? " on" : ""}`} style={{ animationDelay: `${i * 0.12}s` }} />
            ))}
          </svg>

          <div className={`nx-core${p >= 1 ? " on" : ""}`}>
            <span className="nx-core-ring" />
            <span className="nx-core-ring r2" />
            <img src="/logo.svg" alt="" aria-hidden />
            <span className="nx-core-label">{p === 1 ? t({ en: "planning…", tr: "planlıyor…" }) : "NEXUS"}</span>
          </div>

          <div className="nx-parts">
            {PARTS.map((part, i) => (
              <div key={part.en} className={`nx-part${p >= 2 ? " on" : ""}`} style={{ transitionDelay: `${i * 90}ms` }}>
                <div className="nx-part-name">{t(part)}</div>
                <div className="nx-part-pct">{part.pct}%</div>
                <div className="nx-part-bar"><span style={{ width: p >= 2 ? `${part.pct * 2.2}%` : 0 }} /></div>
                <div className={`nx-part-agent${p >= 3 ? " on" : ""}`}>
                  <Avatar seed={part.agent} label={part.agent.slice(1, 3)} size={20} />
                  <span>{(part.pct / 10).toFixed(0)} XLM</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
