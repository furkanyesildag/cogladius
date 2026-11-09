/**
 * Gladiator League: best qualifier score per agent, and the ranking built on it.
 * Server-only. Keys:
 *
 *   league:best:<pubkey>   JSON { score, achievedAt, kind, tier }, permanent
 *   league:rank            sorted set, member = agent pubkey
 *
 * The rank score packs (score, earliest achievedAt) into one number, so ties go
 * to whoever reached the score first and ZADD GT alone keeps the best attempt.
 * Without Redis (local development) both live in-process, like lib/kv.ts.
 */
import { getAgentsByKeys } from "./agentRegistry";
import { kvCommit, kvGet, kvIncr, kvTtl } from "./kv";
import { getRedis } from "./redis";
import { DAY_SECONDS, MAX_ATTEMPTS_PER_DAY, resultKey, tierForScore, TIER_NAMES } from "./arena";

export const LEAGUE_MAX_ATTEMPTS_PER_DAY = MAX_ATTEMPTS_PER_DAY;
export const LEAGUE_RANK_KEY = "league:rank";
export const LEAGUE_LEADERBOARD_SIZE = 100;
export const LEAGUE_LEADERBOARD_CACHE_SECONDS = 300;
export const LEAGUE_LEADERBOARD_CACHE_KEY = "league:leaderboard-cache";

export const leagueBestKey = (pubkey: string) => `league:best:${pubkey}`;
export const leagueAttemptKey = (attemptId: string) => `league:attempt:${attemptId}`;
export const leagueAttemptLockKey = (attemptId: string) => `league:attempt-lock:${attemptId}`;
const agentDailyKey = (pubkey: string) => `league:attempts:agent:${pubkey}`;
const walletDailyKey = (wallet: string) => `league:attempts:wallet:${wallet}`;

export type LeagueAttempt = { agent: string; kind: string; issuedAt: number; expiresAt: number; used: boolean };
export type LeagueBest = { score: number; achievedAt: number; kind: string; tier: string | null };

// ── Daily attempts ───────────────────────────────────────────────────────────

/**
 * 3 per agent per 24h, and the same per wallet: a wallet can relink to a fresh
 * free agent, which would otherwise buy unlimited paid judge calls. Counted when
 * a task is issued, so a task cannot be read for free.
 */
export async function takeLeagueAttempt(agent: string, wallet: string): Promise<{ ok: true; left: number } | { ok: false; retryAfter: number }> {
  const keys = [agentDailyKey(agent), walletDailyKey(wallet)];
  const limited = async (): Promise<{ ok: false; retryAfter: number }> => {
    const ttls = await Promise.all(keys.map(async (k) => (Number((await kvGet(k)) ?? 0) >= LEAGUE_MAX_ATTEMPTS_PER_DAY ? (await kvTtl(k)) ?? DAY_SECONDS : 0)));
    return { ok: false, retryAfter: Math.max(...ttls, 1) };
  };
  const used = await Promise.all(keys.map((k) => kvGet(k)));
  if (used.some((u) => Number(u ?? 0) >= LEAGUE_MAX_ATTEMPTS_PER_DAY)) return limited();
  const counts = await Promise.all(keys.map((k) => kvIncr(k, DAY_SECONDS)));
  if (counts.some((c) => c > LEAGUE_MAX_ATTEMPTS_PER_DAY)) return limited();
  return { ok: true, left: LEAGUE_MAX_ATTEMPTS_PER_DAY - Math.max(...counts) };
}

export async function leagueAttemptsLeft(agent: string): Promise<number> {
  return Math.max(0, LEAGUE_MAX_ATTEMPTS_PER_DAY - Number((await kvGet(agentDailyKey(agent))) ?? 0));
}

export async function leagueRetryAfter(agent: string): Promise<number> {
  if ((await leagueAttemptsLeft(agent)) > 0) return 0;
  return (await kvTtl(agentDailyKey(agent))) ?? DAY_SECONDS;
}

/** Judged attempts allowed per rolling day across all agents: every one costs three LLM calls. */
export function leagueDailyJudgedCap(): number {
  const n = Number(process.env.LEAGUE_DAILY_JUDGED_CAP);
  return Number.isSafeInteger(n) && n > 0 ? n : 300;
}

export async function takeJudgeBudget(): Promise<boolean> {
  return (await kvIncr("league:judged-today", DAY_SECONDS)) <= leagueDailyJudgedCap();
}

// ── Ranking store ────────────────────────────────────────────────────────────

const g = globalThis as unknown as { __leagueRank?: Map<string, number> };
const memRank = (g.__leagueRank ??= new Map());

/** Far above any unix timestamp, so the score always dominates. */
const SCORE_SHIFT = 1e10;
const packRank = (score: number, at: number) => score * SCORE_SHIFT + (SCORE_SHIFT - at);
const unpackScore = (rank: number) => Math.floor(rank / SCORE_SHIFT);

/** Add to the sorted set if better than what is there. Returns the value now stored. */
async function rankAddIfGreater(pubkey: string, rank: number): Promise<number> {
  const r = getRedis();
  if (r) {
    await r.zadd(LEAGUE_RANK_KEY, { gt: true }, { score: rank, member: pubkey });
    return Number(await r.zscore(LEAGUE_RANK_KEY, pubkey));
  }
  const next = Math.max(memRank.get(pubkey) ?? -Infinity, rank);
  memRank.set(pubkey, next);
  return next;
}

async function rankPosition(pubkey: string): Promise<number | null> {
  const r = getRedis();
  if (r) {
    const i = await r.zrevrank(LEAGUE_RANK_KEY, pubkey);
    return i == null ? null : i + 1;
  }
  const mine = memRank.get(pubkey);
  if (mine === undefined) return null;
  return Array.from(memRank.values()).filter((v) => v > mine).length + 1;
}

async function rankTop(count: number): Promise<{ pubkey: string; rank: number }[]> {
  const r = getRedis();
  if (r) {
    const flat = await r.zrange<(string | number)[]>(LEAGUE_RANK_KEY, 0, count - 1, { rev: true, withScores: true });
    const out: { pubkey: string; rank: number }[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) out.push({ pubkey: String(flat[i]), rank: Number(flat[i + 1]) });
    return out;
  }
  return Array.from(memRank.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([pubkey, rank]) => ({ pubkey, rank }));
}

async function rankCount(): Promise<number> {
  const r = getRedis();
  return r ? r.zcard(LEAGUE_RANK_KEY) : memRank.size;
}

// ── Best score ───────────────────────────────────────────────────────────────

function parseBest(raw: unknown): LeagueBest | null {
  try {
    const o = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!o || typeof o !== "object" || !Number.isFinite((o as LeagueBest).score)) return null;
    return o as LeagueBest;
  } catch {
    return null;
  }
}

/** The agent's best qualifier result, or null if it has none. Throws when the store fails. */
export async function getLeagueBest(pubkey: string): Promise<LeagueBest | null> {
  return parseBest(await kvGet(leagueBestKey(pubkey)));
}

/** Tier of the wallet's arena result, the only tier record off chain. Null when unknown. */
export async function arenaTierOf(wallet: string): Promise<string | null> {
  try {
    const raw = await kvGet(resultKey(wallet));
    const result = raw ? JSON.parse(raw) : null;
    if (!result?.pass) return null;
    const tier = tierForScore(Number(result.avgScore));
    return tier === 0 ? null : TIER_NAMES[tier];
  } catch {
    return null;
  }
}

/** Record a judged score. Only a better score changes anything. */
export async function recordLeagueScore(
  pubkey: string,
  d: { score: number; kind: string; tier: string | null }
): Promise<{ best: number; improved: boolean; rank: number | null }> {
  const achievedAt = Math.floor(Date.now() / 1000);
  const packed = packRank(d.score, achievedAt);
  const stored = await rankAddIfGreater(pubkey, packed);
  const improved = stored === packed;
  if (improved) {
    const previous = await getLeagueBest(pubkey);
    const best: LeagueBest = { score: d.score, achievedAt, kind: d.kind, tier: d.tier ?? previous?.tier ?? null };
    await kvCommit({ set: { [leagueBestKey(pubkey)]: JSON.stringify(best) } });
  }
  return { best: unpackScore(stored), improved, rank: await rankPosition(pubkey) };
}

// ── Public leaderboard ───────────────────────────────────────────────────────

export const shortKey = (key: string) => `${key.slice(0, 4)}…${key.slice(-4)}`;

/**
 * A public display name. Names are chosen by agents, so anything that looks like
 * a full key, address or email is cut down before it reaches the public list.
 */
export function publicAgentName(name: unknown, pubkey: string): string {
  const clean = String(name ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\bG[A-Z2-7]{55}\b/g, (m) => shortKey(m))
    .replace(/\b0x[0-9a-fA-F]{40}\b/g, (m) => shortKey(m))
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[hidden]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
  return clean || shortKey(pubkey);
}

export type LeaderboardEntry = { rank: number; agent: string; agentKey: string; score: number; tier: string | null };

async function readBests(pubkeys: string[]): Promise<(LeagueBest | null)[]> {
  if (pubkeys.length === 0) return [];
  const r = getRedis();
  if (r) {
    const values = await r.mget<unknown[]>(...pubkeys.map(leagueBestKey));
    return values.map(parseBest);
  }
  return Promise.all(pubkeys.map(getLeagueBest));
}

/** Top agents by best qualifier score. Holds short keys only: no wallets, no full keys. */
export async function buildLeaderboard(): Promise<{ entrants: number; entries: LeaderboardEntry[] }> {
  // Read a few extra so banned agents do not leave the list short.
  const [top, entrants] = await Promise.all([rankTop(LEAGUE_LEADERBOARD_SIZE + 20), rankCount()]);
  const agents = await getAgentsByKeys(top.map((t) => t.pubkey));
  const byKey = new Map(agents.map((a) => [a.pubkey, a]));
  const visible = top.filter((t) => !byKey.get(t.pubkey)?.isBanned).slice(0, LEAGUE_LEADERBOARD_SIZE);
  const bests = await readBests(visible.map((t) => t.pubkey));
  return {
    entrants,
    entries: visible.map((t, i) => ({
      rank: i + 1,
      agent: publicAgentName(byKey.get(t.pubkey)?.name, t.pubkey),
      agentKey: shortKey(t.pubkey),
      score: unpackScore(t.rank),
      tier: bests[i]?.tier ?? null,
    })),
  };
}
