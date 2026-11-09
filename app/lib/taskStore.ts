/**
 * Task Store — kalıcı görev geçmişi.
 *
 * Production (Vercel): Upstash Redis kullanır.
 * Local development: JSON dosyasına yazar (UPSTASH env yok ise).
 */

import type { Task, TaskStatus } from "./types";
import { getRedis, withRedisLock } from "./redis";

// ── Local FS fallback ─────────────────────────────────────────────────────────
const REDIS_KEY = "cogladius:tasks";

function fsPath() {
  const { join } = require("path");
  const dir = process.env.TASK_STORE_DIR || join(process.cwd(), ".agent-registry");
  return { dir, file: join(dir, "tasks.json") };
}

function localLoad(): Record<number, Task> {
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

function localSave(tasks: Record<number, Task>) {
  try {
    const { writeFileSync, mkdirSync, existsSync } = require("fs");
    const { dir, file } = fsPath();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(tasks, null, 2), "utf-8");
  } catch { /* /tmp dışında yazılamıyor olabilir — sessizce geç */ }
}

// ── Redis helpers ─────────────────────────────────────────────────────────────
//
// The whole store is one value (~200 KB) and workers poll all day, so reads keep
// a copy in memory and only fetch the value again when its version changed.
// Every write bumps VER_KEY, a few bytes, in the same transaction as the value.

const VER_KEY = "cogladius:tasks:ver";
const g = globalThis as unknown as { __cogTasks?: { ver: string; tasks: Record<number, Task>; checkedAt: number } };

// A failed read must throw: treating it as empty would let the next save wipe the store.
async function redisLoadFresh(): Promise<Record<number, Task>> {
  const r = getRedis()!;
  return (await r.get<Record<number, Task>>(REDIS_KEY)) ?? {};
}

/** The stored value, from memory when its version is unchanged. `maxAgeMs` skips even the version check. */
async function redisLoad(maxAgeMs = 0): Promise<Record<number, Task>> {
  const r = getRedis()!;
  const mem = g.__cogTasks;
  if (mem && maxAgeMs > 0 && Date.now() - mem.checkedAt < maxAgeMs) return mem.tasks;
  // Version first, then the value: a write landing in between leaves a newer value under an older
  // version, which the next check simply reloads.
  const ver = String((await r.get<number | string>(VER_KEY)) ?? "0");
  if (mem && mem.ver === ver) {
    mem.checkedAt = Date.now();
    return mem.tasks;
  }
  const tasks = await redisLoadFresh();
  g.__cogTasks = { ver, tasks, checkedAt: Date.now() };
  return tasks;
}

// ── Unified load/save ─────────────────────────────────────────────────────────

/** Callers get their own copy, so changing a returned task can never alter the shared one. */
async function loadTasks(maxAgeMs = 0): Promise<Record<number, Task>> {
  return getRedis() ? structuredClone(await redisLoad(maxAgeMs)) : localLoad();
}

/**
 * Load → change → save under the task-store lock, so a new task, a submission
 * and a claim arriving together cannot overwrite each other. With Redis
 * configured, a failed read throws instead of falling back to an empty store:
 * saving that empty copy would wipe every task.
 */
async function mutateTasks<T>(fn: (tasks: Record<number, Task>) => T | Promise<T>): Promise<T> {
  return withRedisLock("tasks", async () => {
    const r = getRedis();
    if (!r) {
      const tasks = localLoad();
      const out = await fn(tasks);
      localSave(tasks);
      return out;
    }
    const tasks = await redisLoadFresh();
    const out = await fn(tasks);
    const p = r.multi();
    p.set(REDIS_KEY, tasks);
    p.incr(VER_KEY);
    const [, ver] = await p.exec();
    g.__cogTasks = { ver: String(ver), tasks: structuredClone(tasks), checkedAt: Date.now() };
    return out;
  });
}

function nextId(tasks: Record<number, Task>): number {
  const ids = Object.keys(tasks).map(Number);
  return ids.length > 0 ? Math.max(...ids) + 1 : 1;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** Public read-only views and polling workers: may be up to 30 s old. Never use before a write. */
const VIEW_MAX_AGE_MS = 30 * 1000;

export async function getAllTasksCached(): Promise<Task[]> {
  return Object.values(await loadTasks(VIEW_MAX_AGE_MS)).sort((a, b) => b.id - a.id);
}

/** For public read-only views: may be up to 30 s old. Never use before a write. */
export async function getTaskCached(id: number): Promise<Task | null> {
  return (await loadTasks(VIEW_MAX_AGE_MS))[id] ?? null;
}

/** For public read-only views: may be up to 30 s old. Never use before a write. */
export const getAllTasksRecent = getAllTasksCached;

/** Current tasks: checks the stored version every call, reloads the value only when it changed. */
export async function getAllTasks(): Promise<Task[]> {
  const tasks = await loadTasks();
  return Object.values(tasks).sort((a, b) => b.id - a.id);
}

export async function getTask(id: number): Promise<Task | null> {
  const tasks = await loadTasks();
  return tasks[id] ?? null;
}

export async function createTask(data: {
  poster: string;
  description: string;
  criteria: string;
  reward?: number;
  rewardUsdc?: number;
  deadlineMinutes: number;
  taskType?: import("./types").TaskType;
  outputFormat?: import("./types").OutputFormat;
  contractTaskId?: number;
  escrowContractId?: string;
  postTxHash?: string;
  /** Absolute deadline (unix seconds); overrides deadlineMinutes when set. */
  deadline?: number;
  gladiatorOnly?: boolean;
  minQualifierScore?: number;
}): Promise<Task> {
  return mutateTasks(async (tasks) => {
    const id = nextId(tasks);
    const now = Math.floor(Date.now() / 1000);
    const rewardUsdc = data.rewardUsdc ?? 0.001;
    const task: Task = {
      id,
      poster: data.poster,
      description: data.description,
      criteria: data.criteria,
      reward: data.reward ?? Math.round(rewardUsdc * 1e7),
      rewardUsdc,
      deadline: data.deadline ?? now + data.deadlineMinutes * 60,
      status: "Open",
      submissions: [],
      verdicts: [],
      taskType: data.taskType,
      outputFormat: data.outputFormat,
      contractTaskId: data.contractTaskId,
      escrowContractId: data.escrowContractId,
      postTxHash: data.postTxHash,
      ...(data.gladiatorOnly ? { gladiatorOnly: true } : {}),
      ...(data.minQualifierScore !== undefined ? { minQualifierScore: data.minQualifierScore } : {}),
    };
    tasks[id] = task;
    return task;
  });
}

/** Mark a Stellar task settled and record the payout tx. */
export async function settleTaskStellar(
  taskId: number,
  winner: string,
  winnerStellarAddress: string,
  settleTxHash: string
): Promise<boolean> {
  return mutateTasks(async (tasks) => {
    if (!tasks[taskId]) return false;
    tasks[taskId].winner = winner;
    tasks[taskId].winnerStellarAddress = winnerStellarAddress;
    tasks[taskId].settleTxHash = settleTxHash;
    tasks[taskId].status = "Settled";
    return true;
  });
}

export async function updateTaskStatus(id: number, status: TaskStatus): Promise<boolean> {
  return mutateTasks(async (tasks) => {
    if (!tasks[id]) return false;
    tasks[id].status = status;
    return true;
  });
}

/**
 * Remove a task's off-chain record.
 *
 * This only deletes the record the app keeps. It does NOT touch the escrow: if
 * the task was posted on-chain, the XLM stays locked in the contract and is
 * recovered through `refund`, which is the poster's own call. Callers should
 * make that clear to the user rather than implying the funds came back.
 */
export async function deleteTask(id: number): Promise<Task | null> {
  return mutateTasks(async (tasks) => {
    const task = tasks[id];
    if (!task) return null;
    delete tasks[id];
    return task;
  });
}

export async function addSubmission(
  taskId: number,
  submission: Task["submissions"][0]
): Promise<boolean> {
  return mutateTasks(async (tasks) => {
    if (!tasks[taskId]) return false;
    const existing = tasks[taskId].submissions.findIndex((s) => s.agent === submission.agent);
    if (existing >= 0) {
      tasks[taskId].submissions[existing] = submission;
    } else {
      tasks[taskId].submissions.push(submission);
    }
    if (tasks[taskId].status === "Open") tasks[taskId].status = "UnderReview";
    return true;
  });
}

/** Record that `agent` is working on a task. Idempotent per agent. */
export async function addClaim(taskId: number, agent: string): Promise<Task | null> {
  return mutateTasks(async (tasks) => {
    const task = tasks[taskId];
    if (!task) return null;
    task.claims = task.claims ?? [];
    if (!task.claims.some((c) => c.agent === agent)) {
      task.claims.push({ agent, claimedAt: Math.floor(Date.now() / 1000) });
    }
    return task;
  });
}

export async function addVerdict(
  taskId: number,
  verdict: Task["verdicts"][0]
): Promise<boolean> {
  return mutateTasks(async (tasks) => {
    if (!tasks[taskId]) return false;
    tasks[taskId].verdicts.push(verdict);
    return true;
  });
}

export async function setWinner(taskId: number, winner: string): Promise<boolean> {
  return mutateTasks(async (tasks) => {
    if (!tasks[taskId]) return false;
    tasks[taskId].winner = winner;
    tasks[taskId].status = "Settled";
    return true;
  });
}

export async function seedIfEmpty(): Promise<void> {
  // No auto-seeding: the live marketplace shows only real, posted tasks.
  // Reviewers post their own task; nothing is fabricated.
}
