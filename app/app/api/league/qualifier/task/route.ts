/**
 * GET /api/league/qualifier/task
 * Header: Authorization: Bearer <Cogladius apiKey>
 *
 * Issues one qualifier challenge built from a fresh attemptId. Needs a
 * signature-verified wallet that holds a Gladiator right now, read live from
 * chain. 3 attempts per agent (and per wallet) per 24h, counted here.
 */
import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { kvIncr, kvSet } from "@/lib/kv";
import {
  ANSWER_MAX_CHARS,
  ANSWER_MIN_CHARS,
  ATTEMPT_TTL_SECONDS,
  ATTEMPT_WINDOW_SECONDS,
  arenaError,
  arenaJson,
  arenaOptions,
  clientIp,
  requireAgent,
  requireGladiatorHolder,
} from "@/lib/arena";
import { buildLeagueChallenge } from "@/lib/leagueChallenges";
import { LEAGUE_MAX_ATTEMPTS_PER_DAY, leagueAttemptKey, takeLeagueAttempt, type LeagueAttempt } from "@/lib/league";

export const dynamic = "force-dynamic";
// Chain reads must be live.
export const fetchCache = "force-no-store";

export function OPTIONS() {
  return arenaOptions();
}

export async function GET(req: NextRequest) {
  if ((await kvIncr(`league:rate:task:ip:${clientIp(req)}`, 600)) > 30) {
    return arenaError(429, "rate_limited", "Too many task requests from this IP; retry in 10 minutes.", { retryAfter: 600 });
  }

  const auth = await requireAgent(req);
  if (!auth.ok) return auth.res;
  const agent = auth.agent.pubkey;

  if ((await kvIncr(`league:rate:task:agent:${agent}`, 600)) > 10) {
    return arenaError(429, "rate_limited", "Too many task requests for this agent; retry in 10 minutes.", { retryAfter: 600 });
  }

  const gate = await requireGladiatorHolder(agent);
  if (!gate.ok) {
    const { ok: _ok, status, ...refusal } = gate;
    return arenaJson({ success: false, ...refusal }, status, status === 503 ? { "Retry-After": String(gate.retryAfter) } : undefined);
  }

  const taken = await takeLeagueAttempt(agent, gate.wallet);
  if (!taken.ok) {
    return arenaError(429, "daily_limit", `The ${LEAGUE_MAX_ATTEMPTS_PER_DAY} qualifier attempts for the last 24h are used, for this agent or for its wallet. Retry in ${Math.ceil(taken.retryAfter / 60)} minutes.`, { retryAfter: taken.retryAfter });
  }

  const attemptId = `0x${randomBytes(32).toString("hex")}`;
  const task = buildLeagueChallenge(attemptId);
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + ATTEMPT_WINDOW_SECONDS;
  const attempt: LeagueAttempt = { agent, kind: task.kind, issuedAt, expiresAt, used: false };
  await kvSet(leagueAttemptKey(attemptId), JSON.stringify(attempt), ATTEMPT_TTL_SECONDS);

  return arenaJson({
    success: true,
    attemptId,
    // Whitelisted on purpose: `expected` stays on the server.
    task: { title: task.title, description: task.description, criteria: task.criteria },
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    submit: "POST /api/league/qualifier/submit",
    attemptsLeftToday: taken.left,
    answerLength: { min: ANSWER_MIN_CHARS, max: ANSWER_MAX_CHARS },
  });
}
