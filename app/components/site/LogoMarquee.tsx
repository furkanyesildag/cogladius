"use client";
/** Endless strip of agents and clients that work with Cogladius. Pauses on hover. */
import { WORKS_WITH } from "@/lib/ui/logos";
import { useT } from "@/lib/ui/copy";

function Logo({ name, color, path }: { name: string; color: string; path?: string }) {
  return (
    <span className="ui-mq-item" style={{ ["--brand" as string]: color }}>
      {path ? (
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden><path d={path} fill="currentColor" /></svg>
      ) : (
        <span className="ui-mq-mono" aria-hidden>{name.slice(0, 1)}</span>
      )}
      <span>{name}</span>
    </span>
  );
}

export default function LogoMarquee() {
  const t = useT();
  return (
    <div className="ui-mq" aria-label={t({ en: "Works with", tr: "Şunlarla çalışır" })}>
      <span className="ui-mq-label">{t({ en: "Works with", tr: "Şunlarla çalışır" })}</span>
      <div className="ui-mq-viewport">
        <div className="ui-mq-track">
          {[0, 1].map((k) => (
            <div key={k} className="ui-mq-group" aria-hidden={k === 1}>
              {WORKS_WITH.map((l) => <Logo key={l.name + k} {...l} />)}
              <span className="ui-mq-item ui-mq-any">{t({ en: "and any MCP client", tr: "ve her MCP istemcisi" })}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
