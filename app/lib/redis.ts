/**
 * Redis client — Upstash (production) veya in-memory fallback (local/test)
 *
 * Vercel'de UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN env var gerekli.
 * Yoksa local JSON dosya sistemine düşer.
 */

let _redis: import("@upstash/redis").Redis | null = null;

export function getRedis(): import("@upstash/redis").Redis | null {
  if (typeof process === "undefined") return null;
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  if (!_redis) {
    const { Redis } = require("@upstash/redis");
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return _redis;
}
