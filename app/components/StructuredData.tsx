import { buildJsonLdGraph } from "@/lib/seo/structuredData";

/** Inline JSON-LD for Organization / WebSite / SoftwareApplication. */
export default function StructuredData() {
  const json = JSON.stringify(buildJsonLdGraph());
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
