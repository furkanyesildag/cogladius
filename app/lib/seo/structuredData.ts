import { getSiteBaseUrl } from "@/lib/siteUrl";
import { SITE_NAME, SITE_TAGLINE_EN } from "./constants";

function parseSameAs(): string[] {
  const raw = process.env.NEXT_PUBLIC_SEO_SAME_AS;
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * JSON-LD graph for Organization + WebSite + SoftwareApplication + WebApplication.
 * Helps search engines and AI crawlers understand entity relationships.
 */
export function buildJsonLdGraph(): Record<string, unknown> {
  const base = getSiteBaseUrl();
  const logo = `${base}/logo.svg`;
  const sameAs = parseSameAs();

  const organization: Record<string, unknown> = {
    "@type": "Organization",
    "@id": `${base}/#organization`,
    name: SITE_NAME,
    url: base,
    logo: { "@type": "ImageObject", url: logo },
    description: SITE_TAGLINE_EN,
  };
  if (sameAs.length) organization.sameAs = sameAs;

  const website = {
    "@type": "WebSite",
    "@id": `${base}/#website`,
    url: base,
    name: SITE_NAME,
    description: SITE_TAGLINE_EN,
    publisher: { "@id": `${base}/#organization` },
    inLanguage: ["tr", "en"],
  };

  const webApplication = {
    "@type": "WebApplication",
    "@id": `${base}/#webapp`,
    name: SITE_NAME,
    applicationCategory: "DeveloperApplication",
    applicationSubCategory: "AI Agent Marketplace",
    operatingSystem: "Web",
    description: SITE_TAGLINE_EN,
    url: base,
    publisher: { "@id": `${base}/#organization` },
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    },
    featureList: [
      "Stellar on-chain task rewards",
      "OpenClaw-compatible agent HTTP API",
      "x402 micropayments for live data",
      "Independent multi-AI judge panel",
      "Stake-based dispute / court flow",
      "NEXUS multi-agent orchestrator",
    ],
  };

  return {
    "@context": "https://schema.org",
    "@graph": [organization, website, webApplication],
  };
}

// ── Per-page schema helpers ─────────────────────────────────────────────────

export interface BreadcrumbItem {
  name: string;
  url: string;
}

/** BreadcrumbList for inner pages — Google shows them in SERP. */
export function buildBreadcrumbList(items: BreadcrumbItem[]): Record<string, unknown> {
  const base = getSiteBaseUrl();
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: item.name,
      item: item.url.startsWith("http") ? item.url : `${base}${item.url}`,
    })),
  };
}

/** Article schema for /docs and similar long-form pages. */
export function buildArticleSchema(opts: {
  headline: string;
  description: string;
  url: string;
  datePublished?: string;
  dateModified?: string;
  inLanguage?: string;
}): Record<string, unknown> {
  const base = getSiteBaseUrl();
  const fullUrl = opts.url.startsWith("http") ? opts.url : `${base}${opts.url}`;
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: opts.headline,
    description: opts.description,
    url: fullUrl,
    image: `${base}/opengraph-image`,
    datePublished: opts.datePublished ?? new Date().toISOString(),
    dateModified: opts.dateModified ?? new Date().toISOString(),
    inLanguage: opts.inLanguage ?? "tr",
    author: { "@id": `${base}/#organization` },
    publisher: { "@id": `${base}/#organization` },
    mainEntityOfPage: { "@type": "WebPage", "@id": fullUrl },
  };
}

/** Person schema for agent profile pages. */
export function buildAgentPersonSchema(opts: {
  pubkey: string;
  name?: string;
  description?: string;
  specialties?: string[];
}): Record<string, unknown> {
  const base = getSiteBaseUrl();
  const url = `${base}/agent/${opts.pubkey}`;
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": `${url}#agent`,
    identifier: opts.pubkey,
    name: opts.name ?? `Agent ${opts.pubkey.slice(0, 8)}…`,
    description: opts.description,
    url,
    knowsAbout: opts.specialties,
    affiliation: { "@id": `${base}/#organization` },
  };
}

/** Service / JobPosting-style schema for individual tasks. */
export function buildTaskSchema(opts: {
  id: string | number;
  title: string;
  description?: string;
  rewardSol?: number;
  deadlineIso?: string;
  postedIso?: string;
  status?: string;
}): Record<string, unknown> {
  const base = getSiteBaseUrl();
  const url = `${base}/task/${opts.id}`;
  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Service",
    "@id": `${url}#task`,
    name: opts.title,
    description: opts.description ?? opts.title,
    url,
    serviceType: "AI agent task",
    provider: { "@id": `${base}/#organization` },
  };
  if (opts.rewardSol !== undefined) {
    schema.offers = {
      "@type": "Offer",
      price: opts.rewardSol,
      priceCurrency: "XLM",
      availability:
        opts.status === "Open"
          ? "https://schema.org/InStock"
          : "https://schema.org/SoldOut",
      validThrough: opts.deadlineIso,
    };
  }
  if (opts.postedIso) schema.datePosted = opts.postedIso;
  return schema;
}
