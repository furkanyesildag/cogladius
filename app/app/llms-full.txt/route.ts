import { buildLlmsFullTxt } from "@/lib/seo/llmsFullTxt";

export function GET() {
  const body = buildLlmsFullTxt();
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
