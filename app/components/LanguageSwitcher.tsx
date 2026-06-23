"use client";

import { useLocale } from "@/lib/i18n";
import type { AppLocale } from "@/lib/i18n/types";

const ORDER: AppLocale[] = ["tr", "en"];

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();
  return (
    <div
      role="group"
      aria-label="Language"
      style={{
        display: "flex",
        gap: 2,
        fontFamily: "var(--font)",
        fontSize: 9,
        letterSpacing: "0.06em",
        flexShrink: 0,
      }}
    >
      {ORDER.map((l) => {
        const on = locale === l;
        return (
          <button
            key={l}
            type="button"
            onClick={() => setLocale(l)}
            style={{
              padding: "3px 8px",
              borderRadius: 3,
              border: `1px solid ${on ? "var(--accent)" : "var(--bg-border-bright)"}`,
              background: on ? "var(--accent-dim)" : "transparent",
              color: on ? "var(--accent)" : "var(--text-muted)",
              cursor: "pointer",
              textTransform: "uppercase",
              fontWeight: on ? 700 : 500,
            }}
          >
            {l}
          </button>
        );
      })}
    </div>
  );
}
