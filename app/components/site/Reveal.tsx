"use client";
/**
 * Fades in [data-reveal] sections as they scroll into view. Content never
 * stays hidden: anything already on screen shows at once, and a fallback
 * shows everything after a short delay (previews, bots, odd viewports).
 */
import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function Reveal() {
  const path = usePathname();
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const root = document.documentElement;
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]:not(.in)"));
    const vh = window.innerHeight || 800;
    els.forEach((el) => { if (el.getBoundingClientRect().top < vh) el.classList.add("in"); });
    root.classList.add("ui-reveal-ready");
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }, { threshold: 0.05 });
    els.forEach((el) => { if (!el.classList.contains("in")) io.observe(el); });
    const fallback = window.setTimeout(() => els.forEach((el) => el.classList.add("in")), 2500);
    return () => { io.disconnect(); window.clearTimeout(fallback); };
  }, [path]);
  return null;
}
