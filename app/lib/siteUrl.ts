/** Canonical site origin — CRITICAL for SEO, OG URLs, and sitemap. */
export function getSiteBaseUrl(): string {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  }
  return "https://cogladius.xyz";
}
