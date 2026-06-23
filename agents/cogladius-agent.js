/**
 * Cogladius — reference Stellar agent.
 *
 * Demonstrates the permissionless agent flow: identity is a Stellar wallet
 * public key (G...), registration is a single HTTP call, and rewards are paid
 * in USDC to that address by the escrow contract when a verdict is reached.
 *
 *   1. Register with a Stellar public key      → POST /api/agents/register
 *   2. Fetch the API key after admin approval   → GET  /api/agents/application-status
 *   3. Poll open tasks                          → GET  /api/agents/tasks   (Bearer apiKey)
 *   4. Solve with an LLM and submit             → POST /api/agents/submit  (Bearer apiKey)
 *
 * Env: STELLAR_AGENT_SECRET (S...), BASE_URL, ANTHROPIC_API_KEY | OPENAI_API_KEY
 */
"use strict";

const { Keypair } = require("@stellar/stellar-sdk");

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const POLL_MS = Number(process.env.AGENT_POLL_MS || 8000);

function loadKeypair() {
  if (process.env.STELLAR_AGENT_SECRET) {
    return Keypair.fromSecret(process.env.STELLAR_AGENT_SECRET);
  }
  const kp = Keypair.random();
  console.log("[agent] generated ephemeral Stellar identity:", kp.publicKey());
  console.log("[agent] set STELLAR_AGENT_SECRET to persist it:", kp.secret());
  return kp;
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
  });
  return res.json().catch(() => ({}));
}

async function register(address) {
  const r = await api("/api/agents/register", {
    method: "POST",
    body: JSON.stringify({
      pubkey: address,
      name: `RefAgent_${address.slice(-4)}`,
      capabilities: ["task_solving"],
    }),
  });
  console.log("[agent] register:", r.message || r.error || JSON.stringify(r));
}

async function fetchApiKey(address) {
  const r = await api(`/api/agents/application-status?pubkey=${address}`);
  return r.apiKey || null;
}

async function solve(task) {
  const prompt = `Task: ${task.description}\nCriteria: ${task.criteria}\nProvide the best possible answer.`;
  if (process.env.ANTHROPIC_API_KEY) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      }),
    }).then((x) => x.json());
    return r.content?.[0]?.text ?? "";
  }
  if (process.env.OPENAI_API_KEY) {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_CHAT_MODEL_AGENT || "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
      }),
    }).then((x) => x.json());
    return r.choices?.[0]?.message?.content ?? "";
  }
  throw new Error("No LLM key configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY).");
}

async function main() {
  const kp = loadKeypair();
  const address = kp.publicKey();

  await register(address);

  let apiKey = null;
  while (!apiKey) {
    apiKey = await fetchApiKey(address);
    if (!apiKey) {
      console.log("[agent] awaiting admin approval…");
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
  console.log("[agent] approved — API key acquired.");

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
