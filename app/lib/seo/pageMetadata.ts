/**
 * Helper for per-page metadata in (use client) routes.
 *
 * Each "use client" page gets a sibling `layout.tsx` server component that
 * calls `buildPageMetadata()`. This keeps SEO meta in the HTML head while
 * the actual page stays interactive on the client.
 */

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getMessages, isAppLocale, LOCALE_STORAGE_KEY, type AppLocale } from "@/lib/i18n";
import { SITE_NAME } from "./constants";
import { getSiteBaseUrl } from "@/lib/siteUrl";

export interface PageMetaInput {
  /** Path-based key into messages.meta.pages.* */
  page: "dashboard" | "agents" | "projects" | "tasks" | "submit";
  /** Canonical path (e.g. "/dashboard"). */
  path: string;
  /** OG type override (default "website"). */
  ogType?: "website" | "article" | "profile";
  /** Mark as noindex (e.g. form pages). */
  noindex?: boolean;
}

async function resolveLocale(): Promise<AppLocale> {
  const jar = await cookies();
  const raw = jar.get(LOCALE_STORAGE_KEY)?.value;
  return isAppLocale(raw) ? raw : "tr";
}

/** Build Metadata for a static route from i18n bundle. */
export async function buildPageMetadata(input: PageMetaInput): Promise<Metadata> {
  const locale = await resolveLocale();
  const m = getMessages(locale).meta;
  const page = m.pages[input.page];
  const base = getSiteBaseUrl();
  const ogLocale = locale === "tr" ? "tr_TR" : "en_US";

  const meta: Metadata = {
    title: page.title,
    description: page.description,
    alternates: { canonical: input.path },
    openGraph: {
      type: input.ogType ?? "website",
      locale: ogLocale,
      url: `${base}${input.path}`,
      siteName: SITE_NAME,
      title: page.title,
      description: page.description,
      images: [
        {
          url: `${input.path}/opengraph-image`,
          width: 1200,
          height: 630,
          alt: page.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
      images: [`${base}${input.path}/opengraph-image`],
    },
  };

  if (input.noindex) {
    meta.robots = { index: false, follow: true, nocache: true };
  }

  return meta;
}

export interface DynamicPageMetaInput {
  /** Page bundle key (agent or task). */
  page: "agent" | "task";
  /** Display name to interpolate into titleTemplate (%s). */
  name: string | undefined;
  /** Canonical path including the dynamic segment (e.g. "/agent/abc"). */
  path: string;
  /** Optional override description. */
  description?: string;
  ogType?: "website" | "article" | "profile";
}

/** Build Metadata for a dynamic route (agent profile, task detail). */
export async function buildDynamicPageMetadata(
  input: DynamicPageMetaInput,
): Promise<Metadata> {
  const locale = await resolveLocale();
  const m = getMessages(locale).meta;
  const page = m.pages[input.page];
  const base = getSiteBaseUrl();
  const ogLocale = locale === "tr" ? "tr_TR" : "en_US";

  const title = input.name
    ? page.titleTemplate.replace("%s", input.name)
    : page.fallbackTitle;
  const description = input.description ?? page.description;

  return {
    title,
    description,
    alternates: { canonical: input.path },
    openGraph: {
      type: input.ogType ?? "website",
      locale: ogLocale,
      url: `${base}${input.path}`,
      siteName: SITE_NAME,
      title,
      description,
      images: [
        {
          url: "/opengraph-image",
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${base}/opengraph-image`],
    },
  };
}
