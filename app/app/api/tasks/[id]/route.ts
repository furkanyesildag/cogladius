import { NextRequest, NextResponse } from "next/server";
import { getMockTasks } from "@/lib/sampleTasks";
import { getTask, deleteTask } from "@/lib/taskStore";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const taskId = parseInt(params.id);
  const tasks = getMockTasks();
  const task = tasks.find((t) => t.id === taskId);

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json({ task });
}

/**
 * DELETE /api/tasks/[id]
 *
 * Removes a task's off-chain record. Only the poster can do this (or an admin
 * with ADMIN_SECRET), and never once the task has settled, so a paid-out task
 * cannot be erased from the history.
 *
 * This does not move funds. If the reward was locked on-chain it stays in the
 * escrow until the poster calls `refund`; the response says so explicitly.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const taskId = parseInt(params.id);
  if (!Number.isFinite(taskId)) {
    return NextResponse.json({ success: false, error: "Invalid task id" }, { status: 400 });
  }

  const task = await getTask(taskId);
  if (!task) {
    return NextResponse.json({ success: false, error: "Task not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({} as any));
  const adminSecret = process.env.ADMIN_SECRET;
  const isAdmin = !!adminSecret && request.headers.get("authorization") === `Bearer ${adminSecret}`;
  const isPoster =
    !!body?.poster && String(body.poster).trim() === String(task.poster || "").trim();

  if (!isAdmin && !isPoster) {
    return NextResponse.json(
      { success: false, error: "Only the task poster can delete this task." },
      { status: 403 }
    );
  }

  if (task.status === "Settled" && !isAdmin) {
    return NextResponse.json(
      { success: false, error: "A settled task cannot be deleted." },
      { status: 400 }
    );
  }

  const removed = await deleteTask(taskId);
  if (!removed) {
    return NextResponse.json({ success: false, error: "Task not found" }, { status: 404 });
  }

  const lockedOnChain = !!removed.contractTaskId;
  return NextResponse.json({
    success: true,
    deleted: taskId,
    lockedOnChain,
    message: lockedOnChain
      ? "Task record removed. The on-chain reward is still escrowed; call refund to recover it."
      : "Task record removed.",
  });
}
