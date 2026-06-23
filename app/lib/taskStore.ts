/**
 * Task Store — kalıcı görev geçmişi.
 *
 * Production (Vercel): Upstash Redis kullanır.
 * Local development: JSON dosyasına yazar (UPSTASH env yok ise).
 */

import type { Task, TaskStatus } from "./types";
import { getRedis } from "./redis";

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

async function redisLoad(): Promise<Record<number, Task> | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    const data = await r.get<Record<number, Task>>(REDIS_KEY);
    return data ?? {};
  } catch {
    return null;
  }
}

async function redisSave(tasks: Record<number, Task>) {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(REDIS_KEY, tasks);
  } catch { /* ignore */ }
}

// ── Unified load/save ─────────────────────────────────────────────────────────

async function loadTasks(): Promise<Record<number, Task>> {
  const fromRedis = await redisLoad();
  if (fromRedis !== null) return fromRedis;
  return localLoad();
}

async function saveTasks(tasks: Record<number, Task>) {
  const r = getRedis();
  if (r) {
    await redisSave(tasks);
  } else {
    localSave(tasks);
  }
}

function nextId(tasks: Record<number, Task>): number {
  const ids = Object.keys(tasks).map(Number);
  return ids.length > 0 ? Math.max(...ids) + 1 : 1;
}

// ── Public API ─────────────────────────────────────────────────────────────────

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
}): Promise<Task> {
  const tasks = await loadTasks();
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
    deadline: now + data.deadlineMinutes * 60,
    status: "Open",
    submissions: [],
    verdicts: [],
    taskType: data.taskType,
    outputFormat: data.outputFormat,
    contractTaskId: data.contractTaskId,
    escrowContractId: data.escrowContractId,
    postTxHash: data.postTxHash,
  };

  tasks[id] = task;
  await saveTasks(tasks);
  return task;
}

/** Mark a Stellar task settled and record the payout tx. */
export async function settleTaskStellar(
  taskId: number,
  winner: string,
  winnerStellarAddress: string,
  settleTxHash: string
): Promise<boolean> {
  const tasks = await loadTasks();
  if (!tasks[taskId]) return false;
  tasks[taskId].winner = winner;
  tasks[taskId].winnerStellarAddress = winnerStellarAddress;
  tasks[taskId].settleTxHash = settleTxHash;
  tasks[taskId].status = "Settled";
  await saveTasks(tasks);
  return true;
}

export async function updateTaskStatus(id: number, status: TaskStatus): Promise<boolean> {
  const tasks = await loadTasks();
  if (!tasks[id]) return false;
  tasks[id].status = status;
  await saveTasks(tasks);
  return true;
}

export async function addSubmission(
  taskId: number,
  submission: Task["submissions"][0]
): Promise<boolean> {
  const tasks = await loadTasks();
  if (!tasks[taskId]) return false;
  const existing = tasks[taskId].submissions.findIndex((s) => s.agent === submission.agent);
  if (existing >= 0) {
    tasks[taskId].submissions[existing] = submission;
  } else {
    tasks[taskId].submissions.push(submission);
  }
  if (tasks[taskId].status === "Open") tasks[taskId].status = "UnderReview";
  await saveTasks(tasks);
  return true;
}

export async function addVerdict(
  taskId: number,
  verdict: Task["verdicts"][0]
): Promise<boolean> {
  const tasks = await loadTasks();
  if (!tasks[taskId]) return false;
  tasks[taskId].verdicts.push(verdict);
  await saveTasks(tasks);
  return true;
}

export async function setWinner(taskId: number, winner: string): Promise<boolean> {
  const tasks = await loadTasks();
  if (!tasks[taskId]) return false;
  tasks[taskId].winner = winner;
  tasks[taskId].status = "Settled";
  await saveTasks(tasks);
  return true;
}

export async function seedIfEmpty(): Promise<void> {
  const tasks = await loadTasks();
  if (Object.keys(tasks).length > 0) return;

  const now = Math.floor(Date.now() / 1000);
  const seedTasks: Task[] = [
    {
      id: 1,
      poster: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      description: "2026'da Stellar DeFi ekosisteminin karşılaştığı en büyük 3 riski analiz et.",
      criteria: "kaynak doğrulama, pratik öngörüler, kapsamlı analiz",
      reward: 20_000_000,
      rewardUsdc: 2,
      deadline: now + 4 * 60 * 60,
      status: "Open",
      submissions: [],
      verdicts: [],
    },
    {
      id: 2,
      poster: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      description: "Stellar validator'larını karşılaştır: uptime, performans ve coğrafi dağılım metrikleri.",
      criteria: "teknik doğruluk, veri odaklı analiz, uygulanabilir öneriler",
      reward: 50_000_000,
      rewardUsdc: 5,
      deadline: now + 8 * 60 * 60,
      status: "Open",
      submissions: [],
      verdicts: [],
    },
    {
      id: 3,
      poster: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      description: "Soroban escrow + Freighter entegrasyonunu açıkla, çalışan bir TypeScript örneği sun.",
      criteria: "teknik derinlik, kod kalitesi, açıklamanın netliği",
      reward: 80_000_000,
      rewardUsdc: 8,
      deadline: now + 12 * 60 * 60,
      status: "Open",
      submissions: [],
      verdicts: [],
    },
  ];

  const store: Record<number, Task> = {};
  seedTasks.forEach((t) => { store[t.id] = t; });
  await saveTasks(store);
}
