/**
 * Arena routes end to end on the Postgres adapter: real route handlers, stubbed
 * BSC RPC via BSC_RPC_URL, stubbed judge responses from fetch-guard.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { startDb } from "./helpers.mjs";

let db, r, rpc, registry, arena, challenges, taskRoute, submitRoute, linkRoute, linkChallengeRoute, statsRoute;
const chain = { agentIdBalance: 1n, hasMinted: false, totalMinted: 0n, gladiatorBalance: 1n, calls: 0 };
const GLADIATOR = "0x00000000000000000000000000000000000000aa";
let ipSeq = 0;

function startRpc() {
  const word = (v) => `0x${BigInt(v).toString(16).padStart(64, "0")}`;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const msg = JSON.parse(body);
      chain.calls++;
      const { to, data } = msg.params[0];
      let result;
      if (data.startsWith("0x70a08231")) result = word(to.toLowerCase() === GLADIATOR ? chain.gladiatorBalance : chain.agentIdBalance);
      else if (data.startsWith("0x")) result = data.length > 10 ? word(chain.hasMinted ? 1 : 0) : word(chain.totalMinted);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

before(async () => {
  rpc = await startRpc();
  process.env.BSC_RPC_URL = `http://127.0.0.1:${rpc.address().port}`;
  process.env.ARENA_DRY_RUN = "1";
  process.env.ARENA_SIGNER_KEY = `0x${randomBytes(32).toString("hex")}`; // throwaway, signs nothing real
  process.env.DEEPSEEK_API_KEY = "sk-stub-not-real";
  delete process.env.OPENAI_API_KEY;
  process.env.STUB_JUDGE = "85";
  db = await startDb();
  console.log(`backend: ${db.shim.kind}`);
  r = (await import("../../lib/redis.ts")).getRedis();
  registry = await import("../../lib/agentRegistry.ts");
  arena = await import("../../lib/arena.ts");
  challenges = await import("../../lib/arenaChallenges.ts");
  taskRoute = await import("../../app/api/arena/task/route.ts");
  submitRoute = await import("../../app/api/arena/submit/route.ts");
  linkRoute = await import("../../app/api/arena/link/route.ts");
  linkChallengeRoute = await import("../../app/api/arena/link/challenge/route.ts");
  statsRoute = await import("../../app/api/arena/stats/route.ts");
});
after(async () => {
  assert.deepEqual(globalThis.__blockedHosts, []);
  rpc.closeAllConnections();
  rpc.close();
  await db.shim.stop();
});
beforeEach(() => {
  process.env.ARENA_DRY_RUN = "1";
  delete process.env.NEXT_PUBLIC_GLADIATOR_ADDRESS;
  process.env.STUB_JUDGE = "85";
  Object.assign(chain, { agentIdBalance: 1n, hasMinted: false, totalMinted: 0n, gladiatorBalance: 1n });
});

const wallet = () => `0x${randomBytes(20).toString("hex")}`;
const headers = (apiKey) => ({ "x-forwarded-for": `10.0.${++ipSeq >> 8}.${ipSeq & 255}`, ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) });

async function newAgent() {
  const pubkey = `G${randomBytes(27).toString("hex").toUpperCase()}`;
  return registry.registerAgent(pubkey, "arena test", { verified: true });
}

const getTask = async (apiKey, w) => {
  const { NextRequest } = await import("next/server");
  const res = await taskRoute.GET(new NextRequest(`http://local/api/arena/task?wallet=${w}`, { headers: headers(apiKey) }));
  return { status: res.status, body: await res.json() };
};
const submit = async (apiKey, w, attemptId, answer) => {
  const { NextRequest } = await import("next/server");
  const res = await submitRoute.POST(new NextRequest("http://local/api/arena/submit", { method: "POST", headers: headers(apiKey), body: JSON.stringify({ attemptId, wallet: w, answer }) }));
  return { status: res.status, body: await res.json() };
};

const pad = "Method: I went through every record in the data and applied each rule in turn, showing the working. ";
function rightAnswer(attemptId) {
  const c = challenges.buildArenaChallenge(attemptId);
  const scale = 10n ** BigInt(c.decimals);
  const abs = c.expected < 0n ? -c.expected : c.expected;
  const text = c.decimals ? `${abs / scale}.${String(abs % scale).padStart(c.decimals, "0")}` : String(abs);
  return `${pad}\nRESULT: ${c.expected < 0n ? "-" : ""}${text}`;
}
const wrongAnswer = `${pad}\nRESULT: 1234567.123`;

test("task: no key 401, bad key 403, good key issues an attempt stored with its TTL", async () => {
  const w = wallet();
  assert.equal((await getTask(null, w)).status, 401);
  assert.equal((await getTask("claw_nope", w)).status, 403);
  const a = await newAgent();
  const { status, body } = await getTask(a.apiKey, w);
  assert.equal(status, 200);
  assert.equal(body.dryRun, true);
  assert.equal(body.attemptsLeftToday, 2);
  const ttl = await r.ttl(arena.attemptKey(body.attemptId));
  assert.ok(ttl > 3500 && ttl <= 3600);
  const rec = await r.get(arena.attemptKey(body.attemptId));
  assert.equal(rec.wallet, w, "JSON auto-deserialized like Upstash");
  assert.ok((await r.ttl(arena.walletDailyKey(w))) > 86000);
});

test("task: one agent stays tied to one wallet; fourth attempt hits the daily limit", async () => {
  const a = await newAgent();
  const w = wallet();
  for (let i = 0; i < 3; i++) assert.equal((await getTask(a.apiKey, w)).status, 200);
  const fourth = await getTask(a.apiKey, w);
  assert.equal(fourth.status, 429);
  assert.equal(fourth.body.code, "daily_limit");
  assert.ok(fourth.body.retryAfter > 86000);
  assert.equal((await getTask(a.apiKey, wallet())).body.code, "agent_wallet_mismatch");
});

test("submit: wrong RESULT uses the attempt without a judge, and a repeat is refused", async () => {
  process.env.STUB_JUDGE = "fail";
  const a = await newAgent();
  const w = wallet();
  const { body: t } = await getTask(a.apiKey, w);
  const before = await arena.statsRead();
  const first = await submit(a.apiKey, w, t.attemptId, wrongAnswer);
  assert.equal(first.status, 200);
  assert.equal(first.body.code, "wrong_result");
  const again = await submit(a.apiKey, w, t.attemptId, wrongAnswer);
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "attempt_used");
  const after = await arena.statsRead();
  assert.equal(after.wrongResults - before.wrongResults, 1);
  assert.equal((await r.get(arena.attemptKey(t.attemptId))).used, true);
});

test("submit: a pass returns a voucher signed for the wallet and stores the result", async () => {
  const a = await newAgent();
  const w = wallet();
  const { body: t } = await getTask(a.apiKey, w);
  const before = await arena.statsRead();
  const { status, body } = await submit(a.apiKey, w, t.attemptId, rightAnswer(t.attemptId));
  assert.equal(status, 200);
  assert.equal(body.pass, true);
  assert.equal(body.avgScore, 85);
  assert.equal(body.tierName, "Silver");
  assert.equal(body.voucher.to.toLowerCase(), w);
  const stored = await r.get(arena.resultKey(w));
  assert.equal(stored.voucher.signature, body.voucher.signature);
  assert.ok((await r.ttl(arena.resultKey(w))) > 2_500_000);
  assert.equal((await arena.statsRead()).passes - before.passes, 1);
});

test("submit: a low score fails and stores the failure", async () => {
  process.env.STUB_JUDGE = "40";
  const a = await newAgent();
  const w = wallet();
  const { body: t } = await getTask(a.apiKey, w);
  const { body } = await submit(a.apiKey, w, t.attemptId, rightAnswer(t.attemptId));
  assert.equal(body.pass, false);
  assert.equal((await r.get(arena.resultKey(w))).pass, false);
});

test("submit: judge outage gives the attempt back, lock released, retry passes", async () => {
  process.env.STUB_JUDGE = "fail";
  const a = await newAgent();
  const w = wallet();
  const { body: t } = await getTask(a.apiKey, w);
  const failed = await submit(a.apiKey, w, t.attemptId, rightAnswer(t.attemptId));
  assert.equal(failed.status, 503);
  assert.equal(failed.body.code, "judging_unavailable");
  assert.equal(await r.get(arena.attemptLockKey(t.attemptId)), null);
  assert.equal((await r.get(arena.attemptKey(t.attemptId))).used, false);
  process.env.STUB_JUDGE = "85";
  assert.equal((await submit(a.apiKey, w, t.attemptId, rightAnswer(t.attemptId))).body.pass, true);
});

test("submit: of 20 concurrent submissions of one attempt, only one is judged", async () => {
  const a = await newAgent();
  const w = wallet();
  const { body: t } = await getTask(a.apiKey, w);
  const results = await Promise.all(Array.from({ length: 20 }, () => submit(a.apiKey, w, t.attemptId, rightAnswer(t.attemptId))));
  const passed = results.filter((x) => x.status === 200 && x.body.pass === true);
  assert.equal(passed.length, 1);
  assert.ok(results.every((x) => x === passed[0] || x.status === 409 || x.status === 429));
});

test("submit: wrong wallet and wrong agent are refused; rate limit bites after 6", async () => {
  const a = await newAgent();
  const b = await newAgent();
  const w = wallet();
  const { body: t } = await getTask(a.apiKey, w);
  assert.equal((await submit(a.apiKey, wallet(), t.attemptId, wrongAnswer)).body.code, "wallet_mismatch");
  assert.equal((await submit(b.apiKey, w, t.attemptId, wrongAnswer)).body.code, "agent_mismatch");
  let last;
  for (let i = 0; i < 6; i++) last = await submit(a.apiKey, w, t.attemptId, wrongAnswer);
  assert.equal(last.body.code, "rate_limited");
  assert.ok((await r.ttl(`arena:rate:submit:wallet:${w}`)) > 500);
});

test("stubbed BSC RPC: live gates read chain state when dry run is off", async () => {
  delete process.env.ARENA_DRY_RUN;
  process.env.NEXT_PUBLIC_GLADIATOR_ADDRESS = GLADIATOR;
  const a = await newAgent();
  const w = wallet();
  const callsBefore = chain.calls;
  chain.agentIdBalance = 0n;
  assert.equal((await getTask(a.apiKey, w)).body.code, "no_agent_id");
  assert.ok(chain.calls > callsBefore, "the stub was really used");
  chain.agentIdBalance = 1n;
  const ok = await getTask(a.apiKey, w);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.dryRun, undefined);
});

test("link: signed challenge stores both directions; a nonce works once; the holder gate passes", async () => {
  delete process.env.ARENA_DRY_RUN;
  process.env.NEXT_PUBLIC_GLADIATOR_ADDRESS = GLADIATOR;
  const { NextRequest } = await import("next/server");
  const a = await newAgent();
  const account = privateKeyToAccount(`0x${randomBytes(32).toString("hex")}`);
  const w = account.address.toLowerCase();
  const cres = await linkChallengeRoute.GET(new NextRequest(`http://local/api/arena/link/challenge?wallet=${w}`, { headers: headers(a.apiKey) }));
  const c = await cres.json();
  assert.equal(cres.status, 200);
  const { domain, message, primaryType } = c.typedData;
  const signature = await account.signTypedData({ domain, types: arena.LINK_EIP712_TYPES, primaryType, message });
  const post = () => linkRoute.POST(new NextRequest("http://local/api/arena/link", { method: "POST", headers: headers(a.apiKey), body: JSON.stringify({ wallet: w, nonce: c.nonce, signature }) }));
  const results = await Promise.all(Array.from({ length: 5 }, post));
  assert.equal(results.filter((x) => x.status === 200).length, 1, "single use under concurrency");
  assert.deepEqual(await arena.requireGladiatorHolder(a.pubkey), { ok: true, wallet: w });
  chain.gladiatorBalance = 0n;
  assert.equal((await arena.requireGladiatorHolder(a.pubkey)).reason, "no_gladiator");
});

test("stats route reads the hash and caches the minted count", async () => {
  delete process.env.ARENA_DRY_RUN;
  process.env.NEXT_PUBLIC_GLADIATOR_ADDRESS = GLADIATOR;
  chain.totalMinted = 7n;
  const res = await statsRoute.GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.attempts > 0);
  assert.equal(body.minted, 7);
  assert.ok((await r.ttl(arena.MINTED_CACHE_KEY)) > 0);
  chain.totalMinted = 9n;
  assert.equal((await (await statsRoute.GET()).json()).minted, 7, "served from the cache key");
});
