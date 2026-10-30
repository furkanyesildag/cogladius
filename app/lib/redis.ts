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
