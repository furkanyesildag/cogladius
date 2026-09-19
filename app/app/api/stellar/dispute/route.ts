/**
 * POST /api/stellar/dispute
 *
 * Flags a settled task as Disputed on-chain via the Soroban escrow contract.
 * Full Agent Court dispute resolution on Stellar is a deferred deliverable —
 * this records the disputed state on-chain so it can be resolved later.
 *
 * Body: { taskId: number, issuedAt?: number, posterSignature?: string }
 *
 * Callers must be an admin (Bearer ADMIN_SECRET) or the task's on-chain poster,
 * proven by a SEP-53 signature over `disputeMessage(...)`. Without this anyone
 * could make the platform key flag any completed task as disputed.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTask } from "@/lib/taskStore";
import { flagDisputed, getOnchainTask } from "@/lib/sorobanServer";
import { isAdminRequest } from "@/lib/adminAuth";
import { verifySep53 } from "@/lib/sep53";
import { disputeMessage, isFresh } from "@/lib/actionMessages";
import { ESCROW_CONTRACT_ID, explorerTx } from "@/lib/constants";

export const dynamic = "force-dynamic";
// Chain reads must be live: stellar-sdk 16 posts JSON-RPC over fetch with
// identical bodies, which Next 14 would otherwise cache.
export const fetchCache = "force-no-store";

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

    const admin = isAdminRequest(req);
    const onchainTaskId = task.contractTaskId ?? (admin ? taskId : undefined);
    if (onchainTaskId === undefined) {
      return NextResponse.json({ success: false, error: "Task has no escrowed reward on-chain." }, { status: 400 });
    }
    if (!admin) {
      const onchain = await getOnchainTask(onchainTaskId);
      if (!onchain) {
        return NextResponse.json({ success: false, error: "Escrow task not found" }, { status: 404 });
      }
      const issuedAt = Number(body.issuedAt);
      const ok =
        isFresh(issuedAt) &&
        verifySep53(onchain.poster, disputeMessage(onchainTaskId, issuedAt), String(body.posterSignature || ""));
      if (!ok) {
        return NextResponse.json(
          { success: false, error: "Only the task poster (signed) or an admin can open a dispute." },
          { status: 403 }
        );
      }
    }

    const { hash } = await flagDisputed(onchainTaskId);

    return NextResponse.json({ success: true, hash, explorerUrl: explorerTx(hash) });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || "Dispute failed" },
      { status: 500 }
    );
  }
}
