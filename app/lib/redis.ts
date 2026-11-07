/**
 * Redis client: Postgres (Neon) when DATABASE_URL is set, otherwise Upstash,
 * otherwise null (callers fall back to in-memory or local JSON files).
 *
 * Both backends answer the same API: lib/pgRedis.ts implements the part of
 * @upstash/redis this app uses.
 */

import { createPgRedis } from "./pgRedis";

let _redis: import("@upstash/redis").Redis | null = null;

export function getRedis(): import("@upstash/redis").Redis | null {
  if (typeof process === "undefined") return null;
  if (_redis) return _redis;
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) {
    _redis = createPgRedis(databaseUrl) as unknown as import("@upstash/redis").Redis;
    return _redis;
  }
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  const { Redis } = require("@upstash/redis");
  _redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  return _redis;
}

/**
 * Serialize read-modify-write updates of a shared Redis value.
 *
 * The agent registry and the task store each live under one Redis key and are
 * updated by loading the whole value, changing it and writing it back. Two
 * requests doing that at once (a registration and another agent's heartbeat, or
 * two agents submitting to the same task) would each write their own copy and
 * silently drop the other's change. Holding this lock around every update makes
 * them apply one after the other.
 *
 * If the lock cannot be taken within `waitMs` (a holder crashed; the lock
 * expires after `ttlMs` anyway) the update still runs rather than failing the
 * request. Without Redis (local development) it simply runs `fn`.
 */
export async function withRedisLock<T>(name: string, fn: () => Promise<T>, opts: { ttlMs?: number; waitMs?: number } = {}): Promise<T> {
  const r = getRedis();
  if (!r) return fn();
  const key = `cogladius:lock:${name}`;
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ttlMs = opts.ttlMs ?? 8_000;
  const deadline = Date.now() + (opts.waitMs ?? 10_000);
  let held = false;
  for (let delay = 25; ; delay = Math.min(delay * 2, 250)) {
    try {
      held = (await r.set(key, token, { nx: true, px: ttlMs })) === "OK";
    } catch {
      break; // Redis unreachable: fall through and let the update itself surface the error
    }
    if (held || Date.now() > deadline) break;
    await new Promise((res) => setTimeout(res, delay + Math.random() * delay));
  }
  if (!held) console.warn(`[redis-lock] ${name}: proceeding without the lock`);
  try {
    return await fn();
  } finally {
    if (held) {
      // Release only our own lock, never one that expired and was re-taken.
      // The Postgres store has no EVAL, so compare and delete in two steps there.
      try {
        if (typeof (r as any).eval === "function") {
          await r.eval('if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end', [key], [token]);
        } else if ((await r.get<string>(key)) === token) {
          await r.del(key);
        }
      } catch { /* the lock expires after ttlMs anyway */ }
    }
  }
}
