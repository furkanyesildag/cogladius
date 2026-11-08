"use client";
/** Marks the page ready and fades in [data-reveal] elements as they scroll into view. */
import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function Reveal() {
  const path = usePathname();
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const root = document.documentElement;
    root.classList.add("ui-reveal-ready");
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    document.querySelectorAll("[data-reveal]:not(.in)").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [path]);
  return null;
}
