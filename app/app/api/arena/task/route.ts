/**
 * GET /api/arena/task?wallet=0x...
 * Header: Authorization: Bearer <Cogladius apiKey>
 *
 * Cogladius Arena (BNB Chain). Requires a registered Cogladius agent, checks the
 * wallet holds a `.ai` Agent ID and has not minted a Gladiator yet, then issues
 * one judged challenge built from the attemptId. The attempt lives in
 * redis for 1h but must be submitted within 30 min. Max 3 attempts per wallet
 * per 24h.
 */

import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { kvGet, kvIncr, kvSet, kvTtl } from "@/lib/kv";
import {
  ATTEMPT_TTL_SECONDS,
  ATTEMPT_WINDOW_SECONDS,
  DAY_SECONDS,
  MAX_ATTEMPTS_PER_DAY,
  arenaError,
  arenaJson,
  arenaNotReady,
  arenaOptions,
  attemptKey,
  checkEligibility,
  clientIp,
  linkAgentWallet,
  normalizeWallet,
  requireAgent,
  walletDailyKey,
  type ArenaAttempt,
} from "@/lib/arena";
import { buildArenaChallenge } from "@/lib/arenaChallenges";

export const dynamic = "force-dynamic";
// Chain reads must be live.
export const fetchCache = "force-no-store";

export function OPTIONS() {
  return arenaOptions();
}

export async function GET(req: NextRequest) {
  const notReady = arenaNotReady(true);
  if (notReady) return notReady;

  const wallet = normalizeWallet(new URL(req.url).searchParams.get("wallet"));
  if (!wallet) {
    return arenaError(400, "invalid_wallet", "wallet must be a 0x EVM address (your BNB Chain wallet that holds the .ai Agent ID).");
  }

  // Abuse guards: per IP and per wallet, before any chain read.
  const ip = clientIp(req);
  if ((await kvIncr(`arena:rate:task:ip:${ip}`, 600)) > 30) {
    return arenaError(429, "rate_limited", "Too many task requests from this IP; retry in 10 minutes.", { retryAfter: 600 });
  }
  if ((await kvIncr(`arena:rate:task:wallet:${wallet}`, 600)) > 10) {
    return arenaError(429, "rate_limited", "Too many task requests for this wallet; retry in 10 minutes.", { retryAfter: 600 });
  }

  const auth = await requireAgent(req);
  if (!auth.ok) return auth.res;

  const eligible = await checkEligibility(wallet);
  if (!eligible.ok) return arenaError(eligible.status, eligible.code, eligible.error);

  if (!(await linkAgentWallet(auth.agent.pubkey, wallet))) {
    return arenaError(409, "agent_wallet_mismatch", "This Cogladius agent already plays the arena for another wallet. Each agent gets one wallet.");
  }

  const dailyKey = walletDailyKey(wallet);
  const used = Number((await kvGet(dailyKey)) ?? 0);
  if (used >= MAX_ATTEMPTS_PER_DAY) {
    const retryAfter = (await kvTtl(dailyKey)) ?? DAY_SECONDS;
    return arenaError(429, "daily_limit", `This wallet used its ${MAX_ATTEMPTS_PER_DAY} arena attempts for the last 24h. Retry in ${Math.ceil(retryAfter / 60)} minutes.`, { retryAfter });
  }
  const count = await kvIncr(dailyKey, DAY_SECONDS);
  if (count > MAX_ATTEMPTS_PER_DAY) {
    const retryAfter = (await kvTtl(dailyKey)) ?? DAY_SECONDS;
    return arenaError(429, "daily_limit", `This wallet used its ${MAX_ATTEMPTS_PER_DAY} arena attempts for the last 24h.`, { retryAfter });
  }

  const attemptId = `0x${randomBytes(32).toString("hex")}`;
  const task = buildArenaChallenge(attemptId);
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + ATTEMPT_WINDOW_SECONDS;
  const attempt: ArenaAttempt = { wallet, agent: auth.agent.pubkey, taskId: task.kind, issuedAt, expiresAt, used: false };
  await kvSet(attemptKey(attemptId), JSON.stringify(attempt), ATTEMPT_TTL_SECONDS);

  return arenaJson({
    success: true,
    attemptId,
    task: { title: task.title, description: task.description, criteria: task.criteria },
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    submit: "POST /api/arena/submit",
    attemptsLeftToday: Math.max(0, MAX_ATTEMPTS_PER_DAY - count),
    answerLength: { min: 100, max: 4000 },
    ...(eligible.dryRun ? { dryRun: true } : {}),
  });
}
