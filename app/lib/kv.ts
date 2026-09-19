/**
 * Small expiring key-value helpers on top of Upstash Redis.
 *
 * Used for single-use registration nonces and rate-limit counters. Without
 * Redis (local development) it falls back to an in-process Map, which is fine
 * for one `next dev` process and wrong for serverless — production must have
 * UPSTASH_REDIS_REST_URL/TOKEN set, as the rest of the app already requires.
 */

import { getRedis } from "./redis";

// On globalThis: Next compiles each route separately, and without Redis every
// route must still see the same in-process map.
const g = globalThis as unknown as { __cogKv?: Map<string, { value: string; expiresAt: number }> };
const mem = (g.__cogKv ??= new Map());

function memGet(key: string): string | null {
  const hit = mem.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    mem.delete(key);
    return null;
  }
  return hit.value;
}

export async function kvSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  const r = getRedis();
  if (r) {
    await r.set(key, value, { ex: ttlSeconds });
    return;
  }
  mem.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

/** Read and delete in one step, so a value can be consumed only once. */
export async function kvTake(key: string): Promise<string | null> {
  const r = getRedis();
  if (r) {
    const v = await r.getdel<string>(key);
    return v == null ? null : String(v);
  }
  const v = memGet(key);
  mem.delete(key);
  return v;
}

/**
 * Increment a counter that expires `windowSeconds` after its first hit.
 * Returns the new count.
 */
export async function kvIncr(key: string, windowSeconds: number): Promise<number> {
  const r = getRedis();
  if (r) {
    const n = await r.incr(key);
    if (n === 1) await r.expire(key, windowSeconds);
    return n;
  }
  const cur = Number(memGet(key) ?? 0) + 1;
  const prev = mem.get(key);
  mem.set(key, {
    value: String(cur),
    expiresAt: prev && prev.expiresAt > Date.now() ? prev.expiresAt : Date.now() + windowSeconds * 1000,
  });
  return cur;
}

/** Add `amount` to a windowed total (e.g. stroops spent) and return the new total. */
export async function kvIncrBy(key: string, amount: number, windowSeconds: number): Promise<number> {
  const r = getRedis();
  if (r) {
    const n = await r.incrby(key, amount);
    if (n === amount) await r.expire(key, windowSeconds);
    return n;
  }
  const prev = mem.get(key);
  const live = prev && prev.expiresAt > Date.now();
  const cur = (live ? Number(prev!.value) : 0) + amount;
  mem.set(key, { value: String(cur), expiresAt: live ? prev!.expiresAt : Date.now() + windowSeconds * 1000 });
  return cur;
}
