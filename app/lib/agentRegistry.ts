/**
 * Agent Registry — Cogladius'a kayıtlı dış OpenClaw agentlarını yönetir.
 *
 * Production (Vercel): Upstash Redis kullanır.
 * Local development: JSON dosyasına yazar.
 */

import crypto from "crypto";
import { getRedis, withRedisLock } from "./redis";
import type { AgentSpecialty } from "./types";

export type AgentTier = "free" | "pro" | "elite";
export type AgentNetworkStatus = "online" | "offline" | "idle" | "working";
export type AgentApprovalStatus = "approved" | "pending" | "rejected";

export interface RegisteredAgent {
  pubkey: string;
  apiKey: string;
  name: string;
  /** Stellar testnet address (G...) used to receive XLM reward payouts. */
  stellarAddress?: string;
  openclawVersion?: string;
  llmProvider?: "openai" | "anthropic" | "ollama" | "openrouter" | "other";
  llmModel?: string;
  capabilities: string[];
  specialties: AgentSpecialty[];
  config: {
    maxRewardUsdc: number;
    minRewardUsdc: number;
    autoDispute: boolean;
    useX402: boolean;
    x402BudgetPerTask: number;
    personality: "fast" | "thorough" | "balanced";
  };
  registeredAt: string;
  lastSeen: string;
  status: AgentNetworkStatus;
  stats: {
    tasksAttempted: number;
    tasksCompleted: number;
    totalScore: number;
    totalEarned: number;
    x402Spent: number;
    disputesWon: number;
    disputesLost: number;
    avgScore: number;
    successRate: number;
  };
  tier: AgentTier;
  approvalStatus: AgentApprovalStatus;
  isBanned: boolean;
  banReason?: string;
  /** True once the agent proved ownership of `pubkey` with a signed challenge. */
  verified?: boolean;
}

const REDIS_KEY = "cogladius:agents";

// ── Local FS fallback ─────────────────────────────────────────────────────────

function fsPath() {
  const { join } = require("path");
  const dir = process.env.AGENT_REGISTRY_DIR || join(process.cwd(), ".agent-registry");
  return { dir, file: join(dir, "agents.json") };
}

function localLoad(): Record<string, RegisteredAgent> {
  try {
    const { existsSync, readFileSync, mkdirSync } = require("fs");
    const { dir, file } = fsPath();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (!existsSync(file)) return {};
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return {};
  }
}

function localSave(registry: Record<string, RegisteredAgent>) {
  try {
    const { writeFileSync, mkdirSync, existsSync } = require("fs");
    const { dir, file } = fsPath();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(registry, null, 2), "utf-8");
  } catch { /* serverless ortamda sessizce geç */ }
}

// ── Redis helpers ─────────────────────────────────────────────────────────────

async function redisLoad(): Promise<Record<string, RegisteredAgent> | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    const data = await r.get<Record<string, RegisteredAgent>>(REDIS_KEY);
    return data ?? {};
  } catch {
    return null;
  }
}

async function redisSave(registry: Record<string, RegisteredAgent>) {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(REDIS_KEY, registry);
  } catch { /* ignore */ }
}

async function loadRegistry(): Promise<Record<string, RegisteredAgent>> {
  const fromRedis = await redisLoad();
  if (fromRedis !== null) return fromRedis;
  return localLoad();
}

/**
 * Load → change → save under the registry lock. With Redis configured, a failed
 * read throws instead of falling back to an empty registry: saving that empty
 * copy would wipe every agent.
 */
async function mutateRegistry<T>(fn: (registry: Record<string, RegisteredAgent>) => T | Promise<T>): Promise<T> {
  return withRedisLock("agents", async () => {
    const r = getRedis();
    let registry: Record<string, RegisteredAgent>;
    if (r) {
      const data = await r.get<Record<string, RegisteredAgent>>(REDIS_KEY); // throws on failure: nothing is written
      registry = data ?? {};
    } else {
      registry = localLoad();
    }
    const out = await fn(registry);
    await saveRegistry(registry);
    return out;
  });
}

async function saveRegistry(registry: Record<string, RegisteredAgent>) {
  const r = getRedis();
  if (r) {
    await redisSave(registry);
  } else {
    localSave(registry);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function generateApiKey(): string {
  return "claw_" + crypto.randomBytes(24).toString("hex");
}

export async function registerAgent(
  pubkey: string,
  name: string,
  options: Partial<Pick<RegisteredAgent, "openclawVersion" | "llmProvider" | "llmModel" | "capabilities" | "specialties" | "config" | "stellarAddress" | "verified">> & {
    /** Issue a fresh API key, invalidating the old one. */
    rotateApiKey?: boolean;
  }
): Promise<RegisteredAgent> {
  return mutateRegistry((registry) => {
  const existing = registry[pubkey];
  const apiKey = !existing || options.rotateApiKey ? generateApiKey() : existing.apiKey;

  const agent: RegisteredAgent = {
    pubkey,
    apiKey,
    name: name || `Agent_${pubkey.slice(-6)}`,
    stellarAddress: options.stellarAddress ?? existing?.stellarAddress,
    openclawVersion: options.openclawVersion,
    llmProvider: options.llmProvider ?? "openai",
    llmModel: options.llmModel ?? "",
    capabilities: options.capabilities ?? ["task_solving", "x402_payments"],
    specialties: options.specialties ?? existing?.specialties ?? [],
    config: {
      maxRewardUsdc: options.config?.maxRewardUsdc ?? 10,
      minRewardUsdc: options.config?.minRewardUsdc ?? 0.001,
      autoDispute: options.config?.autoDispute ?? false,
      useX402: options.config?.useX402 ?? true,
      x402BudgetPerTask: options.config?.x402BudgetPerTask ?? 0.01,
      personality: options.config?.personality ?? "balanced",
    },
    registeredAt: existing?.registeredAt ?? new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    status: "online",
    stats: existing?.stats ?? {
      tasksAttempted: 0, tasksCompleted: 0, totalScore: 0,
      totalEarned: 0, x402Spent: 0, disputesWon: 0, disputesLost: 0,
      avgScore: 0, successRate: 0,
    },
    tier: existing?.tier ?? "free",
    approvalStatus: existing?.approvalStatus ?? "approved",
    isBanned: existing?.isBanned ?? false,
    banReason: existing?.banReason,
    verified: options.verified ?? existing?.verified ?? false,
  };

  registry[pubkey] = agent;
  return agent;
  });
}

export async function getAgent(pubkey: string): Promise<RegisteredAgent | null> {
  const registry = await loadRegistry();
  return registry[pubkey] ?? null;
}

export async function getAgentByApiKey(apiKey: string): Promise<RegisteredAgent | null> {
  const registry = await loadRegistry();
  return Object.values(registry).find((a) => a.apiKey === apiKey) ?? null;
}

export async function getAllAgents(): Promise<RegisteredAgent[]> {
  return Object.values(await loadRegistry());
}

export async function updateAgentHeartbeat(
  pubkey: string,
  status: AgentNetworkStatus = "online"
): Promise<void> {
  // Every task poll is a heartbeat. Skip the write when nothing visible would
  // change, so polling agents do not queue up behind the registry lock.
  const current = await getAgent(pubkey);
  if (!current) return;
  if (current.status === status && Date.now() - new Date(current.lastSeen).getTime() < 30_000) return;
  await mutateRegistry((registry) => {
    if (!registry[pubkey]) return;
    registry[pubkey].lastSeen = new Date().toISOString();
    registry[pubkey].status = status;
  });
}

export async function updateAgentStats(
  pubkey: string,
  update: Partial<RegisteredAgent["stats"]>
): Promise<void> {
  await mutateRegistry((registry) => {
    if (!registry[pubkey]) return;
    registry[pubkey].stats = { ...registry[pubkey].stats, ...update };
    const s = registry[pubkey].stats;
    if (s.tasksCompleted > 0) {
      s.avgScore = Math.round(s.totalScore / s.tasksCompleted);
      s.successRate = Math.round((s.tasksCompleted / s.tasksAttempted) * 100);
    }
  });
}

/** Add to counters atomically (under the registry lock), from the stored values. */
export async function incrementAgentStats(
  pubkey: string,
  delta: Partial<Pick<RegisteredAgent["stats"], "tasksAttempted" | "tasksCompleted" | "totalScore" | "totalEarned" | "x402Spent">>
): Promise<void> {
  await mutateRegistry((registry) => {
    const a = registry[pubkey];
    if (!a) return;
    for (const [k, v] of Object.entries(delta) as [keyof typeof delta, number][]) {
      a.stats[k] = (a.stats[k] ?? 0) + (Number.isFinite(v) ? v : 0);
    }
    if (a.stats.tasksCompleted > 0) {
      a.stats.avgScore = Math.round(a.stats.totalScore / a.stats.tasksCompleted);
      a.stats.successRate = Math.round((a.stats.tasksCompleted / Math.max(a.stats.tasksAttempted, 1)) * 100);
    }
  });
}

/** Delete agents by pubkey (admin cleanup). Returns the pubkeys that existed. */
export async function removeAgents(pubkeys: string[]): Promise<string[]> {
  return mutateRegistry((registry) => {
    const removed = pubkeys.filter((k) => registry[k]);
    for (const k of removed) delete registry[k];
    return removed;
  });
}

export async function validateApiKey(apiKey: string): Promise<RegisteredAgent | null> {
  const agent = await getAgentByApiKey(apiKey);
  if (!agent || agent.isBanned || agent.approvalStatus !== "approved") return null;
  return agent;
}

export async function getAllApprovedAgents(): Promise<RegisteredAgent[]> {
  const all = await getAllAgents();
  return all.filter((a) => !a.isBanned && a.approvalStatus === "approved");
}

export async function getAgentsBySpecialty(specialty: AgentSpecialty): Promise<RegisteredAgent[]> {
  const all = await getAllAgents();
  return all.filter((a) => !a.isBanned && a.specialties.includes(specialty));
}

export async function updateAgentSpecialties(
  pubkey: string,
  specialties: AgentSpecialty[]
): Promise<void> {
  await mutateRegistry((registry) => {
    if (!registry[pubkey]) return;
    registry[pubkey].specialties = specialties;
  });
}
