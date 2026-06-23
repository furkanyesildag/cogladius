/**
 * Project Store — Multi-agent proje verilerini yönetir.
 * Production: Upstash Redis  |  Local: JSON dosyası
 */

import { getRedis } from "./redis";
import type { Project, SubTask, AgentSpecialty, ProjectStatus, SubTaskStatus } from "./types";

const REDIS_KEY = "cogladius:projects";

// ── Local FS fallback ─────────────────────────────────────────────────────────

function fsPath() {
  const { join } = require("path");
  const dir = process.env.AGENT_REGISTRY_DIR || join(process.cwd(), ".agent-registry");
  return { dir, file: join(dir, "projects.json") };
}

function localLoad(): Record<number, Project> {
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

function localSave(store: Record<number, Project>) {
  try {
    const { writeFileSync, mkdirSync, existsSync } = require("fs");
    const { dir, file } = fsPath();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(store, null, 2), "utf-8");
  } catch { /* serverless ortamda sessizce geç */ }
}

// ── Redis helpers ─────────────────────────────────────────────────────────────

async function redisLoad(): Promise<Record<number, Project> | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    return (await r.get<Record<number, Project>>(REDIS_KEY)) ?? {};
  } catch {
    return null;
  }
}

async function redisSave(store: Record<number, Project>) {
  const r = getRedis();
  if (!r) return;
  try { await r.set(REDIS_KEY, store); } catch { /* ignore */ }
}

async function loadStore(): Promise<Record<number, Project>> {
  const fromRedis = await redisLoad();
  return fromRedis !== null ? fromRedis : localLoad();
}

async function saveStore(store: Record<number, Project>) {
  const r = getRedis();
  if (r) await redisSave(store);
  else localSave(store);
}

function nextId(store: Record<number, Project>): number {
  const ids = Object.keys(store).map(Number);
  return ids.length === 0 ? 1 : Math.max(...ids) + 1;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function createProject(data: {
  poster: string;
  title: string;
  description: string;
  totalBudgetUsdc: number;
  deadline: number;
}): Promise<Project> {
  const store = await loadStore();
  const id = nextId(store);
  const project: Project = {
    id,
    poster: data.poster,
    title: data.title,
    description: data.description,
    totalBudgetUsdc: data.totalBudgetUsdc,
    deadline: data.deadline,
    status: "draft",
    subTasks: [],
    createdAt: new Date().toISOString(),
  };
  store[id] = project;
  await saveStore(store);
  return project;
}

export async function getProject(id: number): Promise<Project | null> {
  const store = await loadStore();
  return store[id] ?? null;
}

export async function getAllProjects(): Promise<Project[]> {
  const store = await loadStore();
  return Object.values(store).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function getProjectsByPoster(poster: string): Promise<Project[]> {
  const all = await getAllProjects();
  return all.filter((p) => p.poster === poster);
}

export async function updateProject(
  id: number,
  update: Partial<Pick<Project, "status" | "subTasks" | "orchestratorReasoning">>
): Promise<Project | null> {
  const store = await loadStore();
  if (!store[id]) return null;
  store[id] = { ...store[id], ...update };
  await saveStore(store);
  return store[id];
}

export async function setProjectStatus(id: number, status: ProjectStatus): Promise<void> {
  const store = await loadStore();
  if (!store[id]) return;
  store[id].status = status;
  await saveStore(store);
}

export async function setSubTasks(id: number, subTasks: SubTask[]): Promise<void> {
  const store = await loadStore();
  if (!store[id]) return;
  store[id].subTasks = subTasks;
  await saveStore(store);
}

export async function setSubTaskTaskId(
  projectId: number,
  subTaskId: number,
  taskId: number
): Promise<void> {
  const store = await loadStore();
  if (!store[projectId]) return;
  const st = store[projectId].subTasks.find((s) => s.id === subTaskId);
  if (!st) return;
  st.taskId = taskId;
  st.status = "posted";
  await saveStore(store);
}

export async function updateSubTaskStatus(
  projectId: number,
  subTaskId: number,
  status: SubTaskStatus
): Promise<void> {
  const store = await loadStore();
  if (!store[projectId]) return;
  const st = store[projectId].subTasks.find((s) => s.id === subTaskId);
  if (!st) return;
  st.status = status;
  // Auto-complete project if all sub-tasks are done
  const allDone = store[projectId].subTasks.every((s) => s.status === "done");
  if (allDone) store[projectId].status = "completed";
  await saveStore(store);
}
