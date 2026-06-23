import { NextRequest, NextResponse } from "next/server";
import { getAllTasks, createTask, seedIfEmpty } from "@/lib/taskStore";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  await seedIfEmpty();

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  let tasks = await getAllTasks();

  if (status === "open") {
    tasks = tasks.filter((t) => t.status === "Open" || t.status === "UnderReview");
  }

  return NextResponse.json({ tasks });
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

    const task = await createTask({
      poster,
      description,
      criteria,
      reward: reward ?? Math.round((rewardUsdc ?? 0.001) * 1e7),
      rewardUsdc: rewardUsdc ?? 0.001,
      deadlineMinutes: deadlineMinutes ?? 60,
      taskType,
      outputFormat,
      contractTaskId: typeof contractTaskId === "number" ? contractTaskId : undefined,
      escrowContractId: typeof escrowContractId === "string" ? escrowContractId : undefined,
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
