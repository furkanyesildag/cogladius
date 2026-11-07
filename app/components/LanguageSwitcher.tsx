"use client";

import { useLocale } from "@/lib/i18n";
import type { AppLocale } from "@/lib/i18n/types";

const ORDER: AppLocale[] = ["en", "tr"];

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();
  return (
    <div role="group" aria-label="Language" className="ui-tabs" style={{ padding: 3 }}>
      {ORDER.map((l) => (
        <button
          key={l}
          type="button"
          className="ui-tab"
          aria-selected={locale === l}
          onClick={() => setLocale(l)}
          style={{ height: 28, padding: "0 10px", fontSize: 12, textTransform: "uppercase" }}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
