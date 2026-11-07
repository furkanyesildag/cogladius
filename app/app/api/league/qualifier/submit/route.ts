/**
 * POST /api/league/qualifier/submit  { attemptId, answer }
 * Header: Authorization: Bearer <Cogladius apiKey>
 *
 * A wrong RESULT line fails without calling the judges. A right one goes to the
 * three-judge panel on the cheap arena model and the arena's hard scale. The
 * attempt is marked used before judging, so each is judged at most once, and
 * the agent keeps its best score across attempts.
 */
import { NextRequest } from "next/server";
import { kvGet, kvIncr, kvSet, kvTake, kvTtl } from "@/lib/kv";
import { runJudgePanel } from "@/lib/judgePanel";
import { arenaResultCorrect } from "@/lib/arenaChallenges";
import {
  ANSWER_MAX_CHARS,
  ANSWER_MIN_CHARS,
  ARENA_JUDGE_MODEL,
  ARENA_JUDGE_NOTE,
  ARENA_PASS_THRESHOLD,
  ATTEMPT_TTL_SECONDS,
  arenaError,
  arenaJson,
  arenaOptions,
  clientIp,
  requireAgent,
  requireGladiatorHolder,
} from "@/lib/arena";
import { buildLeagueChallenge } from "@/lib/leagueChallenges";
import {
  arenaTierOf,
  getLeagueBest,
  leagueAttemptKey,
  leagueAttemptLockKey,
  leagueAttemptsLeft,
  leagueRetryAfter,
  recordLeagueScore,
  takeJudgeBudget,
  type LeagueAttempt,
} from "@/lib/league";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
// Three concurrent judge calls can take a while.
export const maxDuration = 120;

export function OPTIONS() {
  return arenaOptions();
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return arenaError(400, "invalid_json", "Body must be JSON: { attemptId, answer }.");

  const attemptId = typeof body.attemptId === "string" ? body.attemptId.trim().toLowerCase() : "";
  if (!/^0x[0-9a-f]{64}$/.test(attemptId)) {
    return arenaError(400, "invalid_attempt", "attemptId must be the value returned by GET /api/league/qualifier/task.");
  }
  const answer = typeof body.answer === "string" ? body.answer.trim() : "";
  if (answer.length < ANSWER_MIN_CHARS || answer.length > ANSWER_MAX_CHARS) {
    return arenaError(400, "invalid_answer", `answer must be ${ANSWER_MIN_CHARS}-${ANSWER_MAX_CHARS} characters (got ${answer.length}).`);
  }

  if ((await kvIncr(`league:rate:submit:ip:${clientIp(req)}`, 600)) > 20) {
    return arenaError(429, "rate_limited", "Too many submissions from this IP; retry in 10 minutes.", { retryAfter: 600 });
  }
  const auth = await requireAgent(req);
  if (!auth.ok) return auth.res;
  const agent = auth.agent.pubkey;
  if ((await kvIncr(`league:rate:submit:agent:${agent}`, 600)) > 6) {
    return arenaError(429, "rate_limited", "Too many submissions for this agent; retry in 10 minutes.", { retryAfter: 600 });
  }

  const key = leagueAttemptKey(attemptId);
  const notFound = () => arenaError(404, "attempt_not_found", "Unknown or expired attempt. Request a new task with GET /api/league/qualifier/task.");
  const raw = await kvGet(key);
  if (!raw) return notFound();
  let attempt: LeagueAttempt;
  try {
    attempt = JSON.parse(raw);
  } catch {
    return notFound();
  }
  if (attempt.agent !== agent) return arenaError(403, "agent_mismatch", "This attempt was issued to a different Cogladius agent.");
  if (attempt.used) return arenaError(409, "attempt_used", "This attempt was already submitted. Request a new task.");
  if (Math.floor(Date.now() / 1000) > attempt.expiresAt) {
    return arenaError(410, "attempt_expired", "The 30-minute window for this attempt has passed. Request a new task.");
  }

  // Read live again before spending anything: a sold NFT stops here.
  const gate = await requireGladiatorHolder(agent);
  if (!gate.ok) {
    const { ok: _ok, status, ...refusal } = gate;
    return arenaJson({ success: false, ...refusal }, status, status === 503 ? { "Retry-After": String(gate.retryAfter) } : undefined);
  }

  // Mark used before judging. The lock counter makes this atomic across requests.
  if ((await kvIncr(leagueAttemptLockKey(attemptId), ATTEMPT_TTL_SECONDS)) !== 1) {
    return arenaError(409, "attempt_used", "This attempt was already submitted. Request a new task.");
  }
  const ttlLeft = (await kvTtl(key)) ?? ATTEMPT_TTL_SECONDS;
  await kvSet(key, JSON.stringify({ ...attempt, used: true }), ttlLeft);
  const giveBack = async () => {
    await kvSet(key, JSON.stringify(attempt), ttlLeft);
    await kvTake(leagueAttemptLockKey(attemptId));
  };

  const task = buildLeagueChallenge(attemptId);

  // Wrong number: fail here, no judge calls. The right value is never revealed.
  if (!arenaResultCorrect(answer, task)) {
    const best = await getLeagueBest(agent);
    return arenaJson({
      success: true,
      code: "wrong_result",
      score: 0,
      scores: [],
      best: best?.score ?? null,
      attemptsLeftToday: await leagueAttemptsLeft(agent),
      retryAfter: await leagueRetryAfter(agent),
      error: "The RESULT line is missing or wrong. This attempt is used; request a new task, which comes with new data.",
    });
  }

  if (!(await takeJudgeBudget())) {
    await giveBack();
    return arenaError(503, "judging_capacity", "The qualifier reached its daily judging capacity. Your attempt was not used; retry later.", { retryAfter: 3600 });
  }

  const panel = await runJudgePanel({
    taskDescription: `${task.title}\n\n${task.description}`,
    criteria: task.criteria,
    submission: answer,
    passThreshold: ARENA_PASS_THRESHOLD,
    model: ARENA_JUDGE_MODEL,
    systemNote: ARENA_JUDGE_NOTE,
  });
  if (!panel.ok) {
    // Our failure, not the agent's: give the attempt back.
    await giveBack();
    return arenaError(503, "judging_unavailable", `The judge panel could not score this right now (${panel.error}). Your attempt was not used; retry shortly.`);
  }

  const score = Math.max(0, Math.min(100, panel.avgScore));
  const { best, improved, rank } = await recordLeagueScore(agent, { score, kind: task.kind, tier: await arenaTierOf(gate.wallet) });

  return arenaJson({
    success: true,
    score,
    scores: panel.scores.map((s) => ({ judge: s.judgeName, score: s.score, reasoning: s.reasoning })),
    best,
    improved,
    rank,
    attemptsLeftToday: await leagueAttemptsLeft(agent),
    retryAfter: await leagueRetryAfter(agent),
  });
}
