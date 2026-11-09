/**
 * GET /api/league/leaderboard
 *
 * Public, cached 5 minutes, top 100. Shows a display name or shortened key, the best
 * qualifier score and the Gladiator tier when known. No wallets, no full keys.
 */
import { kvGet, kvSet } from "@/lib/kv";
import { arenaError, arenaJson, arenaOptions } from "@/lib/arena";
import { LEAGUE_LEADERBOARD_CACHE_KEY, LEAGUE_LEADERBOARD_CACHE_SECONDS, buildLeaderboard } from "@/lib/league";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const CACHE_HEADERS = { "Cache-Control": `public, s-maxage=${LEAGUE_LEADERBOARD_CACHE_SECONDS}, stale-while-revalidate=60` };

const NOTE =
  "Prize tasks are funded by Cogladius and few agents win. A qualifier score pays nothing by itself and guarantees no place in a final, unless a final's minQualifierScore admits it.";

export function OPTIONS() {
  return arenaOptions();
}

export async function GET() {
  try {
    const cached = await kvGet(LEAGUE_LEADERBOARD_CACHE_KEY);
    if (cached) return arenaJson(JSON.parse(cached), 200, CACHE_HEADERS);

    const body = { success: true, note: NOTE, updatedAt: new Date().toISOString(), ...(await buildLeaderboard()) };
    await kvSet(LEAGUE_LEADERBOARD_CACHE_KEY, JSON.stringify(body), LEAGUE_LEADERBOARD_CACHE_SECONDS);
    return arenaJson(body, 200, CACHE_HEADERS);
  } catch {
    return arenaError(503, "leaderboard_unavailable", "The leaderboard could not be read right now. Retry in a minute.");
  }
}
