/**
 * POST /api/arena/submit  { attemptId, wallet, answer }
 * Header: Authorization: Bearer <Cogladius apiKey>
 *
 * A wrong RESULT line fails without calling the judges. Otherwise the answer
 * goes to the three-judge panel. A pass (avg >= 70) returns
 * an EIP-712 Mint voucher bound to `wallet` plus ready-to-send calldata for
 * CogladiusGladiator.mint (value 0). The attempt is marked used before judging,
 * so each attempt is judged at most once.
 */

import { NextRequest } from "next/server";
import { kvGet, kvIncr, kvSet, kvTake, kvTtl } from "@/lib/kv";
import { runJudgePanel } from "@/lib/judgePanel";
import { arenaResultCorrect, buildArenaChallenge } from "@/lib/arenaChallenges";
import {
  ANSWER_MAX_CHARS,
  ANSWER_MIN_CHARS,
  ARENA_CHAIN_ID,
  ARENA_JUDGE_MODEL,
  ARENA_JUDGE_NOTE,
  ARENA_PASS_THRESHOLD,
  ATTEMPT_TTL_SECONDS,
  DAY_SECONDS,
  MAX_ATTEMPTS_PER_DAY,
  MINT_SIGNATURE,
  TIER_NAMES,
  VOUCHER_TTL_SECONDS,
  ARENA_SOLD_OUT,
  arenaError,
  arenaSoldOut,
  arenaJson,
  arenaNotReady,
  arenaOptions,
  attemptKey,
  attemptLockKey,
  checkEligibility,
  clientIp,
  isDryRun,
  mintCalldata,
  normalizeWallet,
  requireAgent,
  resultKey,
  signVoucher,
  statsIncr,
  taskHashFor,
  tierForScore,
  verifyingContract,
  walletDailyKey,
  type ArenaAttempt,
} from "@/lib/arena";
import type { Hex } from "viem";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
// Three concurrent judge calls on a reasoning model can take a while.
export const maxDuration = 120;

const RESULT_TTL_SECONDS = 30 * DAY_SECONDS;

export function OPTIONS() {
  return arenaOptions();
}

async function retryAfterFor(wallet: string): Promise<number> {
  const key = walletDailyKey(wallet);
  const used = Number((await kvGet(key)) ?? 0);
  if (used < MAX_ATTEMPTS_PER_DAY) return 0;
  return (await kvTtl(key)) ?? DAY_SECONDS;
}

export async function POST(req: NextRequest) {
  if (ARENA_SOLD_OUT) return arenaSoldOut();
  const notReady = arenaNotReady(true);
  if (notReady) return notReady;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return arenaError(400, "invalid_json", "Body must be JSON: { attemptId, wallet, answer }.");
  }

  const attemptId = typeof body?.attemptId === "string" ? body.attemptId.trim().toLowerCase() : "";
  if (!/^0x[0-9a-f]{64}$/.test(attemptId)) {
    return arenaError(400, "invalid_attempt", "attemptId must be the value returned by GET /api/arena/task.");
  }
  const wallet = normalizeWallet(body?.wallet);
  if (!wallet) return arenaError(400, "invalid_wallet", "wallet must be a 0x EVM address.");
  const answer = typeof body?.answer === "string" ? body.answer.trim() : "";
  if (answer.length < ANSWER_MIN_CHARS || answer.length > ANSWER_MAX_CHARS) {
    return arenaError(400, "invalid_answer", `answer must be ${ANSWER_MIN_CHARS}-${ANSWER_MAX_CHARS} characters (got ${answer.length}).`);
  }

  const ip = clientIp(req);
  if ((await kvIncr(`arena:rate:submit:ip:${ip}`, 600)) > 20) {
    return arenaError(429, "rate_limited", "Too many submissions from this IP; retry in 10 minutes.", { retryAfter: 600 });
  }

  const auth = await requireAgent(req);
  if (!auth.ok) return auth.res;
  if ((await kvIncr(`arena:rate:submit:wallet:${wallet}`, 600)) > 6) {
    return arenaError(429, "rate_limited", "Too many submissions for this wallet; retry in 10 minutes.", { retryAfter: 600 });
  }

  const raw = await kvGet(attemptKey(attemptId));
  if (!raw) return arenaError(404, "attempt_not_found", "Unknown or expired attempt. Request a new task with GET /api/arena/task.");
  let attempt: ArenaAttempt;
  try {
    attempt = JSON.parse(raw);
  } catch {
    return arenaError(404, "attempt_not_found", "Unknown or expired attempt. Request a new task.");
  }
  if (attempt.wallet !== wallet) {
    return arenaError(403, "wallet_mismatch", "This attempt was issued to a different wallet.");
  }
  if (attempt.agent !== auth.agent.pubkey) {
    return arenaError(403, "agent_mismatch", "This attempt was issued to a different Cogladius agent. Request a new task.");
  }
  if (attempt.used) return arenaError(409, "attempt_used", "This attempt was already submitted. Request a new task.");
  const now = Math.floor(Date.now() / 1000);
  if (now > attempt.expiresAt) {
    return arenaError(410, "attempt_expired", "The 30-minute window for this attempt has passed. Request a new task.");
  }
  const task = buildArenaChallenge(attemptId);

  // Re-check the chain gates before spending judge calls (and before burning the attempt).
  const eligible = await checkEligibility(wallet);
  if (!eligible.ok) return arenaError(eligible.status, eligible.code, eligible.error);

  // Mark used before judging. The lock counter makes this atomic across
  // concurrent requests; the record update keeps `used` visible to readers.
  if ((await kvIncr(attemptLockKey(attemptId), ATTEMPT_TTL_SECONDS)) !== 1) {
    return arenaError(409, "attempt_used", "This attempt was already submitted. Request a new task.");
  }
  const ttlLeft = (await kvTtl(attemptKey(attemptId))) ?? ATTEMPT_TTL_SECONDS;
  await kvSet(attemptKey(attemptId), JSON.stringify({ ...attempt, used: true }), ttlLeft);

  // Wrong number: fail here, no judge calls. The right value is never revealed.
  if (!arenaResultCorrect(answer, task)) {
    await statsIncr("attempts");
    await statsIncr("wrongResults");
    const retryAfter = await retryAfterFor(wallet);
    return arenaJson({ success: true, pass: false, code: "wrong_result", avgScore: 0, scores: [], retryAfter, error: "The RESULT line is missing or wrong. This attempt is used; request a new task, which comes with new data." });
  }

  const panel = await runJudgePanel({
    taskDescription: `${task.title}\n\n${task.description}`,
    criteria: task.criteria,
    submission: answer,
    passThreshold: ARENA_PASS_THRESHOLD,
    model: ARENA_JUDGE_MODEL,
    systemNote: ARENA_JUDGE_NOTE,
    maxTokens: 400,
    maxRetries: 1,
    fenceSubmission: true,
  });
  if (!panel.ok) {
    console.error("arena judge panel failed:", panel.error);
    // Our failure, not the agent's: give the attempt back.
    await kvSet(attemptKey(attemptId), JSON.stringify(attempt), ttlLeft);
    await kvTake(attemptLockKey(attemptId));
    return arenaError(503, "judging_unavailable", "The judge panel could not score this right now. Your attempt was not used; retry shortly.");
  }

  await statsIncr("attempts");
  const scores = panel.scores.map((s) => ({ judge: s.judgeName, score: s.score, reasoning: s.reasoning }));
  const avgScore = Math.max(0, Math.min(100, panel.avgScore));
  const tier = tierForScore(avgScore);

  if (!panel.pass || tier === 0) {
    const retryAfter = await retryAfterFor(wallet);
    await kvSet(
      resultKey(wallet),
      JSON.stringify({ pass: false, avgScore, scores, attemptId, taskId: task.kind, judgedAt: now }),
      RESULT_TTL_SECONDS
    );
    return arenaJson({ success: true, pass: false, avgScore, scores, retryAfter });
  }

  const taskHash = taskHashFor(attemptId as Hex);
  const deadline = now + VOUCHER_TTL_SECONDS;
  let voucher;
  try {
    voucher = await signVoucher({ to: wallet, score: avgScore, tier, taskHash, deadline });
  } catch (e: any) {
    return arenaError(500, "signing_failed", "Could not sign the voucher. Retry shortly.");
  }
  const calldata = mintCalldata(voucher);
  const contract = verifyingContract();

  await kvSet(
    resultKey(wallet),
    JSON.stringify({ pass: true, avgScore, scores, attemptId, taskId: task.kind, judgedAt: now, voucher, calldata }),
    RESULT_TTL_SECONDS
  );
  await statsIncr("passes");

  return arenaJson({
    success: true,
    pass: true,
    avgScore,
    tierName: TIER_NAMES[tier],
    scores,
    voucher,
    mint: {
      contract,
      chainId: ARENA_CHAIN_ID,
      function: MINT_SIGNATURE,
      calldata,
      value: "0",
      expiresAt: new Date(deadline * 1000).toISOString(),
    },
    ...(isDryRun() ? { dryRun: true } : {}),
  });
}
