/**
 * What the escrow says happened to each task, read from its own events.
 *
 * The task store records what this app did; the chain records what happened
 * to the money. A reward can be settled or refunded without going through the
 * app (a script, the SDK, anyone after the settlement window), so the store
 * alone goes stale. Public task endpoints overlay this, so no page shows a task
 * as open or awaiting a ruling after its reward has moved.
 *
 * Server-only.
 */
import { rawEscrowEvents } from "@/lib/reputation";
import { getEscrowConfig } from "@/lib/sorobanServer";
import { decodeRawEvent } from "@cogladius/agent-sdk/reputation/events";
import type { Task, TaskStatus } from "@/lib/types";

export type EscrowOutcome = "settled" | "refunded" | "disputed";

export interface PostedTask {
  /** Contract task id, as a decimal string (u64). */
  taskId: string;
  poster: string;
  /** Stroops, as a decimal string. */
  reward: string;
  deadline: number;
}

export interface EscrowIndex {
  /** Latest outcome per contract task id; tasks with none are still escrowed. */
  outcomes: Map<string, EscrowOutcome>;
  /** Posted and neither settled nor refunded. */
  unresolved: PostedTask[];
}

export async function escrowIndex(): Promise<EscrowIndex> {
  const { events } = await rawEscrowEvents();
  const outcomes = new Map<string, EscrowOutcome>();
  const posts = new Map<string, PostedTask>();
  // Events arrive in ledger order, so a later event overrides an earlier one
  // (a dispute flag comes after the settlement it disputes).
  for (const raw of events) {
    const e = decodeRawEvent(raw);
    if (!e?.taskId) continue;
    if (e.type === "post") {
      posts.set(e.taskId, { taskId: e.taskId, poster: e.poster ?? "", reward: e.reward ?? "0", deadline: e.deadline ?? 0 });
    } else if (e.type === "settle") {
      outcomes.set(e.taskId, "settled");
    } else if (e.type === "refund") {
      outcomes.set(e.taskId, "refunded");
    } else if (e.type === "dispute") {
      outcomes.set(e.taskId, "disputed");
    }
  }
  const unresolved = [...posts.values()].filter((p) => !outcomes.has(p.taskId));
  return { outcomes, unresolved };
}

// The live contract's settle_grace; used only if the config read fails.
const DEFAULT_SETTLE_GRACE = 3600;
const GRACE_TTL_MS = 10 * 60_000;
let graceCache: { value: number; at: number } | null = null;

/** Seconds after a deadline during which a reward can still be settled before anyone may refund it. */
export async function settleGraceSeconds(): Promise<number> {
  if (graceCache && Date.now() - graceCache.at < GRACE_TTL_MS) return graceCache.value;
  try {
    const value = (await getEscrowConfig())?.settleGrace ?? DEFAULT_SETTLE_GRACE;
    graceCache = { value, at: Date.now() };
    return value;
  } catch {
    return graceCache?.value ?? DEFAULT_SETTLE_GRACE;
  }
}

const FINAL: ReadonlySet<TaskStatus> = new Set<TaskStatus>(["Settled", "Resolved", "Refunded"]);

/**
 * The status a public page should show. The chain wins over the stored status;
 * a task whose deadline and settlement window have both passed without a
 * payout shows as Expired until someone refunds it (anyone may; the operator
 * does it through /api/stellar/expire).
 */
export function displayStatus(task: Task, index: EscrowIndex | null, nowSec: number, graceSec: number): TaskStatus {
  const id = task.contractTaskId;
  const outcome = index && id !== undefined ? index.outcomes.get(String(id)) : undefined;
  if (outcome === "refunded") return "Refunded";
  if (outcome === "disputed") return "Disputed";
  if (outcome === "settled") return task.status === "Resolved" ? "Resolved" : "Settled";
  if (FINAL.has(task.status) || task.status === "Disputed" || task.status === "Stopped") return task.status;
  if (task.deadline + graceSec < nowSec) return "Expired";
  return task.status;
}

/** Overlay chain outcomes onto task records; falls back to stored statuses if the chain index is unavailable. */
export async function withDisplayStatus(tasks: Task[]): Promise<Task[]> {
  const [index, grace] = await Promise.all([
    escrowIndex().catch((err) => {
      console.error("[escrowOutcomes] event index unavailable; showing stored statuses", err);
      return null;
    }),
    settleGraceSeconds(),
  ]);
  const now = Math.floor(Date.now() / 1000);
  return tasks.map((t) => {
    const status = displayStatus(t, index, now, grace);
    return status === t.status ? t : { ...t, status };
  });
}
