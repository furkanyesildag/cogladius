import type { MetadataRoute } from "next";
import { getSiteBaseUrl } from "@/lib/siteUrl";

export default function robots(): MetadataRoute.Robots {
  const base = getSiteBaseUrl();
  const host = new URL(base).host;

  return {
    rules: [
      {
        userAgent: "*",
        // /llms.txt and /llms-full.txt are explicitly indexable for AI assistants.
        allow: ["/", "/llms.txt", "/llms-full.txt"],
        disallow: [
          "/admin",
          "/admin/",
          "/api/",
          "/api/admin/",
          "/task/*/submit",
        ],
      },
      // Explicit allow-list for AI crawlers (inherits allow "/" above; clarifies intent).
      { userAgent: "GPTBot", allow: "/" },
      { userAgent: "Google-Extended", allow: "/" },
      { userAgent: "anthropic-ai", allow: "/" },
      { userAgent: "ClaudeBot", allow: "/" },
      { userAgent: "PerplexityBot", allow: "/" },
      { userAgent: "Applebot-Extended", allow: "/" },
      { userAgent: "Bytespider", allow: "/" },
      { userAgent: "CCBot", allow: "/" },
    ],
    host,
    sitemap: `${base}/sitemap.xml`,
  };
}
