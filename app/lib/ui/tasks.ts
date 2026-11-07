"use client";
/** Small view helpers shared by the redesigned task, league and home pages. */
import { useEffect, useState } from "react";
import type { Task } from "@/lib/types";
import { isAcceptingSubmissions } from "@/lib/dashboardData";

export { isAcceptingSubmissions };

/** XLM amount from a task reward stored in stroops. */
export function rewardXlm(t: Pick<Task, "reward">): number {
  return Number(t.reward || 0) / 1e7;
}

export function formatXlm(n: number, max = 2): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: max });
}

/** First sentence of the brief, used as the task title. */
export function taskTitle(t: Pick<Task, "description">, maxLen = 96): string {
  const d = String(t.description || "").replace(/\s+/g, " ").trim();
  const m = d.match(/^(.{8,}?[.?!])\s/);
  let title = m ? m[1] : d;
  if (title.endsWith(".")) title = title.slice(0, -1);
  return title.length > maxLen ? `${title.slice(0, maxLen - 1).trimEnd()}…` : title;
}

/** The brief without its first sentence (empty when the brief is one sentence). */
export function taskBody(t: Pick<Task, "description">): string {
  const d = String(t.description || "").trim();
  const m = d.match(/^(.{8,}?[.?!])\s+/s);
  return m ? d.slice(m[0].length).trim() : "";
}

export type Standing = { agent: string; avg: number; scores: number[]; submittedAt: number };

/** Judged submitters ranked like the settle crank: rounded average, ties to the earliest submission. */
export function standings(t: Task): Standing[] {
  const by = new Map<string, number[]>();
  for (const v of t.verdicts ?? []) {
    if (!by.has(v.agent)) by.set(v.agent, []);
    by.get(v.agent)!.push(Number(v.score) || 0);
  }
  const out: Standing[] = [];
  for (const [agent, scores] of by) {
    const sub = (t.submissions ?? []).find((s) => s.agent === agent);
    out.push({
      agent,
      scores,
      avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
      submittedAt: Number(sub?.submittedAt) || Number.MAX_SAFE_INTEGER,
    });
  }
  return out.sort((a, b) => b.avg - a.avg || a.submittedAt - b.submittedAt);
}

/** Ticks every `ms`, for countdowns. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** "1d 4h", "3h 12m", "4m 09s" (Turkish: "1g 4sa", "3sa 12dk", "4dk 09sn") until a unix-seconds deadline, or null once passed. */
export function countdown(deadlineSec: number, nowMs: number, tr = false): string | null {
  const u = tr ? { d: "g", h: "sa", m: "dk", s: "sn" } : { d: "d", h: "h", m: "m", s: "s" };
  let s = Math.floor(deadlineSec - nowMs / 1000);
  if (s <= 0) return null;
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  if (d > 0) return `${d}${u.d} ${h}${u.h}`;
  if (h > 0) return `${h}${u.h} ${String(m).padStart(2, "0")}${u.m}`;
  return `${m}${u.m} ${String(s).padStart(2, "0")}${u.s}`;
}

/** Deterministic avatar colour for an address. */
export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 62% 46%)`;
}

export function shortKey(k: string, n = 4): string {
  if (!k) return "";
  if (k.includes("…")) return k;
  return k.length > n * 2 + 1 ? `${k.slice(0, n)}…${k.slice(-n)}` : k;
}

/** Fetch JSON once on mount and refresh every `ms` (0 = no refresh). */
export function useJson<T>(url: string, ms = 0): { data: T | null; error: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as T;
        if (alive) { setData(j); setError(false); }
      } catch {
        if (alive) setError(true);
      }
    };
    load();
    const id = ms ? setInterval(load, ms) : undefined;
    return () => { alive = false; if (id) clearInterval(id); };
  }, [url, ms]);
  return { data, error };
}
