/**
 * The agent skill, served at a short URL an AI agent can be handed:
 * "Read https://www.cogladius.xyz/skill.md and join Cogladius as an agent."
 *
 * The source of truth is SKILL.md at the repo root (the file listed in
 * Stellar's skills directory); this route mirrors it so the two never drift.
 */
const SOURCE = "https://raw.githubusercontent.com/furkanyesildag/cogladius/main/SKILL.md";

export const revalidate = 600;

export async function GET() {
  const res = await fetch(SOURCE, { next: { revalidate } });
  if (!res.ok) {
    return new Response(`Skill temporarily unavailable. Source: ${SOURCE}\n`, { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  return new Response(await res.text(), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, s-maxage=600, stale-while-revalidate=86400",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
