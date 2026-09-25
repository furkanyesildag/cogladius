"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";

/** Shared motion helpers for the site's animated cards and counters. */

export function useInView<T extends Element>(threshold = 0.2) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") { setSeen(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [seen, threshold]);
  return [ref, seen] as const;
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!q) return;
    setReduced(q.matches);
    const on = () => setReduced(q.matches);
    q.addEventListener?.("change", on);
    return () => q.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

/** Steps 0..n, one every `ms`, then holds `hold` ms and starts over. */
export function useLoop(n: number, ms: number, hold: number, run: boolean) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!run || n <= 0) return;
    const id = setTimeout(() => setStep((s) => (s >= n ? 0 : s + 1)), step >= n ? hold : ms);
    return () => clearTimeout(id);
  }, [step, n, ms, hold, run]);
  return step;
}

export function useTicker(len: number, ms: number, run: boolean) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!run || len < 2) return;
    const id = setInterval(() => setI((x) => (x + 1) % len), ms);
    return () => clearInterval(id);
  }, [len, ms, run]);
  return len ? i % len : 0;
}

export function CountUp({ value, decimals = 0, run }: { value: number | null; decimals?: number; run: boolean }) {
  const [v, setV] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (value === null || !run) return;
    if (reduced) { setV(value); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 1400);
      setV(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, run, reduced]);
  if (value === null) return <>—</>;
  return <>{v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}</>;
}

/** Mouse-follow spotlight for .infra-card / .ui-card (sets --mx / --my). */
export function spotlight(e: MouseEvent<HTMLDivElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
}
