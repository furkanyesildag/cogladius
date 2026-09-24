/**
 * GET /api/stellar/expire — keeper for escrowed tasks whose time ran out.
 *
 * The escrow never moves a reward by itself; somebody has to send the call.
 * For each posted task that is past `deadline + settle_grace` and still Open or
 * Active on chain:
 *   - if a judged submission clears the pass threshold, it runs the same crank
 *     anyone may run after the deadline (`POST /api/stellar/settle`), which pays
 *     the top judged submitter, so waiting out the clock never gets a poster
 *     passing work for free;
 *   - otherwise it calls `refund`, which can only return the reward to the
 *     poster recorded at posting.
 * Both calls are permissionless after the window; this route only pays the fee.
 *
 * Auth: admin, or a Vercel cron (`Authorization: Bearer <CRON_SECRET>`) if one
 * is scheduled for this path in vercel.json.
 */
import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { escrowIndex } from "@/lib/escrowOutcomes";
import { getEscrowConfig, getOnchainTask, refundTask } from "@/lib/sorobanServer";
import { getAllTasks, updateTaskStatus } from "@/lib/taskStore";
import type { Task } from "@/lib/types";

export const dynamic = "force-dynamic";
// Chain reads must be live: stellar-sdk 16 posts JSON-RPC over fetch with
// identical bodies, which Next 14 would otherwise cache.
export const fetchCache = "force-no-store";
// Each call waits for its ledger (about 5 s); the cap below keeps a run well
// inside this, and the next run picks up the rest.
export const maxDuration = 60;
const MAX_ACTIONS_PER_RUN = 5;

/** Best average judge score among the task's submitters, or -1 if none were judged. */
function bestJudgedScore(task: Task): number {
  let best = -1;
  for (const sub of task.submissions || []) {
    const scores = (task.verdicts || []).filter((v) => v.agent === sub.agent).map((v) => v.score);
    if (scores.length) best = Math.max(best, Math.round(scores.reduce((a, b) => a + b, 0) / scores.length));
  }
  return best;
}

export async function GET(req: NextRequest) {
  const cron = process.env.CRON_SECRET && req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  if (!cron && !isAdminRequest(req)) return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });

  const [index, config] = await Promise.all([escrowIndex(), getEscrowConfig()]);
  if (!config) return NextResponse.json({ success: false, error: "escrow config unavailable" }, { status: 502 });
  if (config.paused) return NextResponse.json({ success: true, checked: 0, note: "escrow paused" });

  const now = Math.floor(Date.now() / 1000);
  const records = new Map<string, Task>();
  for (const t of await getAllTasks()) if (t.contractTaskId !== undefined) records.set(String(t.contractTaskId), t);

  const due = index.unresolved.filter((p) => p.deadline + config.settleGrace < now);
  const results: Record<string, unknown>[] = [];
  let actions = 0;
  for (const p of due) {
    if (actions >= MAX_ACTIONS_PER_RUN) {
      results.push({ taskId: p.taskId, action: "deferred" });
      continue;
    }
    try {
      const onchain = await getOnchainTask(Number(p.taskId));
      if (!onchain || (onchain.status !== "Open" && onchain.status !== "Active")) {
        results.push({ taskId: p.taskId, action: "none", status: onchain?.status ?? "missing" });
        continue;
      }
      const record = records.get(p.taskId);
      actions++;
      if (record && bestJudgedScore(record) >= config.passThreshold) {
        const res = await fetch(new URL("/api/stellar/settle", req.url), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId: record.id }),
        });
        const data = await res.json().catch(() => ({}));
        results.push({ taskId: p.taskId, action: data.success ? "settled" : "settle_failed", hash: data.hash, error: data.error });
        continue;
      }
      const { hash } = await refundTask(Number(p.taskId));
      if (record) await updateTaskStatus(record.id, "Refunded");
      results.push({ taskId: p.taskId, action: "refunded", hash, poster: p.poster, reward: p.reward });
    } catch (err: any) {
      results.push({ taskId: p.taskId, action: "error", error: err?.message ?? String(err) });
    }
  }
  return NextResponse.json({ success: true, checked: due.length, results });
}
