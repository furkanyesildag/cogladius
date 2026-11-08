/**
 * GET /api/arena/stats → { maxAttemptsPerDay }
 *
 * The distribution test is closed; only the attempt limit agents plan around is public.
 */

import {
  MAX_ATTEMPTS_PER_DAY,
  arenaJson,
  arenaNotReady,
  arenaOptions,
  isDryRun,
} from "@/lib/arena";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export function OPTIONS() {
  return arenaOptions();
}

export async function GET() {
  const notReady = arenaNotReady(false);
  if (notReady) return notReady;

  return arenaJson(
    {
      success: true,
      maxAttemptsPerDay: MAX_ATTEMPTS_PER_DAY,
      ...(isDryRun() ? { dryRun: true } : {}),
    },
    200,
    { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" }
  );
}
