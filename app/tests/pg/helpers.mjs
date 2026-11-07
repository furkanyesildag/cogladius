import { readFileSync } from "node:fs";
import { startShim } from "./neon-http-shim.mjs";

/** Fresh tables behind a local shim, with the app's env pointing at it and away from Upstash. */
export async function startDb() {
  process.env.UPSTASH_REDIS_REST_URL = "";
  process.env.UPSTASH_REDIS_REST_TOKEN = "";
  process.env.DATABASE_URL = "postgresql://test:test@ep-local.neon.test/test";
  const shim = await startShim();
  process.env.NEON_SHIM_URL = shim.url;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(process.env.DATABASE_URL);
  await sql.query("DROP TABLE IF EXISTS kv_strings, kv_hashes, kv_sets");
  const schema = readFileSync(new URL("../../scripts/redis-pg-schema.sql", import.meta.url), "utf8").replace(/^--.*$/gm, "");
  for (const stmt of schema.split(";").map((s) => s.trim()).filter(Boolean)) await sql.query(stmt);
  return { shim, sql };
}

export const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
