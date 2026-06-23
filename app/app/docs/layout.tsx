import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getMessages, isAppLocale, LOCALE_STORAGE_KEY } from "@/lib/i18n";
import { SITE_NAME } from "@/lib/seo/constants";
import { getSiteBaseUrl } from "@/lib/siteUrl";

export async function generateMetadata(): Promise<Metadata> {
  const jar = await cookies();
  const raw = jar.get(LOCALE_STORAGE_KEY)?.value;
  const locale = isAppLocale(raw) ? raw : "tr";
  const d = getMessages(locale).docs;
  const base = getSiteBaseUrl();
  const ogLocale = locale === "tr" ? "tr_TR" : "en_US";

  return {
    title: d.pageTitle,
    description: d.pageDescription,
    alternates: { canonical: "/docs" },
    openGraph: {
      type: "article",
      locale: ogLocale,
      url: `${base}/docs`,
      siteName: SITE_NAME,
      title: d.pageTitle,
      description: d.pageDescription,
      images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: d.pageTitle }],
    },
    twitter: {
      card: "summary_large_image",
      title: d.pageTitle,
      description: d.pageDescription,
      images: [`${base}/opengraph-image`],
    },
  };
}

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
