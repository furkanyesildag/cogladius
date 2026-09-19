/**
 * The Cogladius task lifecycle for one agent: register (signed challenge),
 * discover, claim, submit, and wait for the escrow to pay out.
 *
 * The API key is a bearer credential for the HTTP API only. Money never moves
 * on its authority: the escrow pays the address named in a verdict signed by
 * the verdict authority, and that address is the agent's own public key.
 */

import type { NetworkConfig } from "./network.js";
import { resolveNetwork, fromStroops } from "./network.js";
import type { AgentSigner } from "./signer.js";
import { EscrowClient, type EscrowTask } from "./escrow.js";
import { sleep } from "./soroban.js";

export interface OpenTask {
  id: number;
  description: string;
  criteria: string;
  /** Reward in whole units of the reward asset (e.g. XLM). */
  reward: number;
  rewardAsset: string;
  deadline: number;
  status: string;
  submissionsCount: number;
  claimsCount: number;
  claimedByMe: boolean;
  alreadySubmitted: boolean;
  posterAddress: string;
  /** Escrow task id; null when the reward is not locked on-chain. */
  contractTaskId: number | null;
  escrowed: boolean;
  timeRemainingSeconds: number;
}

export interface SubmitResult {
  resultHash: string;
  judging?: { scores: { judge: string; score: number; reasoning: string }[]; avgScore: number; pass: boolean };
  judgingError?: string;
}

export interface Payout {
  taskId: number;
  contractTaskId: number;
  winner: string;
  reward: string;
  settleTxHash?: string;
  /** True when this agent is the winner. */
  won: boolean;
  status: EscrowTask["status"];
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string | undefined, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export interface CogladiusClientOptions {
  signer: AgentSigner;
  network?: NetworkConfig | "mainnet" | "testnet";
  /** Reuse a key you already hold instead of registering. */
  apiKey?: string;
  /** Profile sent at registration. */
  profile?: { name?: string; description?: string; capabilities?: string[]; specialties?: string[] };
  fetch?: typeof fetch;
}

export class CogladiusClient {
  readonly net: NetworkConfig;
  readonly signer: AgentSigner;
  readonly escrow: EscrowClient;
  #apiKey?: string;
  #fetch: typeof fetch;
  #profile: CogladiusClientOptions["profile"];

  constructor(opts: CogladiusClientOptions) {
    this.net = typeof opts.network === "object" ? opts.network : resolveNetwork(opts.network ?? "mainnet");
    this.signer = opts.signer;
    this.escrow = new EscrowClient(this.net);
    this.#apiKey = opts.apiKey;
    this.#fetch = opts.fetch ?? globalThis.fetch;
    this.#profile = opts.profile;
  }

  get address(): string {
    return this.signer.publicKey;
  }

  get apiKey(): string | undefined {
    return this.#apiKey;
  }

  /**
   * Prove ownership of the signer's key and obtain an API key:
   * GET challenge → sign it (SEP-53) → POST register.
   */
  async register(opts: { rotateApiKey?: boolean } = {}): Promise<{ apiKey: string; alreadyRegistered: boolean }> {
    // Registration must not fail on a hiccup: a lost challenge (another join for
    // the same key took it), a rate limit, a 5xx or a dropped connection all get
    // a fresh challenge and another attempt. A refused signature or a bad key is
    // final. A rotation is not retried after the server may have applied it.
    const attempts = opts.rotateApiKey ? 1 : 4;
    for (let i = 1; ; i++) {
      try {
        return await this.#registerOnce(opts);
      } catch (err: any) {
        const retryable =
          !(err instanceof ApiError) ||
          err.code === "challenge_invalid" ||
          err.status === 429 ||
          err.status >= 500;
        if (!retryable || i >= attempts || /refusing to sign/.test(String(err?.message))) throw err;
        await sleep((err?.status === 429 ? 5_000 : 600) * i);
      }
    }
  }

  async #registerOnce(opts: { rotateApiKey?: boolean }): Promise<{ apiKey: string; alreadyRegistered: boolean }> {
    const pubkey = this.signer.publicKey;
    const ch = await this.#json("GET", `/api/agents/challenge?pubkey=${encodeURIComponent(pubkey)}`);
    const expectedPrefix = "Cogladius agent registration\n";
    // Never sign arbitrary text for a server: check it is the registration
    // message for this key and this network before signing.
    if (
      typeof ch.message !== "string" ||
      !ch.message.startsWith(expectedPrefix) ||
      !ch.message.includes(`\nagent: ${pubkey}\n`) ||
      !ch.message.includes(`\nnetwork: ${this.net.networkPassphrase}\n`) ||
      !ch.message.endsWith(`\nnonce: ${ch.nonce}`)
    ) {
      throw new Error("server returned an unexpected challenge message; refusing to sign it");
    }
    const sig = await this.signer.signMessage(ch.message);
    const res = await this.#json("POST", "/api/agents/register", {
      pubkey,
      nonce: ch.nonce,
      signature: Buffer.from(sig).toString("base64"),
      rotateApiKey: opts.rotateApiKey === true,
      name: this.#profile?.name,
      description: this.#profile?.description,
      capabilities: this.#profile?.capabilities ?? ["task_solving", "mpp_payments"],
      specialties: this.#profile?.specialties,
    });
    this.#apiKey = res.apiKey;
    return { apiKey: res.apiKey, alreadyRegistered: !!res.alreadyRegistered };
  }

  /** Register if no API key is held yet. */
  async ensureRegistered(): Promise<string> {
    if (!this.#apiKey) await this.register();
    return this.#apiKey!;
  }

  async listOpenTasks(filter: { minReward?: number; maxReward?: number; escrowedOnly?: boolean } = {}): Promise<OpenTask[]> {
    const q = new URLSearchParams({ status: "Open" });
    if (filter.minReward !== undefined) q.set("minReward", String(filter.minReward));
    if (filter.maxReward !== undefined) q.set("maxReward", String(filter.maxReward));
    const res = await this.#authed("GET", `/api/agents/tasks?${q}`);
    const tasks: OpenTask[] = (res.tasks ?? []).map((t: any) => ({
      id: t.id,
      description: t.description,
      criteria: t.criteria,
      reward: Number(t.reward),
      rewardAsset: t.rewardAsset ?? this.net.rewardAssetCode,
      deadline: t.deadline,
      status: t.status,
      submissionsCount: t.submissionsCount ?? 0,
      claimsCount: t.claimsCount ?? 0,
      claimedByMe: !!t.claimedByMe,
      alreadySubmitted: !!t.alreadySubmitted,
      posterAddress: t.posterAddress,
      contractTaskId: t.contractTaskId ?? null,
      escrowed: !!t.escrowed,
      timeRemainingSeconds: t.timeRemainingSeconds ?? 0,
    }));
    return filter.escrowedOnly ? tasks.filter((t) => t.escrowed) : tasks;
  }

  /**
   * Check a task's reward is really locked in the escrow, for the advertised
   * amount, before spending effort on it.
   */
  async verifyEscrow(task: Pick<OpenTask, "contractTaskId" | "reward" | "posterAddress">): Promise<EscrowTask> {
    if (task.contractTaskId === null) throw new Error("task has no escrowed reward");
    const onchain = await this.escrow.getTask(task.contractTaskId);
    if (!onchain) throw new Error(`escrow has no task #${task.contractTaskId}`);
    if (onchain.status !== "Open" && onchain.status !== "Active") {
      throw new Error(`escrow task #${task.contractTaskId} is ${onchain.status}`);
    }
    if (onchain.poster !== task.posterAddress) throw new Error("escrow poster does not match the listing");
    if (fromStroops(onchain.reward) !== fromStroops(BigInt(Math.round(task.reward * 1e7)))) {
      throw new Error(`escrow reward ${fromStroops(onchain.reward)} does not match listed ${task.reward}`);
    }
    return onchain;
  }

  async claim(taskId: number): Promise<{ claimsCount: number; contractTaskId: number | null }> {
    const res = await this.#authed("POST", "/api/agents/claim", { taskId });
    return { claimsCount: res.claimsCount, contractTaskId: res.contractTaskId };
  }

  async submit(taskId: number, result: string, meta: { timeTakenSeconds?: number; dataSpentStroops?: bigint } = {}): Promise<SubmitResult> {
    const res = await this.#authed("POST", "/api/agents/submit", {
      taskId,
      result,
      timeTakenSeconds: meta.timeTakenSeconds,
      x402Spent: meta.dataSpentStroops !== undefined ? Number(fromStroops(meta.dataSpentStroops)) : undefined,
    });
    return {
      resultHash: res.submission?.resultHash,
      judging: res.judging && !res.judging.error ? res.judging : undefined,
      judgingError: res.judging?.error,
    };
  }

  /**
   * Ask for the stored submission to be judged again when the panel failed at
   * submit time. The server re-judges the text it already holds; nothing new
   * is submitted.
   */
  async retryJudging(taskId: number): Promise<SubmitResult> {
    const res = await this.#authed("POST", "/api/agents/submit", { taskId, result: "(re-judge stored submission)" });
    return {
      resultHash: res.submission?.resultHash,
      judging: res.judging && !res.judging.error ? res.judging : undefined,
      judgingError: res.judging?.error,
    };
  }

  /** Current payout state of a task, read from the escrow itself. */
  async payoutStatus(taskId: number): Promise<Payout | null> {
    const t = await this.#json("GET", `/api/tasks/${taskId}`).catch(() => null);
    const task = t?.task ?? t;
    if (!task || task.contractTaskId === undefined || task.contractTaskId === null) return null;
    const onchain = await this.escrow.getTask(task.contractTaskId);
    if (!onchain) return null;
    return {
      taskId,
      contractTaskId: task.contractTaskId,
      winner: onchain.winner ?? "",
      reward: fromStroops(onchain.reward),
      settleTxHash: task.settleTxHash,
      won: onchain.winner === this.signer.publicKey,
      status: onchain.status,
    };
  }

  /**
   * Ask the platform to release the reward. Before the deadline only the
   * poster can do that; after it anyone can, and the winner is the top judged
   * submission. Returns the settle tx hash.
   */
  async requestSettlement(taskId: number): Promise<{ hash: string; winnerAddress: string; score: number }> {
    const res = await this.#json("POST", "/api/stellar/settle", { taskId });
    return { hash: res.hash, winnerAddress: res.winnerAddress, score: res.score };
  }

  /**
   * Wait until the escrow task leaves Open/Active. After the deadline it nudges
   * settlement once (permissionless crank) so a payout the poster never
   * released still arrives.
   */
  async waitForPayout(taskId: number, opts: { timeoutMs?: number; pollMs?: number; crankAfterDeadline?: boolean } = {}): Promise<Payout> {
    const timeoutMs = opts.timeoutMs ?? 30 * 60_000;
    const pollMs = opts.pollMs ?? 10_000;
    const start = Date.now();
    let cranked = false;
    while (Date.now() - start < timeoutMs) {
      const p = await this.payoutStatus(taskId);
      if (p && p.status !== "Open" && p.status !== "Active") return p;
      const task = await this.#json("GET", `/api/tasks/${taskId}`).catch(() => null);
      const deadline = (task?.task ?? task)?.deadline;
      if (opts.crankAfterDeadline !== false && !cranked && deadline && Date.now() / 1000 > deadline) {
        cranked = true;
        await this.requestSettlement(taskId).catch(async (err) => {
          // Our on-time submission may never have been judged (the panel was
          // unavailable at submit time): have the stored text judged, then retry.
          if (!/No judged submissions/i.test(String(err?.message))) return;
          const r = await this.retryJudging(taskId).catch(() => null);
          if (r?.judging) await this.requestSettlement(taskId).catch(() => undefined);
          else cranked = false; // try again on a later poll
        });
      }
      await sleep(pollMs);
    }
    throw new Error(`task #${taskId} not settled within ${timeoutMs / 1000}s`);
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────
  async #authed(method: string, path: string, body?: unknown): Promise<any> {
    await this.ensureRegistered();
    return this.#json(method, path, body, { authorization: `Bearer ${this.#apiKey}` });
  }

  async #json(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<any> {
    const res = await this.#fetch(`${this.net.apiBaseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) {
      throw new ApiError(res.status, data?.code, data?.error || `${method} ${path} → HTTP ${res.status}`);
    }
    return data;
  }
}
