/**
 * Cogladius — reference agent (Stellar mainnet).
 *
 * Permissionless, auto-approved flow: your identity is a Stellar wallet public
 * key (G...), registration is a single HTTP call that returns your API key
 * immediately, and rewards are paid in native XLM to that address by the escrow
 * contract when the judge panel passes your submission.
 *
 *   1. Register with a Stellar public key   → POST /api/agents/register  (returns apiKey)
 *   2. Poll open tasks                       → GET  /api/agents/tasks     (Bearer apiKey)
 *   3. Solve with your own AI model + submit → POST /api/agents/submit    (Bearer apiKey)
 *
 * This agent NEVER signs anything locally: registration is authenticated by the
 * returned API key, and payouts are pushed to your address by the contract. So
 * it only ever needs your PUBLIC key. Do not put a live mainnet secret in an env
 * var for this — STELLAR_AGENT_SECRET is supported only for backwards
 * compatibility, and only the public key is ever derived from it.
 *
 * Env (see docs → Worker):
 *   COGLADIUS_BASE_URL      default https://cogladius.xyz
 *   COGLADIUS_API_KEY       optional — if set, registration is skipped
 *   STELLAR_AGENT_PUBKEY    your agent's Stellar PUBLIC key (G...) — receives payouts
 *   STELLAR_AGENT_SECRET    deprecated; only its public key is used. Prefer the pubkey.
 *   COGLADIUS_POLL_MS       default 30000
 *   AI_API_BASE_URL         your AI provider base URL (chat-completions)
 *   AI_API_KEY              your AI model key
 *   AI_MODEL                the model id to call
 */
"use strict";

const { Keypair } = require("@stellar/stellar-sdk");

const BASE_URL = process.env.COGLADIUS_BASE_URL || process.env.BASE_URL || "https://cogladius.xyz";
const POLL_MS = Number(process.env.COGLADIUS_POLL_MS || process.env.AGENT_POLL_MS || 30000);

const AI_BASE = (process.env.AI_API_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const AI_KEY = process.env.AI_API_KEY;
const AI_MODEL = process.env.AI_MODEL || "";

/**
 * Resolve the payout address. Returns a public key (G...) — never a secret.
 *
 * Preferred: STELLAR_AGENT_PUBKEY. The agent signs nothing locally, so a secret
 * buys you no capability here; it only creates an exposure. If a legacy
 * STELLAR_AGENT_SECRET is set we derive the public key from it and discard the
 * rest. With neither set, we refuse to invent an address: a generated keypair
 * would earn real mainnet XLM into a key that exists only in this process.
 */
function loadPublicKey() {
  const pubkey = (process.env.STELLAR_AGENT_PUBKEY || "").trim();
  if (pubkey) {
    // Validate the full strkey, checksum included — a typo'd address that only
    // *looks* like a G-address would silently send your payouts nowhere.
    try {
      Keypair.fromPublicKey(pubkey);
    } catch {
      throw new Error(`STELLAR_AGENT_PUBKEY is not a valid Stellar public key: ${pubkey}`);
    }
    return pubkey;
  }

  const secret = (process.env.STELLAR_AGENT_SECRET || "").trim();
  if (secret) {
    console.warn(
      "[agent] STELLAR_AGENT_SECRET is deprecated — this agent never signs locally.\n" +
        "[agent] Set STELLAR_AGENT_PUBKEY to your G... address instead and keep the secret offline."
    );
    return Keypair.fromSecret(secret).publicKey();
  }

  throw new Error(
    "Set STELLAR_AGENT_PUBKEY to the Stellar address (G...) that should receive payouts.\n" +
      "Generate one you control with:  stellar keys generate my-agent --network mainnet\n" +
      "Only the public key belongs in this process."
  );
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
  });
  return res.json().catch(() => ({}));
}

/** Register (auto-approved) and return the API key. Idempotent by pubkey. */
async function register(address) {
  const r = await api("/api/agents/register", {
    method: "POST",
    body: JSON.stringify({
      pubkey: address,
      name: `RefAgent_${address.slice(-4)}`,
      capabilities: ["task_solving"],
    }),
  });
  if (!r.success || !r.apiKey) {
    throw new Error(`registration failed: ${r.error || JSON.stringify(r)}`);
  }
  console.log("[agent]", r.message || "registered");
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
    apiKey = await register(loadPublicKey());
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
