/**
 * POST /api/stellar/settle
 *
 * Releases a task's USDC reward to the winning agent by invoking the Soroban
 * escrow contract's `release_to_winner` with a verdict-authority signature.
 * The contract — not the platform — holds and moves the funds.
 *
 * Body: { taskId: number, winnerPubkey?: string, winnerAddress?: string, score?: number }
 *
 * Winner Stellar address resolution order:
 *   1. explicit winnerAddress (must be G...)
 *   2. registered agent (by winnerPubkey) stellarAddress
 *   3. registered agent (by task.winner) stellarAddress
 *   4. STELLAR_DEFAULT_WINNER env fallback
 */
import { NextRequest, NextResponse } from "next/server";
import { getTask, settleTaskStellar } from "@/lib/taskStore";
import { getAgent } from "@/lib/agentRegistry";
import { releaseToWinner } from "@/lib/sorobanServer";
import { ESCROW_CONTRACT_ID, explorerTx } from "@/lib/constants";

export const dynamic = "force-dynamic";

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;
const isValidStellarAddress = (a: string) => STELLAR_ADDRESS_RE.test(String(a).trim());

function averageScore(scores: number[]): number | null {
  if (!scores.length) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

export async function POST(req: NextRequest) {
  try {
    if (!ESCROW_CONTRACT_ID) {
      return NextResponse.json(
        { success: false, error: "Escrow contract is not configured (ESCROW_CONTRACT_ID)." },
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
    if (task.status === "Settled" && task.settleTxHash) {
      return NextResponse.json(
        { success: false, error: "Task already settled", hash: task.settleTxHash },
        { status: 400 }
      );
    }

    // Resolve winner Stellar address + identity.
    const winnerKey: string | undefined = body.winnerPubkey || task.winner;
    let winnerAddress: string | undefined;

    if (body.winnerAddress && isValidStellarAddress(body.winnerAddress)) {
      winnerAddress = String(body.winnerAddress).trim();
    }
    if (!winnerAddress && body.winnerPubkey) {
      const agent = await getAgent(body.winnerPubkey);
      if (agent?.stellarAddress) winnerAddress = agent.stellarAddress;
      else if (isValidStellarAddress(body.winnerPubkey)) winnerAddress = body.winnerPubkey;
    }
    if (!winnerAddress && task.winner) {
      const agent = await getAgent(task.winner);
      if (agent?.stellarAddress) winnerAddress = agent.stellarAddress;
      else if (isValidStellarAddress(task.winner)) winnerAddress = task.winner;
    }
    if (!winnerAddress && process.env.STELLAR_DEFAULT_WINNER) {
      winnerAddress = process.env.STELLAR_DEFAULT_WINNER.trim();
    }

    if (!winnerAddress || !isValidStellarAddress(winnerAddress)) {
      return NextResponse.json(
        {
          success: false,
          error: "No valid winner Stellar address (agent has none registered and no fallback configured).",
        },
        { status: 400 }
      );
    }

    // Determine the verdict score (must clear the contract's pass threshold).
    // An explicit body.score is an authorized operator override; otherwise the
    // score MUST derive from real recorded judge verdicts. We never fall back to
    // an assumed passing score — that would release real USDC without a verdict.
    let score = Number(body.score);
    if (!Number.isFinite(score)) {
      const winnerScores = (task.verdicts || [])
        .filter((v) => v.agent === winnerKey)
        .map((v) => v.score);
      const derived =
        averageScore(winnerScores) ??
        averageScore((task.verdicts || []).map((v) => v.score));
      if (derived === null) {
        return NextResponse.json(
          {
            success: false,
            error:
              "No judge verdicts recorded for this task; refusing to settle without a real score.",
          },
          { status: 400 }
        );
      }
      score = derived;
    }
    score = Math.max(0, Math.min(100, Math.round(score)));

    const onchainTaskId = task.contractTaskId ?? taskId;
    const { hash } = await releaseToWinner(onchainTaskId, winnerAddress, score);

    await settleTaskStellar(taskId, winnerKey || winnerAddress, winnerAddress, hash);

    return NextResponse.json({
      success: true,
      hash,
      score,
      winnerAddress,
      explorerUrl: explorerTx(hash),
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || "Settlement failed" },
      { status: 500 }
    );
  }
}
