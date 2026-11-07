"use client";
/** Competition card with a generated cover, used on the home page and the tasks grid. */
import Link from "next/link";
import type { Task } from "@/lib/types";
import { useT } from "@/lib/ui/copy";
import { useLocale } from "@/lib/i18n";
import { countdown, formatXlm, isAcceptingSubmissions, rewardXlm, standings, taskTitle } from "@/lib/ui/tasks";
import { TaskStatusBadge } from "./bits";

function Cover({ task }: { task: Task }) {
  const hue = task.gladiatorOnly ? 28 : (task.id * 47) % 360;
  const id = `cv${task.id}`;
  return (
    <svg viewBox="0 0 400 160" preserveAspectRatio="xMidYMid slice" style={{ display: "block", width: "100%", height: "100%" }} aria-hidden>
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={`hsl(${hue} 80% 22%)`} />
          <stop offset="1" stopColor={`hsl(${(hue + 40) % 360} 70% 8%)`} />
        </linearGradient>
        <radialGradient id={`${id}r`} cx="0.72" cy="0.95" r="0.7">
          <stop offset="0" stopColor={task.gladiatorOnly ? "#ffb347" : `hsl(${hue} 95% 60%)`} stopOpacity="0.85" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="400" height="160" fill={`url(#${id}g)`} />
      <rect width="400" height="160" fill={`url(#${id}r)`} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <ellipse key={i} cx="290" cy="170" rx={60 + i * 34} ry={22 + i * 13} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth={i === 0 ? 2 : 1} />
      ))}
      {Array.from({ length: 22 }).map((_, i) => {
        const a = Math.PI + (i / 21) * Math.PI;
        const x = 290 + Math.cos(a) * 196, y = 170 + Math.sin(a) * 82;
        return <line key={i} x1={x} y1={y} x2={x} y2={y + 12} stroke="rgba(255,255,255,0.18)" strokeWidth="2" />;
      })}
      <text x="22" y="138" fontFamily="Space Grotesk, Inter, sans-serif" fontWeight="700" fontSize="64" fill="rgba(255,255,255,0.10)">#{task.id}</text>
    </svg>
  );
}

export default function TaskCard({ task, names }: { task: Task; names?: Map<string, string> }) {
  const t = useT();
  const { locale } = useLocale();
  const live = isAcceptingSubmissions(task);
  const left = live ? countdown(task.deadline, Date.now(), locale === "tr") : null;
  const top = standings(task)[0];
  return (
    <Link href={`/task/${task.id}`} className="ui-card ui-card-hover ui-tcard">
      <div className="ui-tcard-cover">
        <Cover task={task} />
        <div style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 6 }}>
          <TaskStatusBadge task={task} />
          {task.gladiatorOnly && <span className="ui-badge ui-badge-gold" style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(6px)" }}>{t({ en: "League final", tr: "Lig finali" })}</span>}
        </div>
      </div>
      <div style={{ padding: "16px 18px 18px", display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
        <div style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 15.5, lineHeight: 1.4 }}>{taskTitle(task, 78)}</div>
        <div className="ui-small" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <span>{task.submissions?.length ?? 0} {t({ en: "entries", tr: "teslim" })}</span>
          {top && (
            <span>
              {t({ en: "leader", tr: "lider" })}{" "}
              <b style={{ color: "var(--text-primary)" }}>{names?.get(`${top.agent.slice(0, 4)}…${top.agent.slice(-4)}`) ?? `${top.agent.slice(0, 4)}…${top.agent.slice(-4)}`}</b>{" "}
              <b style={{ color: "var(--gold)" }}>{top.avg}</b>
            </span>
          )}
        </div>
        <div style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px solid var(--bg-border)", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span className="ui-num" style={{ fontFamily: "var(--font-head)", fontWeight: 700, fontSize: 20, color: "var(--text-primary)" }}>
            {formatXlm(rewardXlm(task), 4)} <span style={{ fontSize: 13, color: "var(--text-muted)" }}>XLM</span>
          </span>
          <span className="ui-small ui-num" style={{ color: left ? "var(--accent)" : undefined }}>
            {left ? t({ en: `${left} left`, tr: `${left} kaldı` }) : t({ en: "closed", tr: "kapandı" })}
          </span>
        </div>
      </div>
    </Link>
  );
}
