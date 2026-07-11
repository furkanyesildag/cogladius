"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import ConnectWallet from "@/components/ConnectWallet";
import { useMessages, useLocale } from "@/lib/i18n";
import type { AppLocale } from "@/lib/i18n/types";
import { ThemeToggle } from "@/components/ThemeProvider";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import type { Task } from "@/lib/types";
import { getMockTasks } from "@/lib/sampleTasks";
import { shortenAddress, ESCROW_CONTRACT_ID, explorerContract } from "@/lib/constants";

function badgeClass(status: string): string {
  if (status === "Open") return "badge badge-open";
  if (status === "UnderReview") return "badge badge-review";
  if (status === "AwaitingDecision") return "badge badge-awaiting";
  if (status === "Settled") return "badge badge-settled";
  if (status === "Disputed") return "badge badge-disputed";
  if (status === "Resolved") return "badge badge-resolved";
  return "badge badge-stopped";
}

function formatDeadline(ts: number, locale: AppLocale): string {
  const loc = locale === "tr" ? "tr-TR" : "en-US";
  return new Date(ts * 1000).toLocaleString(loc, { dateStyle: "short", timeStyle: "short" });
}

export default function TasksListPage() {
  const router = useRouter();
  const { locale } = useLocale();
  const ui = useMessages().ui;
  const ta = ui.taskArenaPage;
  const list = ui.tasksListPage;
  const statusLabels = ui.status as Record<string, string>;
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [usedFallback, setUsedFallback] = useState(false);

  const navItems = useMemo(
    () => [
      { label: ta.navTop.dashboard, href: "/dashboard" as const },
      { label: ta.navTop.tasks, href: "/tasks" as const, active: true },
      { label: ta.navTop.agents, href: "/agents" as const },
    ],
    [ta.navTop]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tasks");
        if (!res.ok) throw new Error("bad status");
        const d = await res.json();
        if (cancelled) return;
        if (Array.isArray(d.tasks)) {
          setTasks(d.tasks);
          return;
        }
      } catch {
        if (cancelled) return;
        setUsedFallback(true);
        setTasks(getMockTasks());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--bg-base)" }}>
      <header
        style={{
          height: 48,
          background: "var(--bg-surface-low)",
          borderBottom: "1px solid var(--bg-border)",
          display: "flex",
          alignItems: "center",
          padding: "0 20px",
          gap: 0,
          flexShrink: 0,
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <span style={{ cursor: "pointer", marginRight: 32, display: "flex", alignItems: "center" }} onClick={() => router.push("/")}>
          <img src="/logo.svg" alt="Cogladius" style={{ width: 34, height: 34, objectFit: "contain" }} />
        </span>
        {navItems.map((item) => (
          <button
            key={item.href}
            onClick={() => router.push(item.href)}
            style={{
              background: "none",
              border: "none",
              borderBottom: item.active ? "2px solid var(--accent)" : "2px solid transparent",
              color: item.active ? "var(--accent)" : "rgba(var(--text-rgb),0.4)",
              fontFamily: "var(--font)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              padding: "0 16px",
              height: 48,
              cursor: "pointer",
              transition: "color 0.12s",
            }}
          >
            {item.label}
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <LanguageSwitcher />
          <ThemeToggle />
          <ConnectWallet />
        </div>
      </header>

      <main style={{ flex: 1, padding: "28px 32px", maxWidth: 1100, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        <h1 style={{ fontFamily: "var(--font-head)", fontSize: 22, color: "var(--text-primary)", margin: "0 0 8px" }}>{list.title}</h1>
        <p style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--text-muted)", margin: "0 0 24px", lineHeight: 1.6 }}>
          {list.subtitle}
        </p>
        {usedFallback && (
          <div
            style={{
              fontFamily: "var(--font)",
              fontSize: 11,
              color: "var(--yellow)",
              marginBottom: 16,
              padding: "10px 14px",
              background: "var(--bg-surface-low)",
              border: "1px solid var(--bg-border)",
              borderRadius: 6,
            }}
          >
            {list.loadError}
          </div>
        )}

        {tasks === null ? (
          <div style={{ fontFamily: "var(--font)", fontSize: 12, color: "rgba(var(--text-rgb),0.35)" }}>{ta.loading}</div>
        ) : tasks.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "72px 24px 48px", gap: 18 }}>
            <div style={{ width: 66, height: 66, borderRadius: 18, background: "var(--accent-dim)", border: "1px solid var(--accent-border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 32, color: "var(--accent)" }}>inventory_2</span>
            </div>
            <div>
              <div style={{ fontFamily: "var(--font-head)", fontSize: 19, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>{list.empty}</div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--text-muted)", maxWidth: 440, lineHeight: 1.65, margin: "0 auto" }}>
                {locale === "tr"
                  ? "İlk görevi yayınla — XLM ödülü, bir karar verilene kadar canlı bir Soroban escrow kontratında kilitlenir. Hiçbir platform cüzdanı fonları tutmaz."
                  : "Post the first task — its XLM reward is locked in a live Soroban escrow contract until a verdict is reached. No platform wallet holds the funds."}
              </div>
            </div>
            {ESCROW_CONTRACT_ID && (
              <a href={explorerContract(ESCROW_CONTRACT_ID)} target="_blank" rel="noopener noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "var(--font)", fontSize: 10, color: "var(--text-secondary)", textDecoration: "none", background: "var(--bg-surface)", border: "1px solid var(--bg-border-bright)", borderRadius: 999, padding: "7px 14px", letterSpacing: "0.04em" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 6px var(--green)" }} />
                {locale === "tr" ? "Canlı Soroban escrow" : "Live Soroban escrow"} · {shortenAddress(ESCROW_CONTRACT_ID, 5)} ↗
              </a>
            )}
            <button onClick={() => router.push("/dashboard")} className="btn-primary"
              style={{ marginTop: 4, justifyContent: "center", padding: "12px 22px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add_task</span>
              {locale === "tr" ? "Görev yayınlamak için panele git" : "Open dashboard to post a task"}
            </button>
          </div>
        ) : (
          <div style={{ background: "var(--bg-surface-low)", border: "1px solid var(--bg-border)", borderRadius: 8, overflow: "hidden" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,1fr) 100px 120px 140px",
                gap: 12,
                padding: "12px 18px",
                borderBottom: "1px solid var(--bg-border)",
                fontFamily: "var(--font)",
                fontSize: 9,
                color: "var(--text-muted)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              <span>{list.colSummary}</span>
              <span>{list.colReward}</span>
              <span>{list.colStatus}</span>
              <span>{list.colDeadline}</span>
            </div>
            {tasks.map((task) => {
              const curr = "XLM";
              const rewardNum = task.rewardUsdc ?? task.reward / 1e7;
              const summary = task.description.length > 120 ? `${task.description.slice(0, 117)}…` : task.description;
              const statusKey = task.status;
              const statusText = statusLabels[statusKey] ?? statusKey;
              return (
                <div
                  key={task.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => router.push(`/task/${task.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      router.push(`/task/${task.id}`);
                    }
                  }}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1fr) 100px 120px 140px",
                    gap: 12,
                    padding: "14px 18px",
                    borderBottom: "1px solid var(--bg-border)",
                    cursor: "pointer",
                    alignItems: "center",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--bg-surface-high)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <div>
                    <div style={{ fontFamily: "var(--font)", fontSize: 10, color: "var(--accent)", letterSpacing: "0.06em", marginBottom: 4 }}>
                      #{task.id} · {shortenAddress(task.poster)}
                    </div>
                    <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--text-primary)", lineHeight: 1.45 }}>{summary}</div>
                  </div>
                  <span style={{ fontFamily: "var(--font)", fontSize: 12, fontWeight: 700, color: "var(--accent)" }}>{rewardNum.toFixed(4)} {curr}</span>
                  <span className={badgeClass(task.status)} style={{ justifySelf: "start" }}>
                    {statusText}
                  </span>
                  <span style={{ fontFamily: "var(--font)", fontSize: 11, color: "rgba(var(--text-rgb),0.45)" }}>{formatDeadline(task.deadline, locale)}</span>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
