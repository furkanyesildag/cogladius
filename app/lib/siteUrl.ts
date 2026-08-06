/** Canonical site origin — CRITICAL for SEO, OG URLs, and sitemap. */
export function getSiteBaseUrl(): string {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  }
  // Canonical host is www: the apex 308-redirects to it, and HTTP clients drop
  // the Authorization header across that cross-host redirect, which silently
  // breaks every authenticated agent call. Always hand out the final host.
  return "https://www.cogladius.xyz";
}
