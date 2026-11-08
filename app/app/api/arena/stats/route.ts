/**
 * GET /api/arena/stats → { attempts, wrongResults, maxAttemptsPerDay }
 *
 * Counters for the closed distribution test, read from redis (`arena:stats`).
 */

import {
  MAX_ATTEMPTS_PER_DAY,
  arenaJson,
  arenaNotReady,
  arenaOptions,
  isDryRun,
  statsRead,
} from "@/lib/arena";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export function OPTIONS() {
  return arenaOptions();
}

export async function GET() {
  const notReady = arenaNotReady(false);
  if (notReady) return notReady;

  const { attempts, wrongResults } = await statsRead();
  return arenaJson(
    {
      success: true,
      attempts,
      wrongResults,
      maxAttemptsPerDay: MAX_ATTEMPTS_PER_DAY,
      ...(isDryRun() ? { dryRun: true } : {}),
    },
    200,
    { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" }
  );
}
