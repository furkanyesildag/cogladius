import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { after, before, test } from "node:test";
import { startDb, sleep } from "./helpers.mjs";

let db, r, raw, kv, registry, mppStore, createPgRedis;

before(async () => {
  db = await startDb();
  console.log(`backend: ${db.shim.kind}`);
  ({ createPgRedis } = await import("../../lib/pgRedis.ts"));
  r = (await import("../../lib/redis.ts")).getRedis();
  raw = createPgRedis(process.env.DATABASE_URL, { automaticDeserialization: false });
  kv = await import("../../lib/kv.ts");
  registry = await import("../../lib/agentRegistry.ts");
  mppStore = await import("../../lib/mpp/store.ts");
});
after(async () => {
  assert.deepEqual(globalThis.__blockedHosts, []);
  await db.shim.stop();
});

const parallel = (n, fn) => Promise.all(Array.from({ length: n }, (_, i) => fn(i)));

// ── kv.ts ────────────────────────────────────────────────────────────────────

test("kvIncr counts inside a window and restarts after it", async () => {
  assert.equal(await kv.kvIncr("w:1", 1), 1);
  assert.equal(await kv.kvIncr("w:1", 1), 2);
  const ttl = await kv.kvTtl("w:1");
  assert.ok(ttl === 1 || ttl === null, "ttl rounds to 1 or below"); // 0 reads as null, as with Redis
  await sleep(1100);
  assert.equal(await kv.kvGet("w:1"), null);
  assert.equal(await kv.kvIncr("w:1", 60), 1, "expired counter starts over");
  assert.ok((await kv.kvTtl("w:1")) > 50, "new window applied");
  assert.equal(await r.ttl("w:1") > 0, true);
});

test("kvIncr keeps the first window: later hits do not extend it", async () => {
  await kv.kvIncr("w:2", 100);
  await sleep(1100);
  await kv.kvIncr("w:2", 100);
  assert.ok((await kv.kvTtl("w:2")) <= 99);
});

test("kvIncrBy adds, goes negative, and sets the window on first write", async () => {
  assert.equal(await kv.kvIncrBy("w:3", 500, 60), 500);
  assert.equal(await kv.kvIncrBy("w:3", -200, 60), 300);
  assert.ok((await kv.kvTtl("w:3")) > 50);
});

test("kvIncr: 200 concurrent hits count exactly, exactly one sees 1", async () => {
  const seen = await parallel(200, () => kv.kvIncr("w:4", 60));
  assert.deepEqual([...seen].sort((a, b) => a - b), Array.from({ length: 200 }, (_, i) => i + 1));
});

test("kvTake hands a value to exactly one of 20 concurrent callers", async () => {
  await kv.kvSet("t:1", "nonce-abc", 60);
  const got = await parallel(20, () => kv.kvTake("t:1"));
  assert.equal(got.filter((v) => v === "nonce-abc").length, 1);
  assert.equal(got.filter((v) => v === null).length, 19);
  assert.equal(await kv.kvGet("t:1"), null);
});

test("kvTake of an expired value returns null and clears it", async () => {
  await kv.kvSet("t:2", "x", 1);
  await sleep(1100);
  assert.equal(await kv.kvTake("t:2"), null);
  assert.equal((await db.sql.query("SELECT 1 FROM kv_strings WHERE key = 't:2'")).length, 0);
});

test("attempt lock: one of 20 concurrent submitters gets it; release lets one back in", async () => {
  const lock = "arena:attempt-lock:0xabc";
  const counts = await parallel(20, () => kv.kvIncr(lock, 3600));
  assert.equal(counts.filter((n) => n === 1).length, 1);
  assert.equal(await kv.kvIncr(lock, 3600), 21);
  await kv.kvTake(lock);
  assert.equal(await kv.kvIncr(lock, 3600), 1);
});

test("kvGet normalizes parsed JSON to a string, like the Upstash path", async () => {
  await kv.kvSet("g:1", JSON.stringify({ a: 1 }), 60);
  assert.equal(await kv.kvGet("g:1"), '{"a":1}');
  await kv.kvSet("g:2", "123", 60);
  assert.equal(await kv.kvGet("g:2"), "123");
  await kv.kvSet("g:3", "0xAbC", 60);
  assert.equal(await kv.kvGet("g:3"), "0xAbC");
});

test("kvTtl is null without a TTL or a key", async () => {
  await kv.kvCommit({ set: { "g:4": "permanent" } });
  assert.equal(await kv.kvTtl("g:4"), null);
  assert.equal(await kv.kvTtl("g:missing"), null);
  assert.equal(await r.ttl("g:4"), -1);
  assert.equal(await r.ttl("g:missing"), -2);
});

test("kvCommit applies deletes and permanent sets in one request", async () => {
  await kv.kvSet("c:old", "x", 60);
  const before = db.shim.stats.requests;
  await kv.kvCommit({ del: ["c:old"], set: { "c:a": "1", "c:b": "2" } });
  assert.equal(db.shim.stats.requests - before, 1);
  assert.equal(await kv.kvGet("c:old"), null);
  assert.equal(await kv.kvGet("c:a"), "1");
  assert.equal(await kv.kvTtl("c:b"), null);
});

// ── Raw commands ─────────────────────────────────────────────────────────────

test("SET returns OK; NX: exactly one of 20 concurrent callers wins", async () => {
  assert.equal(await r.set("s:1", "v"), "OK");
  const got = await parallel(20, (i) => r.set("s:nx", `v${i}`, { nx: true, ex: 60 }));
  assert.equal(got.filter((v) => v === "OK").length, 1);
  assert.equal(got.filter((v) => v === null).length, 19);
});

test("SET NX succeeds over an expired key and replaces its TTL", async () => {
  await r.set("s:2", "old", { ex: 1 });
  assert.equal(await r.set("s:2", "held", { nx: true }), null);
  await sleep(1100);
  assert.equal(await r.set("s:2", "new", { nx: true }), "OK");
  assert.equal(await r.ttl("s:2"), -1);
});

test("plain SET clears an existing TTL, PX works, bad TTL throws", async () => {
  await r.set("s:3", "a", { ex: 60 });
  await r.set("s:3", "b");
  assert.equal(await r.ttl("s:3"), -1);
  await r.set("s:4", "a", { px: 300 });
  assert.equal(await r.get("s:4"), "a");
  await sleep(400);
  assert.equal(await r.get("s:4"), null);
  await assert.rejects(() => r.set("s:5", "a", { ex: 0 }));
});

test("EXPIRE returns 1 on a live key and 0 otherwise", async () => {
  await r.set("e:1", "a");
  assert.equal(await r.expire("e:1", 60), 1);
  assert.equal(await r.expire("e:missing", 60), 0);
});

test("INCR on a non-integer fails, like Redis", async () => {
  await r.set("i:1", "not-a-number");
  await assert.rejects(() => r.incr("i:1"));
});

test("DEL counts live keys across all three tables", async () => {
  await r.set("d:s", "a");
  await r.set("d:x", "a", { px: 50 });
  await r.hset("d:h", { f: 1 });
  await r.sadd("d:m", "a");
  await sleep(100);
  assert.equal(await r.del("d:s", "d:x", "d:h", "d:m", "d:none"), 3);
  assert.equal(await r.hgetall("d:h"), null);
});

test("hset/hget/hdel/hgetall/hlen shapes", async () => {
  assert.equal(await r.hset("h:1", { a: { x: 1 }, b: "text", c: 5 }), 3);
  assert.equal(await r.hset("h:1", { a: { x: 2 }, d: true }), 1, "counts new fields only");
  assert.deepEqual(await r.hget("h:1", "a"), { x: 2 });
  assert.equal(await r.hget("h:1", "b"), "text");
  assert.equal(await r.hget("h:1", "c"), 5);
  assert.equal(await r.hget("h:1", "none"), null);
  assert.equal(await r.hlen("h:1"), 4);
  assert.deepEqual(await r.hgetall("h:1"), { a: { x: 2 }, b: "text", c: 5, d: true });
  assert.equal(await r.hdel("h:1", "b", "none"), 1);
  assert.equal(await r.hlen("h:1"), 3);
  assert.equal(await r.hgetall("h:none"), null);
});

test("hscan pages through everything once, with deserialized values and a string cursor", async () => {
  const all = {};
  for (let i = 0; i < 1000; i++) all[`G${String(i).padStart(4, "0")}`] = { i };
  await r.hset("h:scan", all);
  const seen = new Map();
  let cursor = "0";
  let pages = 0;
  do {
    const [next, flat] = await r.hscan("h:scan", cursor, { count: 100 });
    assert.equal(typeof next, "string");
    assert.ok(flat.length <= 200);
    for (let i = 0; i < flat.length; i += 2) {
      assert.equal(seen.has(flat[i]), false, "no field twice");
      assert.equal(typeof flat[i + 1], "object", "value already deserialized");
      seen.set(flat[i], flat[i + 1]);
    }
    cursor = next;
    pages++;
  } while (cursor !== "0");
  assert.equal(seen.size, 1000);
  assert.equal(pages, 10, "no empty trailing page");
  assert.deepEqual(await r.hscan("h:none", "0", { count: 5 }), ["0", []]);
  const [restart] = await r.hscan("h:scan", "48213", { count: 100 });
  assert.notEqual(restart, "0", "a numeric cursor from Redis restarts instead of failing");
});

test("hincrby: 100 concurrent increments are exact", async () => {
  await parallel(100, () => r.hincrby("h:stats", "attempts", 1));
  assert.equal(await r.hincrby("h:stats", "attempts", 1), 101);
  assert.deepEqual(await r.hgetall("h:stats"), { attempts: 101 });
});

test("sadd/smembers", async () => {
  assert.equal(await r.sadd("m:1", "a", "b"), 2);
  assert.equal(await r.sadd("m:1", "b", "c"), 1);
  assert.deepEqual((await r.smembers("m:1")).sort(), ["a", "b", "c"]);
  assert.deepEqual(await r.smembers("m:none"), []);
});

test("NUL in a key or field misses instead of raising a SQL error", async () => {
  assert.equal(await r.get("a\0b"), null);
  assert.equal(await r.hget("h:1", "a\0b"), null);
  assert.equal(await registry.getAgent("G\0"), null);
});

// ── Pipeline / multi ─────────────────────────────────────────────────────────

test("pipeline and multi send one request and return results in order", async () => {
  for (const make of [() => r.pipeline(), () => r.multi()]) {
    await r.del("p:s", "p:h");
    const before = db.shim.stats.requests;
    const results = await make().set("p:s", "1").incr("p:s").hset("p:h", { f: { a: 1 } }).hget("p:h", "f").hdel("p:h", "f").get("p:none").exec();
    assert.equal(db.shim.stats.requests - before, 1);
    assert.deepEqual(results, ["OK", 2, 1, { a: 1 }, 1, null]);
  }
});

test("empty pipeline throws; a failing statement rolls the whole batch back", async () => {
  await assert.rejects(() => r.pipeline().exec(), /Pipeline is empty/);
  await r.set("p:bad", "text");
  await assert.rejects(() => r.multi().set("p:rollback", "1").incr("p:bad").exec());
  assert.equal(await r.get("p:rollback"), null);
});

// ── Expiry cleanup and retry ─────────────────────────────────────────────────

test("cleanup deletes expired rows on a TTL write, and only those", async () => {
  await db.sql.query("INSERT INTO kv_strings (key, value, expires_at) VALUES ('x:dead', '1', now() - interval '1 hour'), ('x:live', '1', now() + interval '1 hour')");
  const eager = createPgRedis(process.env.DATABASE_URL, { cleanupRate: 1 });
  assert.equal(await eager.set("x:new", "1", { ex: 60 }), "OK");
  const rows = await db.sql.query("SELECT key FROM kv_strings WHERE key LIKE 'x:%' ORDER BY key");
  assert.deepEqual(rows.map((x) => x.key), ["x:live", "x:new"]);
});

test("transient 5xx is retried; SQL errors are not", async () => {
  db.shim.stats.failNext = 2;
  assert.equal(await r.set("rt:1", "v"), "OK");
  await r.set("rt:2", "text");
  const before = db.shim.stats.requests;
  await assert.rejects(() => r.incr("rt:2"));
  assert.equal(db.shim.stats.requests - before, 1);
});

test("the driver call opts out of the Next fetch cache", async () => {
  const seen = [];
  const prev = globalThis.fetch;
  globalThis.fetch = (u, init) => (seen.push(init?.cache), prev(u, init));
  try {
    await r.get("nc:1");
    await r.pipeline().get("nc:1").exec();
  } finally {
    globalThis.fetch = prev;
  }
  assert.deepEqual(seen, ["no-store", "no-store"]);
});

// ── Differential: the real @upstash/redis client, against a local stub ───────

test("same results as the real Upstash client for the same stored strings", async () => {
  const stored = ["123", "1.50", "1.5", "true", "null", '{"a":1}', "[1,2]", "0x00ab", "12345678901234567890", "1e5", "plain text", " 5", '"quoted"', "007", "-4"];
  await r.hset("u:h", Object.fromEntries(stored.map((v, i) => [`f${i}`, v])));
  await r.sadd("u:m", ...stored);
  for (let i = 0; i < stored.length; i++) await r.set(`u:s${i}`, stored[i]);

  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const [cmd, ...args] = JSON.parse(body);
      let result;
      if (cmd === "hscan") result = await raw.hscan(args[0], args[1], { count: Number(args[3]) });
      else result = await raw[cmd](...args);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ result }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { Redis } = await import("@upstash/redis");
    const upstash = new Redis({ url: `http://127.0.0.1:${server.address().port}`, token: "stub", responseEncoding: false, enableTelemetry: false, enableAutoPipelining: false, retry: false });
    for (let i = 0; i < stored.length; i++) {
      assert.deepEqual(await r.get(`u:s${i}`), await upstash.get(`u:s${i}`), `get of ${stored[i]}`);
      assert.deepEqual(await r.hget("u:h", `f${i}`), await upstash.hget("u:h", `f${i}`), `hget of ${stored[i]}`);
    }
    assert.deepEqual(await r.hgetall("u:h"), await upstash.hgetall("u:h"));
    assert.deepEqual(await r.hscan("u:h", "0", { count: 100 }), await upstash.hscan("u:h", "0", { count: 100 }));
    assert.deepEqual(new Set(await r.smembers("u:m")), new Set(await upstash.smembers("u:m")));
    assert.deepEqual(await r.getdel("u:s0").then(async (v) => (await r.set("u:s0", stored[0]), v)), await upstash.getdel("u:s0"));
    assert.equal(await r.ttl("u:none"), await upstash.ttl("u:none"));
    assert.equal(await r.get("u:none"), await upstash.get("u:none"));
    assert.equal(await r.hgetall("u:none"), await upstash.hgetall("u:none"));
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

// ── Agent registry ───────────────────────────────────────────────────────────

test("registerAgent, validateApiKey, key rotation, ban", async () => {
  const G = "GTESTAGENT0000000000000000000000000000000000000000000001";
  const a = await registry.registerAgent(G, "Tester", { verified: true });
  assert.match(a.apiKey, /^claw_/);
  assert.equal((await registry.validateApiKey(a.apiKey)).pubkey, G);
  assert.equal(await registry.validateApiKey("claw_nope"), null);

  const again = await registry.registerAgent(G, "Tester2", {});
  assert.equal(again.apiKey, a.apiKey, "re-registering keeps the key");
  assert.equal(again.registeredAt, a.registeredAt);

  const before = db.shim.stats.requests;
  const rotated = await registry.registerAgent(G, "Tester2", { rotateApiKey: true });
  assert.equal(db.shim.stats.requests - before, 2, "one read, one write batch");
  assert.notEqual(rotated.apiKey, a.apiKey);
  assert.equal(await registry.getAgentByApiKey(a.apiKey), null, "old key dead");
  assert.equal((await registry.getAgentByApiKey(rotated.apiKey)).pubkey, G);

  await registry.updateAgentStats(G, { tasksAttempted: 2, tasksCompleted: 1, totalScore: 80 });
  assert.equal((await registry.getAgent(G)).stats.avgScore, 80);
  await r.hset("cogladius:agents:v2", { [G]: { ...(await registry.getAgent(G)), isBanned: true } });
  assert.equal(await registry.validateApiKey(rotated.apiKey), null, "banned key refused");
});

test("getApprovedAgentsPage pages the registry without repeats", async () => {
  for (let i = 0; i < 25; i++) await registry.registerAgent(`GPAGE${String(i).padStart(3, "0")}`, `A${i}`, {});
  const seen = new Set();
  let cursor = "0";
  let total;
  do {
    const page = await registry.getApprovedAgentsPage(10, cursor);
    total = page.total;
    for (const a of page.agents) seen.add(a.pubkey);
    cursor = page.nextCursor ?? "0";
  } while (cursor !== "0");
  assert.equal(seen.size, 25);
  assert.equal(total, 26, "total counts the banned agent too");
});

// ── MPP store ────────────────────────────────────────────────────────────────

test("MPP atomic store: CAS loses no update under 20 concurrent writers", async () => {
  const s = mppStore.atomicStore("cogladius:mpp:test:");
  await parallel(20, () =>
    s.update("counter", (cur) => ({ op: "set", value: { n: (cur?.n ?? 0) + 1 }, result: null }))
  );
  assert.deepEqual(await s.get("counter"), { n: 20 });
  assert.equal(await s.update("counter", () => ({ op: "noop", result: "kept" })), "kept");
  assert.equal(await s.update("counter", () => ({ op: "delete", result: "gone" })), "gone");
  assert.equal(await s.get("counter"), null);
  assert.equal(await s.update("fresh", (cur) => ({ op: "delete", result: cur })), null, "deleting nothing succeeds");
  await s.put("plain", { a: "x" });
  assert.deepEqual(await s.get("plain"), { a: "x" });
  await s.delete("plain");
  assert.equal(await s.get("plain"), null);
  assert.equal(await r.get("cogladius:mpp:test:plain"), null);
});

test("MPP highest-commitment rule stays monotonic under 20 concurrent records", async () => {
  // Same update as CommitmentLedger.record, which cannot load here: its @stellar/stellar-sdk import only resolves inside the Next build.
  const s = mppStore.atomicStore("cogladius:mpp:ledger:");
  const record = (amount) =>
    s.update("highest:CCHANNEL", (cur) =>
      cur && BigInt(cur.amount) >= amount ? { op: "noop", result: false } : { op: "set", value: { amount: amount.toString() }, result: true }
    );
  await parallel(20, (i) => record(BigInt(i + 1)));
  assert.deepEqual(await s.get("highest:CCHANNEL"), { amount: "20" });
  assert.equal(await record(5n), false);
});

test("MPP channel index set", async () => {
  await mppStore.addToSet("cogladius:mpp:channels", "CA");
  await mppStore.addToSet("cogladius:mpp:channels", "CB");
  await mppStore.addToSet("cogladius:mpp:channels", "CA");
  assert.deepEqual((await mppStore.setMembers("cogladius:mpp:channels")).sort(), ["CA", "CB"]);
});

// ── Backend selection ────────────────────────────────────────────────────────

test("backend choice: DATABASE_URL wins, unset falls back to Upstash, neither means null", () => {
  const code = `import("./lib/redis.ts").then(({ getRedis }) => { const r = getRedis(); console.log(r === null ? "null" : r.casSet ? "pg" : "upstash") })`;
  const run = (env) => {
    const out = spawnSync(process.execPath, ["--import", "tsx", "--import", "./tests/pg/fetch-guard.mjs", "-e", code], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "", DATABASE_URL: "", ...env },
    });
    return out.stdout.trim();
  };
  const fakeUpstash = { UPSTASH_REDIS_REST_URL: "https://fake.invalid", UPSTASH_REDIS_REST_TOKEN: "fake" };
  assert.equal(run({}), "null");
  assert.equal(run(fakeUpstash), "upstash");
  assert.equal(run({ DATABASE_URL: "  ", ...fakeUpstash }), "upstash");
  assert.equal(run({ DATABASE_URL: "postgresql://a:b@ep-x.neon.test/db", ...fakeUpstash }), "pg");
});
