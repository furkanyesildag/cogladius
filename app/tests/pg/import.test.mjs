/** scripts/import-redis-export.mjs against a synthetic export, through the real driver. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startDb } from "./helpers.mjs";

let db, dir;
before(async () => {
  db = await startDb();
  dir = mkdtempSync(join(tmpdir(), "cog-import-test-"));
});
after(async () => {
  rmSync(dir, { recursive: true, force: true });
  await db.shim.stop();
});

function runImport(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "./tests/pg/fetch-guard.mjs", "scripts/import-redis-export.mjs", ...args], {
      env: { PATH: process.env.PATH, DATABASE_URL: process.env.DATABASE_URL, NEON_SHIM_URL: process.env.NEON_SHIM_URL },
    });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (out += c));
    child.on("close", (code) => resolve({ code, out }));
  });
}

function writeExport(name, data, at = Date.now()) {
  const path = join(dir, `${name}-${at}.json`);
  writeFileSync(path, JSON.stringify(data));
  return path;
}

const SECRET = "claw_THIS_MUST_NEVER_BE_PRINTED";
const base = {
  "cogladius:agents:v2": { type: "hash", ttl: -1, value: ["GA", JSON.stringify({ pubkey: "GA", apiKey: SECRET }), "GB", JSON.stringify({ pubkey: "GB", apiKey: "claw_b" })] },
  "cogladius:agent-key-index": { type: "hash", ttl: -1, value: { [SECRET]: "GA", claw_b: "GB" } },
  "arena:stats": { type: "hash", ttl: -1, value: ["attempts", "10", "passes", "2"] },
  "cogladius:mpp:channels": { type: "set", ttl: -1, value: ["CA", "CB"] },
  "cogladius:tasks": { type: "string", ttl: -1, value: JSON.stringify({ 1: { id: 1, status: "Open" }, 2: { id: 2, status: "Open" } }) },
  "cogladius:relay:budget": { type: "string", ttl: 40000, value: "1000" },
  "arena:attempts:0xaa": { type: "string", ttl: 80000, value: "2" },
  "arena:result:0xaa": { type: "string", ttl: 2000000, value: { pass: true } },
  "arena:verified-wallet:GA": { type: "string", ttl: -1, value: "0xaa" },
  "arena:rate:task:ip:1.2.3.4": { type: "string", ttl: 500, value: "3" },
  "arena:attempt-lock:0xbb": { type: "string", ttl: 3000, value: "1" },
  "cogladius:register-rate:1.2.3.4": { type: "string", ttl: 500, value: "1" },
  "cogladius:challenge-rate:GA": { type: "string", ttl: 500, value: "1" },
  "arena:minted-cache": { type: "string", ttl: 50, value: "100" },
  "arena:rate:gone": { type: "none", ttl: -2, value: null },
  "cogladius:challenge:GZ": { type: "string", ttl: -2, value: null },
  "cogladius:challenge:GC": { type: "string", ttl: 5, value: "already-lapsed" },
};

test("full import: skips, TTLs from export time, verify passes, nothing secret printed", async () => {
  const at = Date.now() - 60_000;
  const path = writeExport("redis-export", base, at);
  const { code, out } = await runImport([path]);
  assert.equal(code, 0, out);
  assert.match(out, /verify ok/);
  assert.equal(out.includes(SECRET), false);
  assert.equal(out.includes("1.2.3.4"), false);
  assert.equal(out.includes("0xaa"), false);

  const keys = (await db.sql.query("SELECT key FROM kv_strings ORDER BY key")).map((x) => x.key);
  assert.deepEqual(keys, ["arena:attempts:0xaa", "arena:result:0xaa", "arena:verified-wallet:GA", "cogladius:relay:budget", "cogladius:tasks"]);

  const [{ left }] = await db.sql.query(`SELECT extract(epoch FROM expires_at - now())::int AS left FROM kv_strings WHERE key = 'arena:attempts:0xaa'`);
  assert.ok(left > 79900 && left <= 79945, "the 60 s since export are not granted again");
  const [{ none }] = await db.sql.query(`SELECT expires_at IS NULL AS none FROM kv_strings WHERE key = 'arena:verified-wallet:GA'`);
  assert.equal(none, true);
  const [{ value }] = await db.sql.query(`SELECT value FROM kv_strings WHERE key = 'arena:result:0xaa'`);
  assert.equal(value, '{"pass":true}', "deserialized export values are stored as JSON");
  const [{ n }] = await db.sql.query(`SELECT count(*)::int AS n FROM kv_hashes`);
  assert.equal(n, 2 + 2 + 2);
});

test("full import is idempotent", async () => {
  const count = async () => JSON.stringify(await db.sql.query("SELECT key, value FROM kv_strings UNION ALL SELECT key || field, value FROM kv_hashes ORDER BY 1, 2"));
  const path = writeExport("redis-export", base, Date.now() - 60_000);
  const before = await count();
  const { code } = await runImport([path]);
  assert.equal(code, 0);
  assert.equal(await count(), before);
});

test("the app reads imported data through getAgentByApiKey", async () => {
  const { getAgentByApiKey } = await import("../../lib/agentRegistry.ts");
  assert.equal((await getAgentByApiKey(SECRET))?.pubkey, "GA");
  assert.equal(await getAgentByApiKey("claw_wrong"), null);
});

test("dry run touches nothing and needs no database", async () => {
  const path = writeExport("redis-export", { "x:y": { type: "string", ttl: -1, value: "1" } });
  const child = spawn(process.execPath, ["scripts/import-redis-export.mjs", path, "--dry-run"], { env: { PATH: process.env.PATH } });
  const code = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(code, 0);
  assert.equal((await db.sql.query("SELECT 1 FROM kv_strings WHERE key = 'x:y'")).length, 0);
});

test("delta: three-way merge never overwrites what Postgres changed since", async () => {
  const q = async (sql, ...p) => (await db.sql.query(sql, p))[0]?.value;
  const str = (k) => q("SELECT value FROM kv_strings WHERE key = $1", k);
  const fld = (k, f) => q("SELECT value FROM kv_hashes WHERE key = $1 AND field = $2", k, f);

  // Writes the live app made on Postgres after the switch.
  await db.sql.query(`UPDATE kv_hashes SET value = $1 WHERE key = 'cogladius:agents:v2' AND field = 'GB'`, [JSON.stringify({ pubkey: "GB", apiKey: "claw_b", lastSeen: "pg" })]);
  await db.sql.query(`UPDATE kv_hashes SET value = (value::int + 5)::text WHERE key = 'arena:stats' AND field = 'attempts'`);
  await db.sql.query("DROP TABLE IF EXISTS kv_import_log");
  await db.sql.query(`UPDATE kv_strings SET value = (value::int - 50)::text WHERE key = 'cogladius:relay:budget'`);
  await db.sql.query(`UPDATE kv_strings SET value = $1 WHERE key = 'cogladius:tasks'`, [
    JSON.stringify({ 1: { id: 1, status: "Settled-on-pg" }, 2: { id: 2, status: "Open" }, 4: { id: 4, status: "pg-new" } }),
  ]);

  // Writes Upstash took between the first and the final export.
  const final = JSON.parse(JSON.stringify(base));
  final["cogladius:agents:v2"].value.push("GN", JSON.stringify({ pubkey: "GN", apiKey: "claw_n" })); // new agent
  final["cogladius:agents:v2"].value[3] = JSON.stringify({ pubkey: "GB", apiKey: "claw_b", lastSeen: "upstash" }); // conflict
  final["cogladius:agent-key-index"].value.claw_n = "GN";
  final["arena:stats"].value = ["attempts", "13", "passes", "2"]; // +3
  final["cogladius:mpp:channels"].value.push("CC");
  final["cogladius:relay:budget"].value = "1200"; // +200
  final["arena:attempts:0xcc"] = { type: "string", ttl: 80000, value: "1" }; // new counter
  final["arena:verified-wallet:GA"] = { type: "none", ttl: -2, value: null }; // deleted
  final["arena:result:0xdd"] = { type: "string", ttl: 2000000, value: '{"pass":false}' }; // new
  final["cogladius:tasks"].value = JSON.stringify({
    1: { id: 1, status: "Settled-on-upstash" }, // conflict: Postgres changed it too
    2: { id: 2, status: "UnderReview" }, // only Upstash changed it
    3: { id: 3, status: "upstash-new" },
  });

  const basePath = writeExport("redis-export", base, Date.now() - 60_000);
  const finalPath = writeExport("redis-export", final, Date.now() - 30_000);
  const { code, out } = await runImport([finalPath, "--baseline", basePath]);
  assert.equal(code, 0, out);
  assert.equal(out.includes(SECRET), false);
  assert.match(out, /conflicts kept as in Postgres, cogladius:tasks: 1/);

  assert.equal(JSON.parse(await fld("cogladius:agents:v2", "GN")).apiKey, "claw_n");
  assert.equal(await fld("cogladius:agent-key-index", "claw_n"), "GN");
  assert.equal(JSON.parse(await fld("cogladius:agents:v2", "GB")).lastSeen, "pg", "conflict: Postgres wins");
  assert.equal(await fld("arena:stats", "attempts"), "18", "10 + 5 on Postgres + 3 on Upstash");
  assert.equal(await str("cogladius:relay:budget"), "1150", "1000 - 50 + 200");
  assert.equal(await str("arena:attempts:0xcc"), "1");
  assert.equal(await str("arena:verified-wallet:GA"), undefined);
  assert.equal(await str("arena:result:0xdd"), '{"pass":false}');
  assert.equal((await db.sql.query(`SELECT 1 FROM kv_sets WHERE key = 'cogladius:mpp:channels' AND member = 'CC'`)).length, 1);
  const tasks = JSON.parse(await str("cogladius:tasks"));
  assert.equal(tasks[1].status, "Settled-on-pg");
  assert.equal(tasks[2].status, "UnderReview");
  assert.equal(tasks[3].status, "upstash-new");
  assert.equal(tasks[4].status, "pg-new");

  const again = await runImport([finalPath, "--baseline", basePath]);
  assert.equal(again.code, 0);
  assert.match(again.out, /already applied/);
  assert.equal(await fld("arena:stats", "attempts"), "18", "a re-run does not add counters twice");
});

test("a failed run prints only an error code", async () => {
  const path = writeExport("redis-export", { "x:y": { type: "string", ttl: -1, value: "ok" } });
  const child = spawn(process.execPath, ["--import", "./tests/pg/fetch-guard.mjs", "scripts/import-redis-export.mjs", path], {
    env: { PATH: process.env.PATH, DATABASE_URL: "postgresql://user:hunter2@ep-x.example.com/db" },
  });
  let out = "";
  child.stdout.on("data", (c) => (out += c));
  child.stderr.on("data", (c) => (out += c));
  const code = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(code, 1);
  assert.equal(out.includes("hunter2"), false);
});
