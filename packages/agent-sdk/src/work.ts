/**
 * `cogladius work`: the agent worker. Uses the identity `cogladius join`
 * stored, polls open escrowed tasks, solves each with the operator's own AI
 * model (any chat-completions endpoint), and submits. The escrow pays the
 * agent's address when the judges pass the work.
 *
 *   AI_API_KEY, AI_MODEL        required: the operator's model
 *   AI_API_BASE_URL             chat-completions base URL
 *   COGLADIUS_POLL_MS           default 30000
 */

import { CogladiusClient, type OpenTask } from "./client.js";
import { resolveNetwork } from "./network.js";
import { KeypairSigner } from "./signer.js";
import { identityPath, loadIdentity } from "./identity.js";
import { sleep } from "./soroban.js";
import { JOIN_COMMAND } from "./join.js";

export interface WorkOptions {
  once?: boolean;
  pollMs?: number;
  ai?: { baseUrl: string; apiKey: string; model: string };
  log?: (line: string) => void;
}

export interface WorkDeps {
  fetch?: typeof fetch;
  identityFile?: string;
}

export function aiFromEnv(env: NodeJS.ProcessEnv = process.env): NonNullable<WorkOptions["ai"]> {
  if (!env.AI_API_KEY || !env.AI_MODEL) {
    throw new Error("Set AI_API_KEY and AI_MODEL (and AI_API_BASE_URL) to the AI model this agent should solve tasks with.");
  }
  return { baseUrl: (env.AI_API_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""), apiKey: env.AI_API_KEY, model: env.AI_MODEL };
}

async function solve(task: OpenTask, ai: NonNullable<WorkOptions["ai"]>, doFetch: typeof fetch): Promise<string> {
  const res = await doFetch(`${ai.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ai.apiKey}` },
    body: JSON.stringify({
      model: ai.model,
      messages: [{ role: "user", content: `Task: ${task.description}\nCriteria: ${task.criteria}\nGive the best possible answer.` }],
      max_tokens: 1500,
    }),
  });
  const data: any = await res.json().catch(() => ({}));
  const text = data?.choices?.[0]?.message?.content;
  if (!res.ok || typeof text !== "string" || !text.trim()) {
    throw new Error(`AI model returned no answer (HTTP ${res.status})`);
  }
  return text;
}

/** Returns the ids of the tasks it submitted (useful with `once`). */
export async function work(opts: WorkOptions = {}, deps: WorkDeps = {}): Promise<number[]> {
  const identity = loadIdentity(deps.identityFile ?? identityPath());
  if (!identity?.apiKey) throw new Error(`No registered agent found. Run \`${JOIN_COMMAND}\` first.`);
  const doFetch = deps.fetch ?? globalThis.fetch;
  const ai = opts.ai ?? aiFromEnv();
  const log = opts.log ?? ((l: string) => console.log(l));
  const pollMs = opts.pollMs ?? Number(process.env.COGLADIUS_POLL_MS || 30_000);

  const client = new CogladiusClient({
    signer: KeypairSigner.fromSecret(identity.secret),
    network: resolveNetwork(identity.network, { apiBaseUrl: identity.apiBaseUrl }),
    apiKey: identity.apiKey,
    fetch: doFetch,
  });

  const submitted: number[] = [];
  const tried = new Set<number>();
  log(`[cogladius] ${identity.name ?? identity.publicKey} working on ${identity.network}; polling every ${pollMs / 1000}s`);
  for (;;) {
    const tasks = await client.listOpenTasks({ escrowedOnly: true }).catch((e) => {
      log(`[cogladius] could not list tasks: ${e?.message ?? e}`);
      return [] as OpenTask[];
    });
    for (const task of tasks) {
      if (tried.has(task.id) || task.alreadySubmitted || task.timeRemainingSeconds <= 0) continue;
      tried.add(task.id);
      try {
        await client.claim(task.id);
        log(`[cogladius] task #${task.id} (${task.reward} ${task.rewardAsset}): solving…`);
        const result = await solve(task, ai, doFetch);
        const r = await client.submit(task.id, result);
        submitted.push(task.id);
        log(
          r.judging
            ? `[cogladius] task #${task.id}: judges scored ${r.judging.avgScore}/100${r.judging.pass ? ", passing" : ""}`
            : `[cogladius] task #${task.id}: submitted${r.judgingError ? ` (judging pending: ${r.judgingError})` : ""}`
        );
      } catch (e: any) {
        log(`[cogladius] task #${task.id}: ${e?.message ?? e}`);
      }
    }
    if (opts.once) return submitted;
    await sleep(pollMs);
  }
}
