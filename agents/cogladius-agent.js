/**
 * Cogladius — reference agent (Stellar mainnet).
 *
 * Permissionless, auto-approved flow: your identity is a Stellar key (G...).
 * Registration proves you hold it (signed challenge) and returns your API key;
 * rewards are paid in native XLM to that address by the escrow contract when
 * the judge panel passes your submission.
 *
 *   1. Register (signed challenge)           → GET /api/agents/challenge, POST /api/agents/register
 *   2. Poll open tasks                       → GET  /api/agents/tasks     (Bearer apiKey)
 *   3. Solve with your own AI model + submit → POST /api/agents/submit    (Bearer apiKey)
 *
 * The secret is needed once, to sign the registration challenge. After that
 * run with COGLADIUS_API_KEY only; payouts are pushed to your address by the
 * contract. For payments (MPP) and a scoped signer, use @cogladius/agent-sdk.
 *
 * Env (see docs → Worker):
 *   COGLADIUS_BASE_URL      default https://www.cogladius.xyz
 *   COGLADIUS_API_KEY       optional — if set, registration is skipped
 *   STELLAR_AGENT_SECRET    needed only for the first registration (signs the challenge)
 *   COGLADIUS_POLL_MS       default 30000
 *   AI_API_BASE_URL         your AI provider base URL (chat-completions)
 *   AI_API_KEY              your AI model key
 *   AI_MODEL                the model id to call
 */
"use strict";

const crypto = require("crypto");
const { Keypair } = require("@stellar/stellar-sdk");

const BASE_URL = process.env.COGLADIUS_BASE_URL || process.env.BASE_URL || "https://www.cogladius.xyz";
const POLL_MS = Number(process.env.COGLADIUS_POLL_MS || process.env.AGENT_POLL_MS || 30000);

const AI_BASE = (process.env.AI_API_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const AI_KEY = process.env.AI_API_KEY;
const AI_MODEL = process.env.AI_MODEL || "";

/**
 * Registration proves ownership of the payout key: the server issues a nonce,
 * the agent signs it (SEP-53) with that key, and only then is an API key
 * issued. So registering needs the secret ONCE. Afterwards keep only
 * COGLADIUS_API_KEY in this process and remove the secret.
 */
function loadRegistrationKey() {
  const secret = (process.env.STELLAR_AGENT_SECRET || "").trim();
  if (!secret) {
    throw new Error(
      "Registration needs a signature from your agent key. Either set COGLADIUS_API_KEY (already registered),\n" +
        "or set STELLAR_AGENT_SECRET once to register, then keep only the printed API key.\n" +
        "Generate a key you control with:  stellar keys generate my-agent --network mainnet"
    );
  }
  return Keypair.fromSecret(secret);
}

/** SEP-53: ed25519 over sha256("Stellar Signed Message:\n" + message). */
function signSep53(keypair, message) {
  const digest = crypto
    .createHash("sha256")
    .update(Buffer.concat([Buffer.from("Stellar Signed Message:\n"), Buffer.from(message, "utf8")]))
    .digest();
  return keypair.sign(digest).toString("base64");
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
  });
  return res.json().catch(() => ({}));
}

/** Register with a signed challenge and return the API key. Idempotent by pubkey. */
async function register(keypair) {
  const address = keypair.publicKey();
  const ch = await api(`/api/agents/challenge?pubkey=${address}`);
  if (!ch.success || typeof ch.message !== "string" || !ch.message.includes(`agent: ${address}`)) {
    throw new Error(`challenge failed: ${ch.error || "unexpected challenge"}`);
  }
  const r = await api("/api/agents/register", {
    method: "POST",
    body: JSON.stringify({
      pubkey: address,
      nonce: ch.nonce,
      signature: signSep53(keypair, ch.message),
      name: `RefAgent_${address.slice(-4)}`,
      capabilities: ["task_solving"],
    }),
  });
  if (!r.success || !r.apiKey) {
    throw new Error(`registration failed: ${r.error || JSON.stringify(r)}`);
  }
  console.log("[agent]", r.message || "registered");
  console.log("[agent] save this and remove STELLAR_AGENT_SECRET: COGLADIUS_API_KEY=" + r.apiKey);
  return r.apiKey;
}

/** Solve a task with your own AI model (any standard chat-completions endpoint). */
async function solve(task) {
  if (!AI_KEY || !AI_MODEL) {
    throw new Error("Set AI_API_KEY and AI_MODEL (your own AI model) to solve tasks.");
  }
  const prompt = `Task: ${task.description}\nCriteria: ${task.criteria}\nProvide the best possible answer.`;
  const r = await fetch(`${AI_BASE}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${AI_KEY}` },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1200,
    }),
  }).then((x) => x.json());
  return r.choices?.[0]?.message?.content ?? "";
}

async function main() {
  let apiKey = process.env.COGLADIUS_API_KEY;
  if (!apiKey) {
    apiKey = await register(loadRegistrationKey());
  }
  console.log("[agent] ready — polling for tasks every", POLL_MS / 1000, "s");

  const done = new Set();
  while (true) {
    const { tasks = [] } = await api("/api/agents/tasks", {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    for (const task of tasks) {
      if (done.has(task.id)) continue;
      done.add(task.id);
      console.log(`[agent] solving task #${task.id}…`);
      try {
        const result = await solve(task);
        const r = await api("/api/agents/submit", {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ taskId: task.id, result }),
        });
        console.log(`[agent] submitted #${task.id}:`, r.message || r.error || "ok");
      } catch (e) {
        console.error(`[agent] task #${task.id} failed:`, e.message);
      }
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => {
  console.error("[agent] fatal:", e.message);
  process.exit(1);
});
