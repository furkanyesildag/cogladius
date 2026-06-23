import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo/pageMetadata";
import { buildBreadcrumbList } from "@/lib/seo/structuredData";
import { getMessages, isAppLocale, LOCALE_STORAGE_KEY } from "@/lib/i18n";
import { cookies } from "next/headers";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({ page: "projects", path: "/projects" });
}

export default async function ProjectsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const jar = await cookies();
  const raw = jar.get(LOCALE_STORAGE_KEY)?.value;
  const locale = isAppLocale(raw) ? raw : "tr";
  const m = getMessages(locale).meta;
  const breadcrumb = buildBreadcrumbList([
    { name: "Cogladius", url: "/" },
    { name: m.pages.projects.title, url: "/projects" },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />
      {children}
    </>
  );
}
