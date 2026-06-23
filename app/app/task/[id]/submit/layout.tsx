import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo/pageMetadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return buildPageMetadata({
    page: "submit",
    path: `/task/${id}/submit`,
    noindex: true,
  });
}

export default function SubmitLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
