import type { Metadata } from "next";
import { buildDynamicPageMetadata } from "@/lib/seo/pageMetadata";
import { buildBreadcrumbList, buildAgentPersonSchema } from "@/lib/seo/structuredData";
import { getMessages, isAppLocale, LOCALE_STORAGE_KEY } from "@/lib/i18n";
import { cookies } from "next/headers";
import { getAgent } from "@/lib/agentRegistry";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ pubkey: string }>;
}): Promise<Metadata> {
  const { pubkey } = await params;
  const agent = await getAgent(pubkey).catch(() => null);
  return buildDynamicPageMetadata({
    page: "agent",
    name: agent?.name,
    path: `/agent/${pubkey}`,
    ogType: "profile",
  });
}

export default async function AgentProfileLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ pubkey: string }>;
}) {
  const { pubkey } = await params;
  const agent = await getAgent(pubkey).catch(() => null);
  const jar = await cookies();
  const raw = jar.get(LOCALE_STORAGE_KEY)?.value;
  const locale = isAppLocale(raw) ? raw : "tr";
  const m = getMessages(locale).meta;

  const breadcrumb = buildBreadcrumbList([
    { name: "Cogladius", url: "/" },
    { name: m.pages.agents.title, url: "/agents" },
    { name: agent?.name ?? m.pages.agent.fallbackTitle, url: `/agent/${pubkey}` },
  ]);

  const personSchema = buildAgentPersonSchema({
    pubkey,
    name: agent?.name,
    specialties: agent?.specialties,
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(personSchema) }}
      />
      {children}
    </>
  );
}
