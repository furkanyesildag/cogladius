/**
 * Agent Application Store
 *
 * Yeni kayıt istekleri burada "pending" olarak tutulur.
 * Admin onaylayana kadar agent aktif listeye girmez.
 */

import crypto from "crypto";
import { getRedis } from "./redis";
import type { AgentSpecialty } from "./types";

export type ApplicationStatus = "pending" | "approved" | "rejected";

export interface AgentApplication {
  id: string;
  pubkey: string;
  name: string;
  /** Stellar testnet address (G...) to receive XLM reward payouts. */
  stellarAddress?: string;
  email?: string;
  description?: string;
  llmProvider?: string;
  llmModel?: string;
  openclawVersion?: string;
  specialties: AgentSpecialty[];
  capabilities: string[];
  config: {
    maxRewardUsdc: number;
    minRewardUsdc: number;
    personality: string;
    autoDispute: boolean;
    useX402: boolean;
    x402BudgetPerTask: number;
  };
  submittedAt: string;
  status: ApplicationStatus;
  reviewedAt?: string;
  reviewNote?: string;
  /** Only set after admin approval. Shown once to the applicant. */
  apiKey?: string;
  apiKeyRetrieved: boolean;
}

const REDIS_KEY = "cogladius:applications";

// ── Local FS fallback ─────────────────────────────────────────────────────────

function fsPath() {
  const { join } = require("path");
  const dir = process.env.AGENT_REGISTRY_DIR || join(process.cwd(), ".agent-registry");
  return { dir, file: join(dir, "applications.json") };
}

function localLoad(): Record<string, AgentApplication> {
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

function localSave(store: Record<string, AgentApplication>) {
  try {
    const { writeFileSync, mkdirSync, existsSync } = require("fs");
    const { dir, file } = fsPath();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(store, null, 2), "utf-8");
  } catch { /* serverless ortamda sessizce geç */ }
}

// ── Redis helpers ─────────────────────────────────────────────────────────────

async function redisLoad(): Promise<Record<string, AgentApplication> | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    return (await r.get<Record<string, AgentApplication>>(REDIS_KEY)) ?? {};
  } catch {
    return null;
  }
}

async function redisSave(store: Record<string, AgentApplication>) {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(REDIS_KEY, store);
  } catch { /* ignore */ }
}

async function load(): Promise<Record<string, AgentApplication>> {
  const fromRedis = await redisLoad();
  return fromRedis !== null ? fromRedis : localLoad();
}

async function save(store: Record<string, AgentApplication>) {
  const r = getRedis();
  r ? await redisSave(store) : localSave(store);
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function createApplication(
  data: Omit<AgentApplication, "id" | "submittedAt" | "status" | "apiKeyRetrieved">
): Promise<AgentApplication> {
  const store = await load();
  // Same pubkey can only have one pending application at a time
  const existing = Object.values(store).find(
    (a) => a.pubkey === data.pubkey && a.status === "pending"
  );
  if (existing) return existing;

  const app: AgentApplication = {
    ...data,
    id: crypto.randomBytes(12).toString("hex"),
    submittedAt: new Date().toISOString(),
    status: "pending",
    apiKeyRetrieved: false,
  };
  store[app.id] = app;
  await save(store);
  return app;
}

export async function getApplication(id: string): Promise<AgentApplication | null> {
  return (await load())[id] ?? null;
}

export async function getApplicationByPubkey(pubkey: string): Promise<AgentApplication | null> {
  const all = Object.values(await load());
  // Return latest application for this pubkey
  return (
    all
      .filter((a) => a.pubkey === pubkey)
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())[0] ??
    null
  );
}

export async function getAllApplications(): Promise<AgentApplication[]> {
  return Object.values(await load()).sort(
    (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
  );
}

export async function getPendingApplications(): Promise<AgentApplication[]> {
  return (await getAllApplications()).filter((a) => a.status === "pending");
}

export async function approveApplication(
  id: string,
  apiKey: string,
  reviewNote?: string
): Promise<AgentApplication | null> {
  const store = await load();
  if (!store[id]) return null;
  store[id] = {
    ...store[id],
    status: "approved",
    reviewedAt: new Date().toISOString(),
    reviewNote,
    apiKey,
    apiKeyRetrieved: false,
  };
  await save(store);
  return store[id];
}

export async function rejectApplication(
  id: string,
  reviewNote?: string
): Promise<AgentApplication | null> {
  const store = await load();
  if (!store[id]) return null;
  store[id] = {
    ...store[id],
    status: "rejected",
    reviewedAt: new Date().toISOString(),
    reviewNote,
  };
  await save(store);
  return store[id];
}

export async function markApiKeyRetrieved(id: string): Promise<void> {
  const store = await load();
  if (!store[id]) return;
  store[id].apiKeyRetrieved = true;
  await save(store);
}
