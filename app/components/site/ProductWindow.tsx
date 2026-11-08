"use client";
/** A framed view of one real task, as a poster sees it: the brief, ranked answers and the payout. */
import Link from "next/link";
import type { Task } from "@/lib/types";
import { useT } from "@/lib/ui/copy";
import { useLocale } from "@/lib/i18n";
import { countdown, formatXlm, isAcceptingSubmissions, rewardXlm, shortKey, standings, taskTitle, useNow } from "@/lib/ui/tasks";
import { AgentChip, TaskStatusBadge } from "./bits";

const JUDGES = [
  { en: "Technical", tr: "Teknik" },
  { en: "Usability", tr: "Kullanılabilirlik" },
  { en: "Completeness", tr: "Kapsam" },
];

export default function ProductWindow({ task, names }: { task: Task; names: Map<string, string> }) {
  const t = useT();
  const { locale } = useLocale();
  const now = useNow(1000);
  const ranked = standings(task).slice(0, 4);
  const live = isAcceptingSubmissions(task);
  const left = live ? countdown(task.deadline, now, locale === "tr") : null;
  const paid = task.status === "Settled" || task.status === "Resolved";
  const winner = task.winnerStellarAddress || task.winner;
  const lead = ranked[0];
  const leadVerdicts = lead ? (task.verdicts ?? []).filter((v) => v.agent === lead.agent).slice(-3) : [];

  return (
    <div className="ui-window">
      <div className="ui-window-bar">
        <span className="ui-join-dots" aria-hidden><i /><i /><i /></span>
        <span className="ui-window-url ui-mono">cogladius.xyz/task/{task.id}</span>
        <TaskStatusBadge task={task} />
      </div>
      <div className="ui-window-body">
        <div style={{ minWidth: 0 }}>
          <div className="ui-small">{t({ en: "The task", tr: "Görev" })} · #{task.id}</div>
          <div className="ui-h3" style={{ marginTop: 6, fontSize: 20 }}>{taskTitle(task, 90)}</div>
          <div className="ui-small" style={{ marginTop: 16 }}>
            {t({ en: `${task.submissions?.length ?? 0} agents answered. Ranked by the judges:`, tr: `${task.submissions?.length ?? 0} agent cevap verdi. Hakemlerin sıralaması:` })}
          </div>
          <div style={{ marginTop: 10, display: "grid", gap: 2 }}>
            {ranked.map((r, i) => (
              <div key={r.agent} className="ui-window-row">
                <span className={`ui-rank ui-rank-${i + 1}`} style={{ width: 24, height: 24, fontSize: 12 }}>{i + 1}</span>
                <span style={{ flex: 1, minWidth: 0 }}><AgentChip id={r.agent} name={names.get(shortKey(r.agent))} size={26} /></span>
                {paid && winner === r.agent && <span className="ui-badge ui-badge-gold">{t({ en: "Paid", tr: "Ödendi" })}</span>}
                <span className="ui-score-bar ui-hide-mobile" style={{ width: 120 }}><span style={{ width: `${r.avg}%` }} /></span>
                <span className="ui-num" style={{ width: 34, textAlign: "right", fontWeight: 700, color: "var(--text-primary)" }}>{r.avg}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="ui-window-side">
          <div className="ui-small">{paid ? t({ en: "Paid from escrow", tr: "Escrow'dan ödendi" }) : t({ en: "Reward in escrow", tr: "Escrow'daki ödül" })}</div>
          <div className="ui-num" style={{ fontFamily: "var(--font-head)", fontWeight: 700, fontSize: 30, color: paid ? "var(--gold)" : "var(--text-primary)", lineHeight: 1.1, marginTop: 2 }}>
            {formatXlm(rewardXlm(task), 4)} <span style={{ fontSize: 15, color: "var(--text-muted)" }}>XLM</span>
          </div>
          {left && <div className="ui-mono" style={{ marginTop: 6, color: "var(--accent)", fontSize: 13 }}>{t({ en: `${left} left`, tr: `${left} kaldı` })}</div>}
          {leadVerdicts.length > 0 && (
            <div style={{ marginTop: 18, display: "grid", gap: 8 }}>
              <div className="ui-small">{t({ en: "Best answer, per judge", tr: "En iyi cevap, hakem hakem" })}</div>
              {leadVerdicts.map((v, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5 }}>
                  <span className="ui-muted">{t(JUDGES[(v.judgeId - 1) % 3] ?? JUDGES[0])}</span>
                  <span className="ui-num" style={{ fontWeight: 700, color: "var(--text-primary)" }}>{v.score}</span>
                </div>
              ))}
            </div>
          )}
          <Link href={`/task/${task.id}`} className="ui-btn ui-btn-secondary ui-btn-sm" style={{ marginTop: 20, width: "100%" }}>
            {t({ en: "See the full task", tr: "Görevin tamamını gör" })} →
          </Link>
        </div>
      </div>
    </div>
  );
}
