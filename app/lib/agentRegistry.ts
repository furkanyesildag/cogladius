/**
 * Agent Registry — Cogladius'a kayıtlı dış OpenClaw agentlarını yönetir.
 *
 * Production (Vercel): Upstash Redis kullanır.
 * Local development: JSON dosyasına yazar.
 */

import crypto from "crypto";
import { getRedis } from "./redis";
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

// One hash field per agent, plus an apiKey index, so a write touches one agent.
// A Redis failure must throw: treating it as an empty registry once wiped the store risk.
const HEARTBEAT_WRITE_MS = 10 * 60 * 1000;
const HASH_KEY = "cogladius:agents:v2";
const KEY_INDEX = "cogladius:agent-key-index";

async function loadRegistry(): Promise<Record<string, RegisteredAgent>> {
  const r = getRedis();
  if (!r) return localLoad();
  return (await r.hgetall<Record<string, RegisteredAgent>>(HASH_KEY)) ?? {};
}

async function readAgent(pubkey: string): Promise<RegisteredAgent | null> {
  const r = getRedis();
  if (!r) return localLoad()[pubkey] ?? null;
  return (await r.hget<RegisteredAgent>(HASH_KEY, pubkey)) ?? null;
}

async function writeAgent(agent: RegisteredAgent, previousApiKey?: string) {
  const r = getRedis();
  if (!r) {
    const registry = localLoad();
    registry[agent.pubkey] = agent;
    localSave(registry);
    return;
  }
  const p = r.pipeline();
  p.hset(HASH_KEY, { [agent.pubkey]: agent });
  p.hset(KEY_INDEX, { [agent.apiKey]: agent.pubkey });
  if (previousApiKey && previousApiKey !== agent.apiKey) p.hdel(KEY_INDEX, previousApiKey);
  await p.exec();
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
  const existing = await readAgent(pubkey);
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

  await writeAgent(agent, existing?.apiKey);
  return agent;
}

export async function getAgent(pubkey: string): Promise<RegisteredAgent | null> {
  return readAgent(pubkey);
}

export async function getAgentByApiKey(apiKey: string): Promise<RegisteredAgent | null> {
  const r = getRedis();
  if (!r) return Object.values(localLoad()).find((a) => a.apiKey === apiKey) ?? null;
  const pubkey = await r.hget<string>(KEY_INDEX, apiKey);
  if (!pubkey) return null;
  const agent = await readAgent(pubkey);
  return agent?.apiKey === apiKey ? agent : null;
}

export async function getAllAgents(): Promise<RegisteredAgent[]> {
  return Object.values(await loadRegistry());
}

/** One page of approved agents, without loading the whole registry. */
export async function getApprovedAgentsPage(limit: number, cursor = "0"): Promise<{ agents: RegisteredAgent[]; total: number; nextCursor: string | null }> {
  const r = getRedis();
  if (!r) {
    const all = Object.values(localLoad()).filter((a) => !a.isBanned && a.approvalStatus === "approved");
    const at = Number(cursor) || 0;
    return { agents: all.slice(at, at + limit), total: all.length, nextCursor: at + limit < all.length ? String(at + limit) : null };
  }
  const [next, flat] = await r.hscan(HASH_KEY, cursor, { count: limit });
  const agents: RegisteredAgent[] = [];
  for (let i = 1; i < flat.length; i += 2) {
    const raw = flat[i] as unknown;
    const a = (typeof raw === "string" ? JSON.parse(raw) : raw) as RegisteredAgent;
    if (!a.isBanned && a.approvalStatus === "approved") agents.push(a);
  }
  const total = await r.hlen(HASH_KEY);
  return { agents, total, nextCursor: String(next) === "0" ? null : String(next) };
}

export async function updateAgentHeartbeat(
  pubkey: string,
  status: AgentNetworkStatus = "online"
): Promise<void> {
  const agent = await readAgent(pubkey);
  if (!agent) return;
  // Thousands of agents poll: only write when something a viewer would notice changed.
  if (agent.status === status && Date.now() - new Date(agent.lastSeen).getTime() < HEARTBEAT_WRITE_MS) return;
  agent.lastSeen = new Date().toISOString();
  agent.status = status;
  await writeAgent(agent);
}

export async function updateAgentStats(
  pubkey: string,
  update: Partial<RegisteredAgent["stats"]>
): Promise<void> {
  const agent = await readAgent(pubkey);
  if (!agent) return;
  agent.stats = { ...agent.stats, ...update };
  const s = agent.stats;
  if (s.tasksCompleted > 0) {
    s.avgScore = Math.round(s.totalScore / s.tasksCompleted);
    s.successRate = Math.round((s.tasksCompleted / s.tasksAttempted) * 100);
  }
  await writeAgent(agent);
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
  const agent = await readAgent(pubkey);
  if (!agent) return;
  agent.specialties = specialties;
  await writeAgent(agent);
}
