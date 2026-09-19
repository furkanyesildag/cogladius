import { NextRequest, NextResponse } from "next/server";
import { getAllTasks, createTask, seedIfEmpty } from "@/lib/taskStore";
import { getOnchainTask } from "@/lib/sorobanServer";
import { ESCROW_CONTRACT_ID } from "@/lib/constants";

export const dynamic = "force-dynamic";
// Chain reads must be live: stellar-sdk 16 posts JSON-RPC over fetch with
// identical bodies, which Next 14 would otherwise cache.
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest) {
  await seedIfEmpty();

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  let tasks = await getAllTasks();

  if (status === "open") {
    tasks = tasks.filter((t) => t.status === "Open" || t.status === "UnderReview");
  }

  // Submission bodies stay private until the task settles, so competing agents
  // cannot copy an answer from this public list before the deadline.
  const redacted = tasks.map((t) =>
    t.status === "Settled" || t.status === "Resolved"
      ? t
      : { ...t, submissions: (t.submissions || []).map((s) => ({ ...s, resultUrl: "" })) }
  );

  return NextResponse.json({ tasks: redacted });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      poster, description, criteria, reward, rewardUsdc, deadlineMinutes,
      taskType, outputFormat, contractTaskId, escrowContractId, postTxHash,
    } = body;

    if (!description || !criteria || !poster) {
      return NextResponse.json(
        { success: false, error: "poster, description ve criteria zorunludur" },
        { status: 400 }
      );
    }

    // A record that claims an escrowed reward must match the escrow exactly.
    // Settlement trusts contractTaskId, so an unchecked id would let anyone point
    // a record of their own at somebody else's locked reward.
    let onchainReward: number | undefined;
    let onchainDeadline: number | undefined;
    const escrowId = typeof contractTaskId === "number" ? contractTaskId : undefined;
    if (escrowId !== undefined) {
      if (!Number.isSafeInteger(escrowId) || escrowId < 0) {
        return NextResponse.json({ success: false, error: "contractTaskId must be a u64" }, { status: 400 });
      }
      const onchain = await getOnchainTask(escrowId);
      if (!onchain) {
        return NextResponse.json(
          { success: false, error: `Escrow has no task #${escrowId}; post it on-chain first.` },
          { status: 409 }
        );
      }
      if (onchain.poster !== poster) {
        return NextResponse.json(
          { success: false, error: "poster does not match the escrowed task's poster" },
          { status: 403 }
        );
      }
      const all = await getAllTasks();
      if (all.some((t) => t.contractTaskId === escrowId)) {
        return NextResponse.json(
          { success: false, error: `Escrow task #${escrowId} is already linked to a record` },
          { status: 409 }
        );
      }
      onchainReward = Number(onchain.reward);
      onchainDeadline = onchain.deadline;
    }

    const task = await createTask({
      poster,
      description,
      criteria,
      reward: onchainReward ?? reward ?? Math.round((rewardUsdc ?? 0.001) * 1e7),
      rewardUsdc: onchainReward !== undefined ? onchainReward / 1e7 : rewardUsdc ?? 0.001,
      deadlineMinutes: deadlineMinutes ?? 60,
      deadline: onchainDeadline,
      taskType,
      outputFormat,
      contractTaskId: escrowId,
      escrowContractId: escrowId !== undefined ? ESCROW_CONTRACT_ID : undefined,
      postTxHash: typeof postTxHash === "string" ? postTxHash : undefined,
    });

    return NextResponse.json({ success: true, task });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || "Sunucu hatası" },
      { status: 500 }
    );
  }
}
