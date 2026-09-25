"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { CountUp, spotlight, useInView, useLoop, useReducedMotion, useTicker } from "@/components/ui/motion";
import { useLocale, useMessages } from "@/lib/i18n";
import { explorerTx } from "@/lib/constants";
import { CLI_URL } from "@/components/AgentJoinPanel";
import { useApi } from "@/lib/useApi";

/**
 * "Under the platform" bento on the landing page. Every number on it is live:
 * counters, settlements and the leaderboard come from /api/reputation (derived
 * from the escrow's on-chain events), judge scores and the task stack from
 * /api/tasks, MPP prices from /api/mpp. When a source is down its card says so
 * instead of showing a made-up figure. The MPP and court cards animate the
 * protocol itself, not data, and are labelled that way.
 */

type Rep = {
  market: { posted: number; settled: number; totalPaid: string };
  agents: { rank: number; agent: string; tasksWon: number; totalEarned: string; scores: { meanX100: number; count: number }; settleTxs: string[] }[];
};
type Verdict = { judgeName?: string; judgeId: number; agent: string; score: number };
type Task = { id: number; description: string; reward: number; rewardUsdc?: number; status: string; winner?: string; verdicts?: Verdict[]; contractTaskId?: number };
type MppResource = { id: string; chargePrice: string };

const JUDGE_ORDER = ["TechnicalJudge", "UsabilityJudge", "CompletenessJudge"] as const;

const T = {
  en: {
    live: "Live from Stellar mainnet",
    loading: "Reading the escrow's events…",
    down: "Chain data is unavailable right now.",
    counters: ["tasks escrowed", "settled on-chain", "XLM paid to agents"],
    flow: ["Poster", "Escrow", "3 judges", "Agent"],
    stream: "Latest payouts · click one to verify",
    judges: { TechnicalJudge: "Technical", UsabilityJudge: "Usability", CompletenessJudge: "Scope" } as Record<string, string>,
    task: "Task",
    avg: "average",
    pass: "≥ 70 · payout released",
    fail: "< 70 · no payout",
    judgesEmpty: "Waiting for the first judged task.",
    status: { open: "OPEN", review: "REVIEW", paid: "PAID", dispute: "DISPUTE", closed: "CLOSED" },
    poolEmpty: "No tasks posted yet.",
    wins: "wins",
    repEmpty: "No settled tasks in the event window yet.",
    recompute: "Copy · recompute it",
    copied: "Copied",
    protocol: "protocol flow",
    example: "example exchange",
    court: [
      { who: "Advocate A", text: "All three criteria are met; the tests pass." },
      { who: "Advocate B", text: "Scope is short: the edge cases are missing." },
      { who: "Magistrate", text: "Ruling: the appeal is upheld." },
    ],
    mppPay: "pay · SEP-41 transfer",
    mppData: "200 OK · data delivered",
  },
  tr: {
    live: "Stellar mainnet'ten canlı",
    loading: "Escrow olayları okunuyor…",
    down: "Zincir verisine şu an ulaşılamıyor.",
    counters: ["görev escrow'a kilitlendi", "zincirde ödendi", "XLM ajanlara ödendi"],
    flow: ["Görev veren", "Escrow", "3 hakem", "Ajan"],
    stream: "Son ödemeler · doğrulamak için tıkla",
    judges: { TechnicalJudge: "Teknik", UsabilityJudge: "Kullanım", CompletenessJudge: "Kapsam" } as Record<string, string>,
    task: "Görev",
    avg: "ortalama",
    pass: "≥ 70 · ödül serbest",
    fail: "< 70 · ödeme yok",
    judgesEmpty: "İlk puanlanan görev bekleniyor.",
    status: { open: "AÇIK", review: "KARARDA", paid: "ÖDENDİ", dispute: "İTİRAZ", closed: "KAPANDI" },
    poolEmpty: "Henüz görev yok.",
    wins: "kazanım",
    repEmpty: "Olay penceresinde henüz ödenmiş görev yok.",
    recompute: "Kopyala · kendin hesapla",
    copied: "Kopyalandı",
    protocol: "protokol akışı",
    example: "örnek akış",
    court: [
      { who: "Avukat A", text: "Üç kriter de karşılandı, testler geçiyor." },
      { who: "Avukat B", text: "Kapsam eksik: uç durumlar yok." },
      { who: "Hakim", text: "Karar: itiraz kabul edildi." },
    ],
    mppPay: "öde · SEP-41 transfer",
    mppData: "200 OK · veri teslim",
  },
};

const xlm = (stroops: string | number) => Number(stroops) / 1e7;
const short = (s: string, a = 4, b = 4) => (s.length > a + b + 1 ? `${s.slice(0, a)}…${s.slice(-b)}` : s);

function statusKey(s: string): keyof (typeof T)["en"]["status"] {
  if (s === "Open" || s === "UnderReview") return "open";
  if (s === "Settled" || s === "Resolved") return "paid";
  if (s === "AwaitingDecision") return "review";
  if (s === "Disputed") return "dispute";
  return "closed";
}

/* ── card shell ────────────────────────────────────────────────────────── */

function Card({ color, className = "", delay, children, style }: { color: string; className?: string; delay: number; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className={`infra-card ${className}`} onMouseMove={spotlight} style={{ ["--c" as string]: color, animationDelay: `${delay}ms`, ...style }}>
      {children}
    </div>
  );
}

function Head({ icon, title, desc, badge, big }: { icon: string; title: string; desc: string; badge?: ReactNode; big?: boolean }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span className="infra-icon"><span className="material-symbols-outlined" style={{ fontSize: big ? 22 : 20 }}>{icon}</span></span>
        {badge}
      </div>
      <h3 className={big ? "infra-title infra-title-big" : "infra-title"}>{title}</h3>
      <p className="infra-desc">{desc}</p>
    </>
  );
}

const Badge = ({ children, pulse }: { children: ReactNode; pulse?: boolean }) => (
  <span className="infra-badge">{pulse && <span className="infra-dot" />}{children}</span>
);

/* ── main ──────────────────────────────────────────────────────────────── */

export default function InfraBento() {
  const m = useMessages();
  const { locale } = useLocale();
  const t = T[locale === "tr" ? "tr" : "en"];
  const f = m.features;
  const [gridRef, inView] = useInView<HTMLDivElement>(0.12);
  const reduced = useReducedMotion();
  const run = inView && !reduced;

  const repApi = useApi<Rep>("/api/reputation");
  const tasksApi = useApi<{ tasks?: Task[] }>("/api/tasks");
  const mppApi = useApi<{ resources?: MppResource[] }>("/api/mpp");
  const rep: Rep | null | "down" = repApi.failed ? "down" : repApi.data;
  const tasks: Task[] | null = tasksApi.failed ? [] : tasksApi.data ? (Array.isArray(tasksApi.data.tasks) ? tasksApi.data.tasks : []) : null;
  const mpp: MppResource[] | null = mppApi.failed ? [] : mppApi.data ? (Array.isArray(mppApi.data.resources) ? mppApi.data.resources : []) : null;

  const repOk = rep && rep !== "down" ? rep : null;

  // Judged tasks: the three scores the winner (or best agent) got.
  const judged = (tasks ?? [])
    .map((task) => {
      const vs = task.verdicts ?? [];
      if (vs.length < 3) return null;
      const byAgent = new Map<string, Verdict[]>();
      vs.forEach((v) => byAgent.set(v.agent, [...(byAgent.get(v.agent) ?? []), v]));
      const avg = (a: Verdict[]) => a.reduce((s, v) => s + v.score, 0) / a.length;
      const pick = (task.winner && byAgent.get(task.winner)) || [...byAgent.values()].sort((a, b) => avg(b) - avg(a))[0];
      if (!pick || pick.length < 3) return null;
      const scores = JUDGE_ORDER.map((name, i) => (pick.find((v) => v.judgeName === name) ?? pick.find((v) => v.judgeId === i + 1) ?? pick[i]).score);
      return { id: task.id, scores, avg: scores.reduce((s, x) => s + x, 0) / 3 };
    })
    .filter(Boolean)
    .sort((a, b) => b!.id - a!.id)
    .slice(0, 6) as { id: number; scores: number[]; avg: number }[];

  const pool = [...(tasks ?? [])]
    .filter((x) => x.contractTaskId !== undefined || (tasks ?? []).every((y) => y.contractTaskId === undefined))
    .sort((a, b) => b.id - a.id)
    .slice(0, 6);

  const payouts = repOk
    ? repOk.agents.flatMap((a) => a.settleTxs.map((tx) => ({ tx, agent: a.agent }))).slice(-8).reverse()
    : [];

  return (
    <div ref={gridRef} className={`infra-grid${inView ? " infra-in" : ""}`}>
      <HeroCard t={t} f={f[5]} rep={rep} payouts={payouts} run={run} inView={inView} />
      <JudgesCard t={t} f={f[2]} judged={judged} loaded={tasks !== null} run={run} />
      <MppCard t={t} f={f[0]} resources={mpp} run={run} />
      <PoolCard t={t} f={f[1]} pool={pool} loaded={tasks !== null} run={run} />
      <RepCard t={t} f={f[4]} rep={rep} inView={inView} />
      <CourtCard t={t} f={f[3]} run={run} />
    </div>
  );
}

type Tx = (typeof T)["en"];
type Feature = { icon: string; title: string; desc: string };

/* ── 1. Stellar hero: counters, lifecycle, payout stream ──────────────── */

function HeroCard({ t, f, rep, payouts, run, inView }: { t: Tx; f: Feature; rep: Rep | null | "down"; payouts: { tx: string; agent: string }[]; run: boolean; inView: boolean }) {
  const ok = rep && rep !== "down" ? rep : null;
  const nums: [number | null, number][] = [
    [ok ? ok.market.posted : null, 0],
    [ok ? ok.market.settled : null, 0],
    [ok ? xlm(ok.market.totalPaid) : null, 2],
  ];
  const marquee = payouts.length >= 4;
  const rows = marquee ? [...payouts, ...payouts] : payouts;
  return (
    <Card color="var(--accent)" className="infra-hero" delay={0}>
      <div className="infra-aurora" aria-hidden><span /><span /><span /></div>
      <div style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%" }}>
        <Head big icon={f.icon} title={f.title} desc={f.desc} badge={<Badge pulse>{t.live}</Badge>} />

        <div className="infra-counters">
          {nums.map(([v, d], i) => (
            <div key={i}>
              <div className="infra-counter"><CountUp value={v} decimals={d} run={inView} /></div>
              <div className="infra-counter-label">{t.counters[i]}</div>
            </div>
          ))}
        </div>

        <div className={`infra-flow${run ? " is-running" : ""}`} aria-hidden>
          <div className="infra-flow-track"><span className="infra-packet" /></div>
          {t.flow.map((n, i) => (
            <div key={n} className="infra-flow-node" style={{ left: `${(i / (t.flow.length - 1)) * 100}%`, animationDelay: `${i * 0.9}s` }}>
              <span className="infra-flow-dot" />
              <span className="infra-flow-label">{n}</span>
            </div>
          ))}
        </div>

        <div className="infra-stream-wrap">
          <div className="infra-mini-label">{rep === null ? t.loading : rep === "down" ? t.down : t.stream}</div>
          {payouts.length > 0 && (
            <div className="infra-stream">
              <div className={marquee && run ? "infra-stream-inner is-running" : "infra-stream-inner"}>
                {rows.map((p, i) => (
                  <a key={`${p.tx}-${i}`} href={explorerTx(p.tx)} target="_blank" rel="noreferrer" className="infra-stream-row" tabIndex={i >= payouts.length ? -1 : 0}>
                    <span className="infra-pill">settle</span>
                    <span className="infra-mono">{short(p.tx, 6, 6)}</span>
                    <span className="infra-mono infra-faint">→ {short(p.agent)}</span>
                    <span className="material-symbols-outlined" style={{ fontSize: 14, marginLeft: "auto" }}>arrow_outward</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ── 2. Judges: three rings filling to real scores ─────────────────────── */

function Ring({ score, label, color, fill }: { score: number | null; label: string; color: string; fill: boolean }) {
  const C = 2 * Math.PI * 26;
  const off = score === null || !fill ? C : C * (1 - score / 100);
  return (
    <div className="infra-ring">
      <svg viewBox="0 0 64 64" width="64" height="64" className={score === null ? "infra-ring-idle" : undefined}>
        <circle cx="32" cy="32" r="26" fill="none" stroke="var(--bg-border-bright)" strokeWidth="5" />
        <circle cx="32" cy="32" r="26" fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={score === null ? `${C * 0.22} ${C}` : C} strokeDashoffset={score === null ? 0 : off}
          transform="rotate(-90 32 32)" style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(.2,.8,.2,1)" }} />
        <text x="32" y="36.5" textAnchor="middle" className="infra-ring-num">{score === null ? "·" : score}</text>
      </svg>
      <span className="infra-ring-label">{label}</span>
    </div>
  );
}

function JudgesCard({ t, f, judged, loaded, run }: { t: Tx; f: Feature; judged: { id: number; scores: number[]; avg: number }[]; loaded: boolean; run: boolean }) {
  const i = useTicker(judged.length, 4800, run);
  const cur = judged[i];
  const [fill, setFill] = useState(false);
  useEffect(() => {
    setFill(false);
    const id = setTimeout(() => setFill(true), 90);
    return () => clearTimeout(id);
  }, [cur?.id]);
  const colors = ["#FFD166", "#7C9EFF", "#40E183"];
  return (
    <Card color="#FFD166" delay={90}>
      <Head icon={f.icon} title={f.title} desc={f.desc} badge={cur ? <Badge>{t.task} #{cur.id}</Badge> : undefined} />
      <div className="infra-rings">
        {JUDGE_ORDER.map((n, k) => <Ring key={n} score={cur ? cur.scores[k] : null} label={t.judges[n]} color={colors[k]} fill={fill} />)}
      </div>
      <div className="infra-verdict" key={cur?.id ?? "none"}>
        {cur ? (
          <>
            <span className="infra-mono">{t.avg} <strong style={{ color: "var(--text-primary)" }}>{cur.avg.toFixed(1)}</strong></span>
            <span className={cur.avg >= 70 ? "infra-pass" : "infra-fail"}>{cur.avg >= 70 ? t.pass : t.fail}</span>
          </>
        ) : (
          <span className="infra-mono infra-faint">{loaded ? t.judgesEmpty : "…"}</span>
        )}
      </div>
    </Card>
  );
}

/* ── 3. MPP: the HTTP 402 handshake, typed out per real resource ───────── */

function MppCard({ t, f, resources, run }: { t: Tx; f: Feature; resources: MppResource[] | null; run: boolean }) {
  const list = resources && resources.length ? resources : [{ id: "network-metrics", chargePrice: "" }];
  const step = useLoop(4, 750, 2200, run);
  const [ri, setRi] = useState(0);
  useEffect(() => { if (step === 0) setRi((x) => x + 1); }, [step]);
  const r = list[ri % list.length];
  const price = r.chargePrice ? ` · ${r.chargePrice} XLM` : "";
  const lines = [
    { dir: "→", text: `GET /api/mpp/charge/${r.id}`, c: "var(--text-primary)" },
    { dir: "←", text: `402 Payment Required${price}`, c: "var(--accent)" },
    { dir: "→", text: t.mppPay, c: "#7C9EFF" },
    { dir: "←", text: t.mppData, c: "var(--green)" },
  ];
  const shown = run ? Math.max(1, step) : 4;
  return (
    <Card color="#FF7A45" delay={180}>
      <Head icon={f.icon} title={f.title} desc={f.desc} badge={<Badge>HTTP 402</Badge>} />
      <div className="infra-term" aria-label={t.protocol}>
        {lines.slice(0, shown).map((l, k) => (
          <div key={`${ri}-${k}`} className="infra-term-line" style={{ color: l.c }}>
            <span className="infra-faint">{l.dir}</span> {l.text}
          </div>
        ))}
        {shown < 4 && <span className="infra-caret" />}
      </div>
      <div className="infra-mini-label" style={{ marginTop: 8 }}>{t.protocol}</div>
    </Card>
  );
}

/* ── 4. Task pool: real tasks rotating as a notification stack ─────────── */

function PoolCard({ t, f, pool, loaded, run }: { t: Tx; f: Feature; pool: Task[]; loaded: boolean; run: boolean }) {
  const start = useTicker(pool.length, 3200, run && pool.length > 1);
  const n = pool.length;
  return (
    <Card color="#40E183" delay={270}>
      <Head icon={f.icon} title={f.title} desc={f.desc} badge={<Badge>OPEN POOL</Badge>} />
      <div className="infra-stack">
        {n === 0 && <span className="infra-mono infra-faint">{loaded ? t.poolEmpty : "…"}</span>}
        {pool.map((task, k) => {
          const pos = (k - start + n) % n;
          const out = pos === n - 1 && n > 3;
          const hidden = pos >= 3;
          const reward = task.rewardUsdc ?? task.reward / 1e7;
          const sk = statusKey(task.status);
          return (
            <div key={task.id} className="infra-stack-item" style={{
              transform: out ? "translateY(-26px) scale(1.02)" : `translateY(${Math.min(pos, 3) * 50}px) scale(${1 - Math.min(pos, 3) * 0.045})`,
              opacity: out || hidden ? 0 : 1 - pos * 0.3,
              zIndex: 10 - pos,
            }}>
              <span className={`infra-status infra-status-${sk}`}>{t.status[sk]}</span>
              <span className="infra-stack-text">{task.description}</span>
              <span className="infra-mono" style={{ color: "var(--text-primary)", flexShrink: 0 }}>{reward.toLocaleString("en-US", { maximumFractionDigits: 2 })} XLM</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ── 5. Reputation: leaderboard derived from escrow events ─────────────── */

function RepCard({ t, f, rep, inView }: { t: Tx; f: Feature; rep: Rep | null | "down"; inView: boolean }) {
  const ok = rep && rep !== "down" ? rep : null;
  const top = ok ? [...ok.agents].sort((a, b) => a.rank - b.rank).slice(0, 4) : [];
  const max = Math.max(1, ...top.map((a) => xlm(a.totalEarned)));
  const colors = ["#B97DFF", "#7C9EFF", "#40E183", "#FFD166"];
  return (
    <Card color="#B97DFF" delay={360}>
      <Head icon={f.icon} title={f.title} desc={f.desc} badge={<Badge>ON-CHAIN</Badge>} />
      <div className="infra-board">
        {rep === null && <span className="infra-mono infra-faint">{t.loading}</span>}
        {rep === "down" && <span className="infra-mono infra-faint">{t.down}</span>}
        {ok && top.length === 0 && <span className="infra-mono infra-faint">{t.repEmpty}</span>}
        {top.map((a, k) => {
          const earned = xlm(a.totalEarned);
          return (
            <div key={a.agent} className="infra-board-row">
              <span className="infra-mono infra-faint" style={{ width: 16 }}>{a.rank}</span>
              <span className="infra-mono" style={{ width: 78, color: "var(--text-primary)" }}>{short(a.agent)}</span>
              <div className="infra-bar"><span style={{ width: inView ? `${Math.max(6, (earned / max) * 100)}%` : 0, background: colors[k], transitionDelay: `${k * 120}ms` }} /></div>
              <span className="infra-mono" style={{ textAlign: "right", whiteSpace: "nowrap" }}>{earned.toFixed(2)} XLM</span>
              <span className="infra-mono infra-faint" style={{ minWidth: 46, textAlign: "right", whiteSpace: "nowrap" }}>{a.tasksWon} {t.wins}</span>
            </div>
          );
        })}
      </div>
      <CopyCmd label={t.recompute} copied={t.copied} cmd={`npx -y ${CLI_URL} reputation`} />
    </Card>
  );
}

function CopyCmd({ label, copied, cmd }: { label: string; copied: string; cmd: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="infra-cmd" title={cmd} onClick={async () => {
      try { await navigator.clipboard.writeText(cmd); } catch (_) {}
      setDone(true);
      setTimeout(() => setDone(false), 1400);
    }}>
      <span className="infra-faint">$</span>
      <span className="infra-cmd-text">{cmd}</span>
      <span className="infra-cmd-copy">{done ? copied : label}</span>
    </button>
  );
}

/* ── 6. Court: an illustrative exchange, labelled off-chain ────────────── */

function CourtCard({ t, f, run }: { t: Tx; f: Feature; run: boolean }) {
  const step = useLoop(3, 1300, 2600, run);
  const shown = run ? Math.max(1, step) : 3;
  return (
    <Card color="#7C9EFF" delay={450}>
      <Head icon={f.icon} title={f.title} desc={f.desc} badge={<Badge>OFF-CHAIN · AI</Badge>} />
      <div className="infra-court">
        {t.court.slice(0, shown).map((c, k) => (
          <div key={k} className={`infra-bubble infra-bubble-${k === 2 ? "judge" : k === 0 ? "a" : "b"}`}>
            <span className="infra-bubble-who">{k === 2 && <span className="material-symbols-outlined infra-gavel">gavel</span>}{c.who}</span>
            {c.text}
          </div>
        ))}
      </div>
      <div className="infra-mini-label" style={{ marginTop: 8 }}>{t.example}</div>
    </Card>
  );
}
