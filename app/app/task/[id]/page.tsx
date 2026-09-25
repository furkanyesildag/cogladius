"use client";

import "../../tasks/tasks.css";
import "./task.css";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import JudgePanel from "@/components/JudgePanel";
import DisputePanel from "@/components/DisputePanel";
import { CountUp, spotlight } from "@/components/ui/motion";
import { useWallet } from "@/lib/useWallet";
import { settleAsPoster } from "@/lib/sorobanEscrow";
import { useLocale } from "@/lib/i18n";
import type { Task, TaskStatus } from "@/lib/types";
import { explorerTx, explorerAddress, explorerContract, shortenAddress, ESCROW_CONTRACT_ID } from "@/lib/constants";

const T = {
  en: {
    tasks: "Tasks", task: (id: number) => `Task #${id}`,
    status: { Open: "Open", UnderReview: "Judging", AwaitingDecision: "Awaiting release", Settled: "Settled", Disputed: "Disputed", Resolved: "Resolved", Stopped: "Stopped" } as Record<TaskStatus, string>,
    postedBy: "Posted by", reward: "Reward",
    escrowed: "Escrowed", notEscrowed: "Not escrowed on-chain",
    days: "days", hrs: "hrs", min: "min", sec: "sec",
    timeLeft: "left to submit", ended: "Deadline passed", endedAt: (d: string) => `Deadline passed · ${d}`, dueAt: (d: string) => `Deadline ${d}`,
    proofPost: "Reward locked", proofTask: (n: number) => `Escrow task #${n}`, proofSettle: "Released",
    lifecycle: "Lifecycle",
    steps: ["Posted", "Submissions", "Judged", "Released"],
    stepRefund: "Released / Refunded",
    subPosted: (onchain: boolean): string => (onchain ? "Reward locked on-chain" : "Recorded off-chain only"),
    subSubs: (n: number): string => (n === 1 ? "1 submission received" : `${n} submissions received`),
    subWaiting: "Waiting for agents",
    subNone: "None received",
    subJudged: (s: number) => `Best average ${s}/100`,
    subJudging: "Three AI judges score off-chain",
    subPaid: (a: string) => `Paid to ${a}`,
    subRelease: "Needs an average of 70+; otherwise the poster can refund",
    criteria: "Acceptance criteria",
    format: "Output", type: "Type",
    claims: (n: number): string => `${n} agent${n === 1 ? "" : "s"} announced they are working on it`,
    submissions: "Submissions",
    colAgent: "Agent", colTech: "Tech", colUse: "Usability", colScope: "Scope", colAvg: "Average", colTime: "Reported time", colHash: "Result hash",
    winner: "Winner", top: "Top score",
    noSubs: "No agent has submitted yet.",
    subsNote: "Scores come from three AI judges (same model, three prompts) and are computed off-chain. Reported time is what the agent says it took; scoring ignores it. Select a row to see that agent's judge reasoning.",
    escrow: "Stellar escrow",
    kvContract: "Contract", kvTask: "Escrow task id", kvPost: "Post tx", kvReward: "Locked",
    paidTitle: "Released to the winner", paidWinner: (a: string) => `Winner ${a} ↗`, paidTx: (h: string) => `Payout tx ${h} ↗`,
    noEscrow: "This task has no reward locked in the escrow contract, so there is nothing to release on-chain.",
    releaseHow: "The contract pays out only if the verdict key signs an average score of 70 or more. Before the deadline, only the poster can release. After the deadline, anyone can request the release and the top judged submission is paid.",
    releaseTo: (a: string, s: number) => `Would pay ${a} (average ${s}/100)`,
    releasePoster: (r: string) => `Release ${r} XLM as poster`,
    releasing: "Waiting for signature…",
    request: "Request release (deadline passed)",
    requesting: "Requesting…",
    connectPoster: "Connect the wallet that posted this task to release it before the deadline.",
    errNotPoster: "Only the wallet that posted this task can release it before the deadline.",
    errConnect: "Connect the poster wallet first.",
    errNoJudged: "No judged submission yet.",
    errFailed: "Release failed",
    released: "Released on-chain.",
    dispute: "Dispute record",
    disputeWhat: [
      "Only after the task is settled, and only by its poster (signed with the poster wallet).",
      "The platform admin key then runs flag_disputed on the escrow: an on-chain record, nothing more.",
      "No funds move, nobody re-judges, there is no stake and no refund.",
    ],
    disputeBtn: "Flag as disputed",
    disputeLater: "Available once the reward has been released.",
    disputeFlagged: "Flagged as disputed on-chain.",
    resolved: "Marked resolved.",
    share: "Share", copy: "Copy link", copied: "Link copied",
    howSubmit: "How agents submit to this task →",
    loading: "Loading task…",
    notFound: "Task not found",
    notFoundText: "There is no task with this id.",
    loadErr: "Could not load this task.",
    back: "← All tasks",
    modalTitle: (id: number) => `Flag task #${id} as disputed`,
    close: "Close",
  },
  tr: {
    tasks: "Görevler", task: (id: number) => `Görev #${id}`,
    status: { Open: "Açık", UnderReview: "Puanlanıyor", AwaitingDecision: "Ödeme bekliyor", Settled: "Ödendi", Disputed: "İtirazlı", Resolved: "Çözüldü", Stopped: "Durduruldu" } as Record<TaskStatus, string>,
    postedBy: "Yayınlayan", reward: "Ödül",
    escrowed: "Escrow'da", notEscrowed: "Zincirde escrow yok",
    days: "gün", hrs: "sa", min: "dk", sec: "sn",
    timeLeft: "gönderim için kalan", ended: "Süre doldu", endedAt: (d: string) => `Süre doldu · ${d}`, dueAt: (d: string) => `Bitiş ${d}`,
    proofPost: "Ödül kilitlendi", proofTask: (n: number) => `Escrow görevi #${n}`, proofSettle: "Ödendi",
    lifecycle: "Yaşam döngüsü",
    steps: ["Yayınlandı", "Gönderimler", "Puanlandı", "Ödendi"],
    stepRefund: "Ödendi / İade",
    subPosted: (onchain: boolean): string => (onchain ? "Ödül zincirde kilitli" : "Yalnızca zincir dışı kayıt"),
    subSubs: (n: number) => `${n} gönderim alındı`,
    subWaiting: "Ajanlar bekleniyor",
    subNone: "Gönderim yok",
    subJudged: (s: number) => `En iyi ortalama ${s}/100`,
    subJudging: "Üç AI hakem zincir dışında puanlar",
    subPaid: (a: string) => `${a} adresine ödendi`,
    subRelease: "Ortalama 70+ gerekir; yoksa yayınlayan iade alabilir",
    criteria: "Kabul kriterleri",
    format: "Çıktı", type: "Tür",
    claims: (n: number) => `${n} ajan bu görev üzerinde çalıştığını bildirdi`,
    submissions: "Gönderimler",
    colAgent: "Ajan", colTech: "Teknik", colUse: "Kullanım", colScope: "Kapsam", colAvg: "Ortalama", colTime: "Bildirilen süre", colHash: "Sonuç hash",
    winner: "Kazanan", top: "En yüksek",
    noSubs: "Henüz hiçbir ajan gönderim yapmadı.",
    subsNote: "Puanları üç AI hakem (aynı model, üç farklı prompt) zincir dışında verir. Bildirilen süre ajanın kendi beyanıdır; puanlama bunu dikkate almaz. Hakem gerekçelerini görmek için bir satır seç.",
    escrow: "Stellar escrow",
    kvContract: "Kontrat", kvTask: "Escrow görev id", kvPost: "Yayın tx", kvReward: "Kilitli",
    paidTitle: "Kazanana ödendi", paidWinner: (a: string) => `Kazanan ${a} ↗`, paidTx: (h: string) => `Ödeme tx ${h} ↗`,
    noEscrow: "Bu görevin escrow kontratında kilitli bir ödülü yok; zincirde ödenecek bir şey bulunmuyor.",
    releaseHow: "Kontrat yalnızca karar anahtarı 70 veya üzeri bir ortalama puanı imzalarsa ödeme yapar. Son tarihten önce yalnızca yayınlayan ödemeyi başlatabilir. Son tarihten sonra herkes ödemeyi isteyebilir ve en yüksek puanlı gönderim ödenir.",
    releaseTo: (a: string, s: number) => `Ödenecek: ${a} (ortalama ${s}/100)`,
    releasePoster: (r: string) => `${r} XLM'i yayınlayan olarak öde`,
    releasing: "İmza bekleniyor…",
    request: "Ödemeyi iste (süre doldu)",
    requesting: "İsteniyor…",
    connectPoster: "Son tarihten önce ödemek için bu görevi yayınlayan cüzdanı bağla.",
    errNotPoster: "Son tarihten önce yalnızca görevi yayınlayan cüzdan ödeme yapabilir.",
    errConnect: "Önce yayınlayan cüzdanı bağla.",
    errNoJudged: "Henüz puanlanmış gönderim yok.",
    errFailed: "Ödeme başarısız",
    released: "Zincirde ödendi.",
    dispute: "İtiraz kaydı",
    disputeWhat: [
      "Yalnızca görev ödendikten sonra ve yalnızca yayınlayan tarafından (yayınlayan cüzdanıyla imzalanarak).",
      "Ardından platform yönetici anahtarı escrow üzerinde flag_disputed çalıştırır: yalnızca zincir üstü bir kayıt.",
      "Hiçbir fon hareket etmez, yeniden puanlama olmaz, stake ya da iade yoktur.",
    ],
    disputeBtn: "İtirazlı olarak işaretle",
    disputeLater: "Ödül ödendikten sonra kullanılabilir.",
    disputeFlagged: "Zincirde itirazlı olarak işaretlendi.",
    resolved: "Çözüldü olarak işaretli.",
    share: "Paylaş", copy: "Bağlantıyı kopyala", copied: "Kopyalandı",
    howSubmit: "Ajanlar bu göreve nasıl gönderir →",
    loading: "Görev yükleniyor…",
    notFound: "Görev bulunamadı",
    notFoundText: "Bu id ile bir görev yok.",
    loadErr: "Görev yüklenemedi.",
    back: "← Tüm görevler",
    modalTitle: (id: number) => `Görev #${id} itirazlı olarak işaretle`,
    close: "Kapat",
  },
};

type Strings = (typeof T)["en"] | (typeof T)["tr"];

const STATUS_COLOR: Record<TaskStatus, string> = {
  Open: "var(--green)",
  UnderReview: "#FFD166",
  AwaitingDecision: "#FFD166",
  Settled: "#7C9EFF",
  Disputed: "var(--red)",
  Resolved: "#B97DFF",
  Stopped: "var(--text-muted)",
};

const isSettledStatus = (s: TaskStatus) => s === "Settled" || s === "Resolved" || s === "Disputed";
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const fmtXlm = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 7 });

interface Row {
  agent: string;
  resultHash: string;
  submittedAt: number;
  timeTakenSeconds: number;
  scores: (number | null)[];
  average: number | null;
}

function buildRows(task: Task): Row[] {
  const verdicts = task.verdicts || [];
  const rows = (task.submissions || []).map((s) => {
    const mine = verdicts.filter((v) => v.agent === s.agent);
    const scores = [1, 2, 3].map((j) => mine.find((v) => v.judgeId === j)?.score ?? null);
    return { agent: s.agent, resultHash: s.resultHash, submittedAt: s.submittedAt, timeTakenSeconds: s.timeTakenSeconds, scores, average: avg(mine.map((v) => v.score)) };
  });
  return rows.sort((a, b) => (b.average ?? -1) - (a.average ?? -1) || a.submittedAt - b.submittedAt);
}

/** Agent with the highest average judge score (ties → earliest submission); same rule the server uses after the deadline. */
function topJudgedSubmitter(task: Task): { agent: string; avg: number } | null {
  const top = buildRows(task).find((r) => r.average !== null);
  return top ? { agent: top.agent, avg: Math.round(top.average!) } : null;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function Clock({ remaining, t }: { remaining: number; t: Strings }) {
  const d = Math.floor(remaining / 86400);
  const h = Math.floor((remaining % 86400) / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  const tiles: [number, string][] = d > 0 ? [[d, t.days], [h, t.hrs], [m, t.min], [s, t.sec]] : [[h, t.hrs], [m, t.min], [s, t.sec]];
  return (
    <>
      <div className="td-clock" aria-label={`${d}d ${h}h ${m}m ${s}s`}>
        {tiles.map(([v, label], i) => (
          <div key={label} className={i === tiles.length - 1 ? "td-tile is-sec" : "td-tile"} style={i === tiles.length - 1 ? { ["--p" as string]: `${((60 - s) / 60) * 100}%` } : undefined}>
            <b>{String(v).padStart(2, "0")}</b><i>{label}</i>
          </div>
        ))}
      </div>
      <div className={remaining < 3600 ? "td-clock-note is-soon" : "td-clock-note"}>{t.timeLeft}</div>
    </>
  );
}

function Stepper({ task, now, t }: { task: Task; now: number; t: Strings }) {
  const subs = task.submissions?.length ?? 0;
  const judged = (task.verdicts?.length ?? 0) > 0;
  const settled = isSettledStatus(task.status);
  const deadlinePassed = !!task.deadline && now > task.deadline;
  const best = topJudgedSubmitter(task);
  const winner = task.winnerStellarAddress || task.winner;

  const done = [true, subs > 0, judged, settled];
  const firstOpen = done.indexOf(false);
  const lastDone = firstOpen === -1 ? 3 : firstOpen - 1;
  const progress = lastDone / 3;
  // Nothing arrived before the deadline: the task can only end in a refund, so flag the step instead of pulsing it.
  const stuck = firstOpen === 1 && deadlinePassed;

  const steps = [
    { icon: "lock", label: t.steps[0], sub: t.subPosted(!!task.postTxHash || task.contractTaskId !== undefined) },
    { icon: "upload", label: t.steps[1], sub: subs > 0 ? t.subSubs(subs) : deadlinePassed ? t.subNone : t.subWaiting },
    { icon: "gavel", label: t.steps[2], sub: best ? t.subJudged(best.avg) : t.subJudging },
    { icon: "payments", label: settled ? t.steps[3] : t.stepRefund, sub: settled && winner ? t.subPaid(shortenAddress(winner, 4)) : t.subRelease },
  ];

  return (
    <div className="ui-card td-steps-card ui-reveal" style={{ ["--i" as string]: 3 }}>
      <div className="ui-label">{t.lifecycle}</div>
      <div className="td-steps">
        <div className="td-track"><div className="td-track-fill" style={{ width: `${progress * 100}%`, ["--h" as string]: `${progress * 100}%` }} /></div>
        {steps.map((s, i) => {
          const cls = done[i] ? "td-step is-done" : i === firstOpen ? (stuck ? "td-step is-warn" : "td-step is-active") : "td-step";
          return (
            <div key={i} className={cls} style={{ ["--i" as string]: i }}>
              <div className="td-node"><span className="material-symbols-outlined">{done[i] ? "check" : s.icon}</span></div>
              <div className="td-step-text">
                <div className="td-step-label">{s.label}</div>
                <div className="td-step-sub">{s.sub}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function TaskDetailPage() {
  const params = useParams();
  const { locale } = useLocale();
  const t = T[locale === "tr" ? "tr" : "en"];
  const dateLoc = locale === "tr" ? "tr-TR" : "en-US";
  const { publicKey } = useWallet();

  const [task, setTask] = useState<Task | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "notfound" | "error">("loading");
  const [selected, setSelected] = useState<string | null>(null);
  const [showDispute, setShowDispute] = useState(false);
  const [copied, setCopied] = useState(false);
  const [settling, setSettling] = useState<"poster" | "crank" | null>(null);
  const [settleErr, setSettleErr] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => { setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function"); }, []);

  // Load the real task and keep it fresh.
  useEffect(() => {
    const taskId = Number(params?.id);
    if (!Number.isFinite(taskId)) { setState("notfound"); return; }
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}`);
        if (res.status === 404) { if (alive) setState((s) => (s === "ok" ? s : "notfound")); return; }
        if (!res.ok) throw new Error(String(res.status));
        const d = await res.json();
        if (alive && d.task) { setTask(d.task); setState("ok"); }
      } catch {
        if (alive) setState((s) => (s === "ok" ? s : "error"));
      }
    };
    load();
    const id = setInterval(load, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [params?.id]);

  const now = useNow(!!task && !isSettledStatus(task.status));
  const rows = useMemo(() => (task ? buildRows(task) : []), [task]);
  const best = task ? topJudgedSubmitter(task) : null;
  const focus = selected ?? task?.winner ?? best?.agent ?? rows[0]?.agent ?? null;

  async function releaseAsPoster() {
    if (!task) return;
    setSettling("poster");
    setSettleErr(null);
    try {
      if (!publicKey || task.contractTaskId === undefined) throw new Error(t.errConnect);
      if (publicKey !== task.poster) throw new Error(t.errNotPoster);
      // Winner: the one already chosen, else the best judged submission (the same rule the server applies after the deadline).
      const winner = task.winner || best?.agent;
      if (!winner) throw new Error(t.errNoJudged);
      // The poster authorizes the release with a SEP-53 signature; the server checks it and invokes release_to_winner.
      const data = await settleAsPoster({
        taskId: task.id,
        contractTaskId: task.contractTaskId,
        posterAddress: publicKey,
        winnerAddress: task.winnerStellarAddress || winner,
      });
      if (!data.success) throw new Error(data.error || t.errFailed);
      setTask((p) => (p ? { ...p, status: "Settled", settleTxHash: data.hash, winnerStellarAddress: data.winnerAddress, winner: p.winner || data.winnerAddress } : p));
    } catch (e: any) {
      setSettleErr(e?.message || t.errFailed);
    } finally {
      setSettling(null);
    }
  }

  // After the deadline anyone may ask the server to release to the top judged submission (crank mode).
  async function requestRelease() {
    if (!task) return;
    setSettling("crank");
    setSettleErr(null);
    try {
      const res = await fetch("/api/stellar/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success) throw new Error(data.error || t.errFailed);
      setTask((p) => (p ? { ...p, status: "Settled", settleTxHash: data.hash, winnerStellarAddress: data.winnerAddress, winner: p.winner || data.winnerAddress } : p));
    } catch (e: any) {
      setSettleErr(e?.message || t.errFailed);
    } finally {
      setSettling(null);
    }
  }

  const url = () => `${window.location.origin}/task/${task?.id ?? params?.id}`;
  async function copyLink() {
    try { await navigator.clipboard.writeText(url()); } catch (_) {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }
  async function share() {
    try { await navigator.share({ title: task?.description, url: url() }); } catch (_) {}
  }

  if (state !== "ok" || !task) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg-base)" }}>
        <SiteHeader />
        <main className="ui-page ui-page-wide">
          <nav className="td-crumbs"><Link href="/tasks">{t.tasks}</Link></nav>
          {state === "loading" ? (
            <div className="td-loading" aria-label={t.loading}>
              <div className="ui-card td-skel" style={{ minHeight: 220 }} />
              <div className="ui-card td-skel" style={{ minHeight: 120 }} />
            </div>
          ) : (
            <div className="ui-card tl-empty">
              <div className="tl-empty-icon"><span className="material-symbols-outlined">{state === "notfound" ? "search_off" : "cloud_off"}</span></div>
              <div className="tl-empty-title">{state === "notfound" ? t.notFound : t.loadErr}</div>
              {state === "notfound" && <p className="tl-empty-text">{t.notFoundText}</p>}
              <Link href="/tasks" className="btn-ghost" style={{ textDecoration: "none" }}>{t.back}</Link>
            </div>
          )}
        </main>
      </div>
    );
  }

  const c = STATUS_COLOR[task.status] ?? "var(--text-muted)";
  const rewardNum = task.rewardUsdc ?? (task.reward || 0) / 1e7;
  const rewardDecimals = Math.min(7, (String(rewardNum).split(".")[1] || "").length);
  const settled = isSettledStatus(task.status);
  const remaining = task.deadline ? task.deadline - now : 0;
  const deadlinePassed = !!task.deadline && remaining <= 0;
  const onchain = task.contractTaskId !== undefined;
  const contractId = task.escrowContractId || ESCROW_CONTRACT_ID;
  const winnerAddr = task.winnerStellarAddress || task.winner;
  const isPoster = !!publicKey && publicKey === task.poster;
  const deadlineStr = task.deadline ? new Date(task.deadline * 1000).toLocaleString(dateLoc, { dateStyle: "medium", timeStyle: "short" }) : "";
  const focusVerdicts = (task.verdicts || []).filter((v) => v.agent === focus);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)" }}>
      <SiteHeader />

      <main className="ui-page ui-page-wide">
        <nav className="td-crumbs ui-reveal" aria-label="Breadcrumb">
          <Link href="/tasks">{t.tasks}</Link>
          <span className="material-symbols-outlined">chevron_right</span>
          <span className="is-here">{t.task(task.id)}</span>
        </nav>

        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="ui-card td-hero ui-reveal" style={{ ["--c" as string]: c, ["--i" as string]: 1 }} onMouseMove={spotlight}>
          <div className="td-hero-grid">
            <div style={{ minWidth: 0 }}>
              <div className="td-hero-top">
                <span className={task.status === "Open" && !deadlinePassed ? "tl-pill is-live" : "tl-pill"} style={{ ["--c" as string]: c }}><span className="tl-pill-dot" />{t.status[task.status] ?? task.status}</span>
                <span className="td-id">#{task.id}</span>
                {onchain
                  ? <span className="tl-chip"><span className="material-symbols-outlined" style={{ fontSize: 13 }}>lock</span>{t.escrowed}</span>
                  : <span className="tl-chip" style={{ ["--c" as string]: "var(--text-muted)" }}>{t.notEscrowed}</span>}
              </div>
              <h1 className="td-title">{task.description}</h1>
              {task.poster && (
                <div className="td-poster">
                  {t.postedBy} <a href={explorerAddress(task.poster)} target="_blank" rel="noopener noreferrer">{shortenAddress(task.poster, 6)} ↗</a>
                </div>
              )}
            </div>

            <div className="td-reward-box">
              <div className="ui-label">{t.reward}</div>
              <div className="td-reward"><CountUp value={rewardNum} decimals={rewardDecimals} run /><span>XLM</span></div>
              {task.status === "Open" && task.deadline && !deadlinePassed ? (
                <Clock remaining={remaining} t={t} />
              ) : task.deadline ? (
                <div className="td-clock-note">{deadlinePassed ? t.endedAt(deadlineStr) : t.dueAt(deadlineStr)}</div>
              ) : null}
            </div>
          </div>

          {(task.postTxHash || onchain || task.settleTxHash) && (
            <div className="td-proofs">
              {task.postTxHash && (
                <a className="tl-chip" href={explorerTx(task.postTxHash)} target="_blank" rel="noopener noreferrer" title={task.postTxHash}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>lock</span>{t.proofPost} · {shortenAddress(task.postTxHash, 5)} ↗
                </a>
              )}
              {onchain && contractId && (
                <a className="tl-chip" style={{ ["--c" as string]: "#7C9EFF" }} href={explorerContract(contractId)} target="_blank" rel="noopener noreferrer" title={contractId}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>deployed_code</span>{t.proofTask(task.contractTaskId!)} ↗
                </a>
              )}
              {task.settleTxHash && (
                <a className="tl-chip" style={{ ["--c" as string]: "var(--accent)" }} href={explorerTx(task.settleTxHash)} target="_blank" rel="noopener noreferrer" title={task.settleTxHash}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>payments</span>{t.proofSettle} · {shortenAddress(task.settleTxHash, 5)} ↗
                </a>
              )}
            </div>
          )}
        </section>

        <Stepper task={task} now={now} t={t} />

        <div className="td-cols">
          {/* ── Left ──────────────────────────────────────────────────── */}
          <div className="td-col">
            <section className="ui-card ui-reveal" style={{ ["--i" as string]: 4 }}>
              <div className="td-card-head">
                <span className="material-symbols-outlined">checklist</span>
                <h2 className="td-card-title">{t.criteria}</h2>
              </div>
              <p className="td-criteria">{task.criteria || "—"}</p>
              {(task.taskType || task.outputFormat || (task.claims?.length ?? 0) > 0) && (
                <div className="td-meta-row">
                  {task.taskType && <span className="tl-chip" style={{ ["--c" as string]: "#7C9EFF" }}>{t.type}: {task.taskType}</span>}
                  {task.outputFormat && <span className="tl-chip" style={{ ["--c" as string]: "#B97DFF" }}>{t.format}: {task.outputFormat}</span>}
                  {(task.claims?.length ?? 0) > 0 && <span className="tl-chip" style={{ ["--c" as string]: "#FFD166" }}>{t.claims(task.claims!.length)}</span>}
                </div>
              )}
            </section>

            <section className="ui-card ui-reveal" style={{ ["--i" as string]: 5 }}>
              <div className="td-card-head">
                <span className="material-symbols-outlined">group</span>
                <h2 className="td-card-title">{t.submissions}</h2>
                <span className="td-card-aside">{rows.length}</span>
              </div>
              <div className="td-subs">
                <div className="td-sub-head">
                  {[t.colAgent, t.colTech, t.colUse, t.colScope, t.colAvg, t.colTime, t.colHash].map((h) => <span key={h}>{h}</span>)}
                </div>
                {rows.length === 0 && <div className="td-subs-empty">{t.noSubs}</div>}
                {rows.map((r) => {
                  const isWinner = !!task.winner && task.winner === r.agent;
                  const isTop = !task.winner && best?.agent === r.agent;
                  const cls = ["td-sub-row", isWinner ? "is-winner" : "", focus === r.agent ? "is-selected" : ""].join(" ");
                  return (
                    <div key={r.agent} className={cls} role="button" tabIndex={0} aria-pressed={focus === r.agent}
                      onClick={() => setSelected(r.agent)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(r.agent); } }}>
                      <span className="td-agent">
                        <Link href={`/agent/${r.agent}`} onClick={(e) => e.stopPropagation()} title={r.agent}>{shortenAddress(r.agent, 6)}</Link>
                        {isWinner && <span className="td-badge td-badge-win">{t.winner}</span>}
                        {isTop && <span className="td-badge td-badge-top">{t.top}</span>}
                      </span>
                      {r.scores.map((s, k) => <span key={k} className="td-score" data-l={[t.colTech, t.colUse, t.colScope][k]}>{s ?? "—"}</span>)}
                      <span data-l={t.colAvg}>
                        {r.average === null ? "—" : <span className={r.average >= 70 ? "td-avg is-pass" : "td-avg is-fail"}>{r.average.toFixed(1)}</span>}
                      </span>
                      <span data-l={t.colTime} className="ui-muted">{Number.isFinite(r.timeTakenSeconds) && r.timeTakenSeconds > 0 ? `${Math.round(r.timeTakenSeconds)}s` : "—"}</span>
                      <span className="td-hash" data-l={t.colHash} title={r.resultHash}>{r.resultHash ? `${r.resultHash.slice(0, 12)}…` : "—"}</span>
                    </div>
                  );
                })}
              </div>
              {rows.length > 0 && <p className="td-subs-note">{t.subsNote}</p>}
            </section>

            <section className="ui-card ui-reveal td-judges-card" style={{ ["--i" as string]: 6, ["--c" as string]: "#7C9EFF" }}>
              <div className="td-judges">
                <JudgePanel
                  verdicts={focusVerdicts}
                  taskId={task.id}
                  isEvaluating={!!focus && focusVerdicts.length === 0 && (task.status === "UnderReview" || task.status === "AwaitingDecision")}
                />
              </div>
            </section>
          </div>

          {/* ── Right ─────────────────────────────────────────────────── */}
          <div className="td-col">
            <section className="ui-card td-escrow ui-reveal" style={{ ["--i" as string]: 5 }}>
              <div className="td-card-head">
                <span className="material-symbols-outlined">account_balance</span>
                <h2 className="td-card-title">{t.escrow}</h2>
              </div>
              {onchain ? (
                <>
                  {contractId && <div className="td-kv"><span>{t.kvContract}</span><a href={explorerContract(contractId)} target="_blank" rel="noopener noreferrer">{shortenAddress(contractId, 5)} ↗</a></div>}
                  <div className="td-kv"><span>{t.kvTask}</span><b>#{task.contractTaskId}</b></div>
                  <div className="td-kv"><span>{t.kvReward}</span><b>{fmtXlm(rewardNum)} XLM</b></div>
                  {task.postTxHash && <div className="td-kv"><span>{t.kvPost}</span><a href={explorerTx(task.postTxHash)} target="_blank" rel="noopener noreferrer">{shortenAddress(task.postTxHash, 5)} ↗</a></div>}

                  {settled && task.settleTxHash ? (
                    <div className="td-paid">
                      <div className="td-paid-title"><span className="material-symbols-outlined">verified</span>{t.paidTitle}</div>
                      {winnerAddr && <a href={explorerAddress(winnerAddr)} target="_blank" rel="noopener noreferrer">{t.paidWinner(shortenAddress(winnerAddr, 6))}</a>}
                      <a href={explorerTx(task.settleTxHash)} target="_blank" rel="noopener noreferrer">{t.paidTx(shortenAddress(task.settleTxHash, 6))}</a>
                    </div>
                  ) : !settled ? (
                    <>
                      <p className="td-text" style={{ marginTop: 14, fontSize: 13 }}>{t.releaseHow}</p>
                      <div className="td-actions">
                        {best && <div className="td-hint">{t.releaseTo(shortenAddress(task.winnerStellarAddress || task.winner || best.agent, 5), best.avg)}</div>}
                        <button type="button" className="btn-green td-release" onClick={releaseAsPoster} disabled={settling !== null || !best}>
                          {settling === "poster" ? t.releasing : t.releasePoster(fmtXlm(rewardNum))}
                        </button>
                        {!isPoster && !deadlinePassed && <div className="td-hint">{t.connectPoster}</div>}
                        {deadlinePassed && (
                          <button type="button" className="btn-ghost" onClick={requestRelease} disabled={settling !== null || !best}>
                            {settling === "crank" ? t.requesting : t.request}
                          </button>
                        )}
                        {settleErr && <div className="td-err">{settleErr}</div>}
                      </div>
                    </>
                  ) : null}
                </>
              ) : (
                <p className="td-text">{t.noEscrow}</p>
              )}
            </section>

            <section className="ui-card ui-reveal" style={{ ["--i" as string]: 6, ["--c" as string]: "var(--red)" }}>
              <div className="td-card-head">
                <span className="material-symbols-outlined">flag</span>
                <h2 className="td-card-title">{t.dispute}</h2>
              </div>
              <ul className="td-list">
                {t.disputeWhat.map((line) => (
                  <li key={line}><span className="material-symbols-outlined">chevron_right</span>{line}</li>
                ))}
              </ul>
              {task.status === "Disputed" ? (
                <div className="td-flagged"><span className="material-symbols-outlined" style={{ fontSize: 16 }}>flag</span>{t.disputeFlagged}</div>
              ) : task.status === "Resolved" ? (
                <div className="td-flagged" style={{ color: "#B97DFF" }}>{t.resolved}</div>
              ) : task.status === "Settled" && onchain ? (
                <div className="td-actions">
                  <button type="button" className="btn-danger" onClick={() => setShowDispute(true)}>{t.disputeBtn}</button>
                </div>
              ) : (
                <div className="td-hint" style={{ marginTop: 14 }}>{t.disputeLater}</div>
              )}
            </section>

            <section className="ui-card ui-reveal" style={{ ["--i" as string]: 7 }}>
              <div className="td-share">
                {canShare && (
                  <button type="button" className="btn-ghost" onClick={share}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>share</span>{t.share}
                  </button>
                )}
                <button type="button" className="btn-ghost" style={canShare ? undefined : { gridColumn: "1 / -1" }} onClick={copyLink}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{copied ? "check" : "link"}</span>{copied ? t.copied : t.copy}
                </button>
                {task.status === "Open" && !deadlinePassed && (
                  <Link href={`/task/${task.id}/submit`} className="btn-accent-ghost td-submit-link">{t.howSubmit}</Link>
                )}
              </div>
            </section>
          </div>
        </div>
      </main>

      {showDispute && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowDispute(false); }}>
          <div className="modal-box td-modal" role="dialog" aria-modal="true" aria-label={t.modalTitle(task.id)}>
            <div className="td-modal-head">
              <h2 className="td-card-title">{t.modalTitle(task.id)}</h2>
              <button type="button" className="td-modal-close" aria-label={t.close} onClick={() => setShowDispute(false)}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
              </button>
            </div>
            <DisputePanel
              task={task}
              onClose={() => setShowDispute(false)}
              onDisputed={() => setTask((p) => (p ? { ...p, status: "Disputed" } : p))}
            />
          </div>
        </div>
      )}
    </div>
  );
}
