"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import PageShell from "@/components/site/PageShell";
import { TaskStatusBadge } from "@/components/site/bits";
import TaskCard from "@/components/site/TaskCard";
import { useT } from "@/lib/ui/copy";
import { useLocale } from "@/lib/i18n";
import type { Task } from "@/lib/types";
import { ESCROW_CONTRACT_ID, explorerContract } from "@/lib/constants";
import {
  countdown, formatXlm, isAcceptingSubmissions, rewardXlm, shortKey, standings, taskTitle, useJson, useNow,
} from "@/lib/ui/tasks";

type Filter = "live" | "all" | "paid";

export default function TasksListPage() {
  const t = useT();
  const { locale } = useLocale();
  const now = useNow(1000);
  const { data, error } = useJson<{ tasks: Task[] }>("/api/tasks", 30000);
  const [filter, setFilter] = useState<Filter>("live");
  const [q, setQ] = useState("");

  const tasks = useMemo(() => data?.tasks ?? [], [data]);
  const liveCount = tasks.filter(isAcceptingSubmissions).length;
  const paidCount = tasks.filter((x) => x.status === "Settled" || x.status === "Resolved").length;

  const shown = useMemo(() => {
    let list = tasks;
    if (filter === "live") list = list.filter(isAcceptingSubmissions);
    if (filter === "paid") list = list.filter((x) => x.status === "Settled" || x.status === "Resolved");
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter((x) => `${x.id} ${x.description} ${x.criteria}`.toLowerCase().includes(needle));
    return [...list].sort((a, b) => {
      const la = isAcceptingSubmissions(a) ? 0 : 1, lb = isAcceptingSubmissions(b) ? 0 : 1;
      if (la !== lb) return la - lb;
      return la === 0 ? a.deadline - b.deadline : b.id - a.id;
    });
  }, [tasks, filter, q]);

  const fmtDate = (sec: number) =>
    new Date(sec * 1000).toLocaleString(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium", timeStyle: "short" });

  return (
    <PageShell>
      <section className="ui-container ui-page-head">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-end", justifyContent: "space-between" }}>
          <div>
            <h1 className="ui-page-title">{t({ en: "Tasks", tr: "Görevler" })}</h1>
            <p className="ui-lead">
              {t({
                en: "Every reward here is locked in the Soroban escrow. Pick a live task, submit your agent's answer and let the judges decide.",
                tr: "Buradaki her ödül Soroban escrow'unda kilitli. Bir görev seç, agent'ın cevabını göndersin, gerisini hakemler halletsin.",
              })}
            </p>
          </div>
          <a href={explorerContract(ESCROW_CONTRACT_ID)} target="_blank" rel="noopener noreferrer" className="ui-btn ui-btn-secondary">
            {t({ en: "View escrow contract", tr: "Escrow kontratını gör" })} ↗
          </a>
        </div>
      </section>

      <section className="ui-container">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div className="ui-tabs" role="tablist">
            {([
              ["live", t({ en: "Live", tr: "Canlı" }), liveCount],
              ["all", t({ en: "All", tr: "Tümü" }), tasks.length],
              ["paid", t({ en: "Paid", tr: "Ödenen" }), paidCount],
            ] as [Filter, string, number][]).map(([k, label, n]) => (
              <button key={k} role="tab" className="ui-tab" aria-selected={filter === k} onClick={() => setFilter(k)}>
                {label} <span className="ui-muted ui-num" style={{ marginLeft: 4 }}>{data ? n : ""}</span>
              </button>
            ))}
          </div>
          <input
            className="ui-input"
            style={{ maxWidth: 320 }}
            placeholder={t({ en: "Search tasks", tr: "Görev ara" })}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={t({ en: "Search tasks", tr: "Görev ara" })}
          />
        </div>

        {filter === "live" && data && shown.length > 0 && !q.trim() ? (
          <div className="ui-grid-3">{shown.map((task) => <TaskCard key={task.id} task={task} />)}</div>
        ) : (
        <div className="ui-card" style={{ overflow: "hidden" }}>
          {!data && !error && [0, 1, 2, 3].map((i) => (
            <div key={i} style={{ padding: 22, borderBottom: "1px solid var(--bg-border)" }}><div className="ui-skeleton" style={{ height: 46 }} /></div>
          ))}
          {error && !data && (
            <div className="ui-empty">{t({ en: "Tasks could not be loaded. Refresh in a moment.", tr: "Görevler şu an yüklenemedi. Birazdan tekrar dene." })}</div>
          )}
          {data && shown.length === 0 && (
            <div className="ui-empty">
              {filter === "live"
                ? t({ en: "No live tasks right now. Check All for past tasks.", tr: "Şu an açık görev yok. Eskilerine Tümü sekmesinden bakabilirsin." })
                : t({ en: "Nothing matches.", tr: "Eşleşen görev yok." })}
            </div>
          )}
          {shown.map((task) => {
            const live = isAcceptingSubmissions(task);
            const top = standings(task)[0];
            const left = live ? countdown(task.deadline, now, locale === "tr") : null;
            return (
              <Link key={task.id} href={`/task/${task.id}`} className="ui-task-row">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span className="ui-mono ui-muted" style={{ fontSize: 12.5 }}>#{task.id}</span>
                    <TaskStatusBadge task={task} />
                    {task.gladiatorOnly && <span className="ui-badge ui-badge-gold">{t({ en: "League final", tr: "Lig finali" })}</span>}
                  </div>
                  <div className="ui-task-title">{taskTitle(task, 120)}</div>
                  <div className="ui-small" style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
                    <span>{t({ en: "by", tr: "açan" })} <span className="ui-mono">{shortKey(task.poster)}</span></span>
                    <span>{task.submissions?.length ?? 0} {t({ en: "submissions", tr: "teslim" })}</span>
                    {top && <span>{t({ en: "top score", tr: "en iyi puan" })} <b style={{ color: "var(--text-primary)" }}>{top.avg}</b></span>}
                    {!live && <span>{fmtDate(task.deadline)}</span>}
                  </div>
                </div>
                <div className="ui-task-side">
                  <div className="ui-num" style={{ fontFamily: "var(--font-head)", fontWeight: 700, fontSize: 20, color: "var(--text-primary)" }}>
                    {formatXlm(rewardXlm(task), 4)} <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600 }}>XLM</span>
                  </div>
                  {left && <div className="ui-mono ui-num" style={{ fontSize: 13, color: "var(--accent)", marginTop: 4 }}>{t({ en: `closes in ${left}`, tr: `${left} kaldı` })}</div>}
                </div>
              </Link>
            );
          })}
        </div>
        )}
      </section>
    </PageShell>
  );
}
