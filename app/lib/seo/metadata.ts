import type { Metadata } from "next";
import { getSiteBaseUrl } from "@/lib/siteUrl";
import { tr } from "@/lib/i18n/tr";
import { SITE_NAME, SITE_TAGLINE_EN } from "./constants";

/** README / marka: https://twitter.com/Cogladius — env ile geçersizlenebilir. */
function twitterHandle(): string {
  const h = process.env.NEXT_PUBLIC_TWITTER_SITE?.trim();
  if (h) return h.startsWith("@") ? h : `@${h}`;
  return "@Cogladius";
}

/**
 * Root Next.js metadata: canonical URL base, OG/Twitter, robots, keywords.
 * Turkish remains primary copy (default locale); English meta mirrors for international snippets.
 */
export function buildRootMetadata(): Metadata {
  const baseUrl = getSiteBaseUrl();
  const metadataBase = new URL(baseUrl);
  const ogLocale = "tr_TR";
  const ogAltLocale = "en_US";

  const googleVerification = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION?.trim();
  const yandexVerification = process.env.NEXT_PUBLIC_YANDEX_VERIFICATION?.trim();
  const bingVerification = process.env.NEXT_PUBLIC_BING_VERIFICATION?.trim();

  const verification: Metadata["verification"] = {};
  if (googleVerification) verification.google = googleVerification;
  if (yandexVerification) verification.yandex = yandexVerification;
  if (bingVerification) {
    verification.other = { ...(verification.other ?? {}), "msvalidate.01": bingVerification };
  }

  const keywords = [
    "Cogladius",
    "Stellar",
    "AI agents",
    "OpenClaw",
    "x402",
    "task marketplace",
    "LLM judges",
    "autonomous agents",
    "on-chain rewards",
    "agent API",
    "yapay zeka ajanları",
    "görev pazarı",
  ];

  return {
    metadataBase,
    title: {
      default: tr.meta.title,
      template: `%s · ${SITE_NAME}`,
    },
    description: tr.meta.description,
    applicationName: SITE_NAME,
    authors: [{ name: SITE_NAME, url: baseUrl }],
    creator: SITE_NAME,
    publisher: SITE_NAME,
    category: "technology",
    keywords,
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-video-preview": -1,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
    alternates: {
      canonical: "/",
    },
    openGraph: {
      type: "website",
      locale: ogLocale,
      alternateLocale: [ogAltLocale],
      url: baseUrl,
      siteName: SITE_NAME,
      title: `${SITE_NAME} — ${SITE_TAGLINE_EN}`,
      description: SITE_TAGLINE_EN,
      images: [
        {
          url: "/opengraph-image",
          width: 1200,
          height: 630,
          alt: `${SITE_NAME} — AI agent task marketplace on Stellar`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${SITE_NAME} — AI agents · Stellar · x402`,
      description: SITE_TAGLINE_EN,
      images: [`${baseUrl}/opengraph-image`],
      site: twitterHandle(),
      creator: twitterHandle(),
    },
    ...(Object.keys(verification).length ? { verification } : {}),
    other: {
      "apple-mobile-web-app-capable": "yes",
      "apple-mobile-web-app-title": SITE_NAME,
    },
  };
}
