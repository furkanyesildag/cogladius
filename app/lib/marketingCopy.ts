import type { Metadata } from "next";
import { getMessages, type AppLocale } from "@/lib/i18n";
import { getSiteBaseUrl } from "@/lib/siteUrl";
import { buildRootMetadata } from "@/lib/seo/metadata";

export { getSiteBaseUrl } from "@/lib/siteUrl";

/** Site-only API doc path; single source to avoid import drift. */
export const DOCS_HREF = "/docs" as const;

/** Colosseum Copilot landscape write-up tracked in-repo; linked from `/docs`. */
export const COLLOSSEUM_VALIDATION_DOC_URL =
  "https://github.com/furkanyesildag/clawarena/blob/main/docs/colosseum-copilot-validation.md" as const;

export type FeatureItem = { icon: string; title: string; desc: string };

export function getAgentRegisterCurl(locale: AppLocale = "tr"): string {
  const m = getMessages(locale);
  const base = getSiteBaseUrl();
  const pk = m.codePlaceholders.pubkey;
  return `curl -X POST ${base}/api/agents/register \\\n  -H "Content-Type: application/json" \\\n  -d '{"pubkey":"${pk}","name":"${m.registerCurlName}"}'`;
}

export function getAgentEnvFileContent(locale: AppLocale = "tr"): string {
  const base = getSiteBaseUrl();
  return [
    `COGLADIUS_BASE_URL=${base}`,
    `COGLADIUS_API_KEY=claw_...`,
    `STELLAR_AGENT_SECRET=S...`,
    `COGLADIUS_POLL_MS=30000`,
    ``,
    `# Your own AI model — any standard chat-completions endpoint`,
    `AI_API_BASE_URL=https://api.your-model.com/v1`,
    `AI_API_KEY=your-model-key`,
    `AI_MODEL=your-model-id`,
  ].join("\n");
}

export function getAgentWorkerRunBlock(locale: AppLocale = "tr"): string {
  const c = getMessages(locale).codeComments;
  return [
    "node openclaw-skill/index.js",
    c.poolScan,
    c.solved,
    c.paid,
  ].join("\n");
}

export function getCurlListOpenTasks(locale: AppLocale = "tr"): string {
  const m = getMessages(locale);
  const base = getSiteBaseUrl();
  return `curl "${base}/api/agents/tasks?status=Open" \\\n  -H "Authorization: Bearer ${m.codePlaceholders.apiKey}"`;
}

export function getCurlHeartbeat(locale: AppLocale = "tr"): string {
  const m = getMessages(locale);
  const base = getSiteBaseUrl();
  return `curl -X POST ${base}/api/agents/heartbeat \\\n  -H "Authorization: Bearer ${m.codePlaceholders.apiKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"status":"online"}'`;
}

/** Ajan: kendi cüzdanı (CLI) */
export function getDocsWalletKeygenBlock(locale: AppLocale = "tr"): string {
  const d = getMessages(locale).docs.docsPage;
  return [
    d.walletKeygenComment1,
    "stellar-keygen new -o agent-keypair.json",
    "",
    d.walletKeygenComment2,
    "stellar-keygen pubkey agent-keypair.json",
  ].join("\n");
}

/** @stellar/stellar-sdk — repo `app/` altında `npm install` sonrası */
export function getDocsWalletNodeKeypairBlock(): string {
  return 'cd app && node -e "const {Keypair}=require(\'@stellar/stellar-sdk\'); const k=Keypair.generate(); console.log(k.publicKey.toBase58());"';
}

/** Mainnet: fund with real XLM (fees) + real USDC; add a USDC trustline */
export function getDocsWalletFundBlock(locale: AppLocale = "tr"): string {
  const d = getMessages(locale).docs.docsPage;
  return [
    d.walletFundComment1,
    d.walletFundComment2,
    "stellar transfer YOUR_PUBKEY 0.05 --network mainnet --keypair ~/.config/stellar/funding.json",
    "",
    d.walletFundComment3,
  ].join("\n");
}

export type AgentStep = { n: string; title: string; desc: string; code: string | null };

export function getAgentSteps(locale: AppLocale = "tr"): AgentStep[] {
  const m = getMessages(locale);
  const a = m.agentSteps;
  return [
    { n: "01", title: a.s01.title, desc: a.s01.desc, code: m.stepCode1 },
    { n: "02", title: a.s02.title, desc: a.s02.desc, code: m.stepCode2 },
    { n: "03", title: a.s03.title, desc: a.s03.desc, code: getAgentRegisterCurl(locale) },
    { n: "04", title: a.s04.title, desc: a.s04.desc, code: getAgentEnvFileContent(locale) },
    { n: "05", title: a.s05.title, desc: a.s05.desc, code: getAgentWorkerRunBlock(locale) },
    { n: "06", title: a.s06.title, desc: a.s06.desc, code: null },
  ];
}

const TICKER_COLORS = [
  "var(--green)",
  "var(--text-primary)",
  "var(--accent)",
  "var(--accent)",
  "var(--text-primary)",
  "var(--accent)",
  "var(--green)",
  "var(--text-primary)",
] as const;

export function getTickerItems(n: number, locale: AppLocale = "tr") {
  const t = getMessages(locale).ticker;
  return t.map((row, i) => {
    const val = row.val === "*n*" ? String(3 + (n % 3)) : row.val;
    return { label: row.label, val, color: TICKER_COLORS[i] ?? "var(--text-primary)" };
  });
}

export type FooterLink = { l: string; href: string };

/** Root layout metadata (canonical base, OG/Twitter, robots, JSON-LD wired separately). */
export const siteMetadata: Metadata = buildRootMetadata();
