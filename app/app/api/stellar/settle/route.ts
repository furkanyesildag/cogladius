/**
 * POST /api/stellar/settle
 *
 * Releases a task's escrowed reward to the winning agent by invoking the
 * Soroban escrow contract's `release_to_winner` with a verdict-authority
 * signature. The contract — not the platform — holds and moves the funds.
 *
 * Because this route makes the verdict key sign, it is the platform's most
 * sensitive endpoint. A caller is accepted in exactly one of three ways:
 *
 *   1. Admin    — `Authorization: Bearer <ADMIN_SECRET>`. May name any winner
 *                 and override the score (operator recovery).
 *   2. Poster   — `{ winnerAddress, issuedAt, posterSignature }`, a SEP-53
 *                 signature by the task's on-chain poster over
 *                 `settleMessage(...)`. The winner must be an agent that
 *                 submitted and was judged; the score is that agent's average.
 *   3. Crank    — no credentials, only after the task deadline. The winner is
 *                 the top-scoring judged submitter (ties → earliest submission)
 *                 and the score is derived from recorded verdicts. This lets an
 *                 agent (or the SDK) collect a payout the poster never released.
 *
 * In every mode the off-chain record must match the escrow: the on-chain task
 * must exist, be Open/Active, and have the same poster and reward. Without that
 * check an off-chain record could point at somebody else's escrowed task.
 *
 * Body: { taskId: number, winnerAddress?, winnerPubkey?, score?, issuedAt?, posterSignature? }
 */
import { NextRequest, NextResponse } from "next/server";
import { StrKey } from "@stellar/stellar-sdk";
import { getTask, settleTaskStellar } from "@/lib/taskStore";
import { getAgent } from "@/lib/agentRegistry";
import { releaseToWinner, getOnchainTask, getEscrowConfig } from "@/lib/sorobanServer";
import { ESCROW_CONTRACT_ID, explorerTx } from "@/lib/constants";
import { isAdminRequest } from "@/lib/adminAuth";
import { verifySep53 } from "@/lib/sep53";
import { settleMessage, isFresh } from "@/lib/actionMessages";
import type { Task } from "@/lib/types";

export const dynamic = "force-dynamic";
// Chain reads must be live: stellar-sdk 16 posts JSON-RPC over fetch with
// identical bodies, which Next 14 would otherwise cache.
export const fetchCache = "force-no-store";

const isValidStellarAddress = (a: unknown) => {
  try {
    return typeof a === "string" && StrKey.isValidEd25519PublicKey(a.trim());
  } catch {
    return false;
  }
};

function fail(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: false, error, ...extra }, { status });
}

interface Candidate {
  agent: string;          // registry identity (the agent's G-address)
  address: string;        // payout address
  avgScore: number;
  submittedAt: number;
}

/** Judged submitters with their average score, best first. */
async function rankCandidates(task: Task): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const sub of task.submissions || []) {
    const scores = (task.verdicts || []).filter((v) => v.agent === sub.agent).map((v) => v.score);
    if (!scores.length) continue;
    const agent = await getAgent(sub.agent);
    const address = agent?.stellarAddress || sub.agent;
    if (!isValidStellarAddress(address)) continue;
    out.push({
      agent: sub.agent,
      address,
      avgScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
      submittedAt: sub.submittedAt,
    });
  }
  return out.sort((a, b) => b.avgScore - a.avgScore || a.submittedAt - b.submittedAt);
}

export async function POST(req: NextRequest) {
  try {
    if (!ESCROW_CONTRACT_ID) return fail(500, "Escrow contract is not configured (ESCROW_CONTRACT_ID).");

    const body = await req.json().catch(() => ({}));
    const taskId = Number(body.taskId);
    if (!Number.isFinite(taskId)) return fail(400, "taskId is required");

    const task = await getTask(taskId);
    if (!task) return fail(404, "Task not found");
    if (task.status === "Settled" && task.settleTxHash) {
      return fail(409, "Task already settled", { hash: task.settleTxHash });
    }

    const admin = isAdminRequest(req);

    // Never fall back to the off-chain id for non-admins: the off-chain id can
    // collide with an unrelated task_id in the escrow.
    const onchainTaskId = task.contractTaskId ?? (admin ? taskId : undefined);
    if (onchainTaskId === undefined) return fail(400, "Task has no escrowed reward on-chain.");

    const onchain = await getOnchainTask(onchainTaskId);
    if (!onchain) return fail(404, `Escrow has no task #${onchainTaskId}.`);
    if (onchain.status !== "Open" && onchain.status !== "Active") {
      return fail(409, `Escrow task #${onchainTaskId} is ${onchain.status}; nothing to release.`);
    }
    if (onchain.poster !== task.poster || onchain.reward !== BigInt(Math.round(task.reward))) {
      return fail(409, "Off-chain task record does not match the escrowed task (poster or reward differ).");
    }

    const candidates = await rankCandidates(task);
    let winnerAddress: string | undefined;
    let winnerKey: string | undefined;
    let score: number | undefined;
    let mode: "admin" | "poster" | "crank";

    if (admin) {
      mode = "admin";
      winnerKey = body.winnerPubkey || task.winner;
      if (isValidStellarAddress(body.winnerAddress)) winnerAddress = String(body.winnerAddress).trim();
      if (!winnerAddress && winnerKey) {
        const agent = await getAgent(winnerKey);
        winnerAddress = agent?.stellarAddress || (isValidStellarAddress(winnerKey) ? winnerKey : undefined);
      }
      if (!winnerAddress && candidates[0]) {
        winnerAddress = candidates[0].address;
        winnerKey = candidates[0].agent;
      }
      const override = Number(body.score);
      score = Number.isFinite(override)
        ? override
        : candidates.find((c) => c.address === winnerAddress)?.avgScore;
    } else if (body.posterSignature) {
      mode = "poster";
      const issuedAt = Number(body.issuedAt);
      const requested = String(body.winnerAddress || "").trim();
      if (!isValidStellarAddress(requested)) return fail(400, "winnerAddress (G...) is required.");
      if (!isFresh(issuedAt)) return fail(401, "Signature expired; sign the release again.");
      const msg = settleMessage(onchainTaskId, requested, issuedAt);
      if (!verifySep53(onchain.poster, msg, String(body.posterSignature))) {
        return fail(403, "Signature is not from this task's poster.");
      }
      const chosen = candidates.find((c) => c.address === requested || c.agent === requested);
      if (!chosen) return fail(400, "The chosen winner has no judged submission for this task.");
      winnerAddress = chosen.address;
      winnerKey = chosen.agent;
      score = chosen.avgScore;
    } else {
      mode = "crank";
      const now = Math.floor(Date.now() / 1000);
      if (now <= onchain.deadline) {
        return fail(403, "Before the deadline only the poster (signed) or an admin can release the reward.", {
          deadline: onchain.deadline,
        });
      }
      const top = candidates[0];
      if (!top) return fail(400, "No judged submissions; refusing to settle without a real score.");
      winnerAddress = top.address;
      winnerKey = top.agent;
      score = top.avgScore;
    }

    if (!winnerAddress || !isValidStellarAddress(winnerAddress)) {
      return fail(400, "No valid winner Stellar address.");
    }
    if (score === undefined || !Number.isFinite(score)) {
      return fail(400, "No judge verdicts recorded for this winner; refusing to settle without a real score.");
    }
    score = Math.max(0, Math.min(100, Math.round(score)));

    // Check the threshold here so a doomed call never burns a fee.
    const config = await getEscrowConfig();
    if (config?.paused) return fail(503, "Escrow is paused.");
    if (config && score < config.passThreshold) {
      return fail(409, `Score ${score} is below the escrow pass threshold (${config.passThreshold}).`);
    }

    const { hash } = await releaseToWinner(onchainTaskId, winnerAddress, score);
    await settleTaskStellar(taskId, winnerKey || winnerAddress, winnerAddress, hash);

    return NextResponse.json({
      success: true,
      mode,
      hash,
      score,
      winnerAddress,
      explorerUrl: explorerTx(hash),
    });
  } catch (err: any) {
    return fail(500, err?.message || "Settlement failed");
  }
}
