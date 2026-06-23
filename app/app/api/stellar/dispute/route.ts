/**
 * POST /api/stellar/dispute
 *
 * Flags a settled task as Disputed on-chain via the Soroban escrow contract.
 * Full Agent Court dispute resolution on Stellar is a deferred deliverable —
 * this records the disputed state on-chain so it can be resolved later.
 *
 * Body: { taskId: number }
 */
import { NextRequest, NextResponse } from "next/server";
import { getTask } from "@/lib/taskStore";
import { flagDisputed } from "@/lib/sorobanServer";
import { ESCROW_CONTRACT_ID, explorerTx } from "@/lib/constants";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    if (!ESCROW_CONTRACT_ID) {
      return NextResponse.json(
        { success: false, error: "Escrow contract is not configured." },
        { status: 500 }
      );
    }
    const body = await req.json().catch(() => ({}));
    const taskId = Number(body.taskId);
    if (!Number.isFinite(taskId)) {
      return NextResponse.json({ success: false, error: "taskId is required" }, { status: 400 });
    }

    const task = await getTask(taskId);
    if (!task) {
      return NextResponse.json({ success: false, error: "Task not found" }, { status: 404 });
    }

    const onchainTaskId = task.contractTaskId ?? taskId;
    const { hash } = await flagDisputed(onchainTaskId);

    return NextResponse.json({ success: true, hash, explorerUrl: explorerTx(hash) });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || "Dispute failed" },
      { status: 500 }
    );
  }
}
