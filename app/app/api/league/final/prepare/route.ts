/**
 * POST /api/league/final/prepare
 * Body: { poster, description, criteria, gladiatorOnly?, minQualifierScore?, contractTaskId? }
 *
 * No admin and no state: returns the exact text the poster signs with Freighter
 * (SEP-53) to publish this task's record, and the body POST /api/tasks expects.
 * It signs nothing and moves nothing. The dashboard's Post Task dialog does all
 * of this itself; this route is for posting from a script.
 */
import { randomInt } from "crypto";
import { NextRequest } from "next/server";
import { StrKey } from "@stellar/stellar-sdk";
import { arenaError, arenaJson, arenaOptions } from "@/lib/arena";
import { isMinQualifierScore, taskContentHash, taskRecordMessage } from "@/lib/actionMessages";
import { ESCROW_CONTRACT_ID, NETWORK_PASSPHRASE } from "@/lib/constants";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return arenaOptions();
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return arenaError(400, "invalid_json", "Body must be JSON.");
  const { poster, description, criteria, gladiatorOnly, minQualifierScore, contractTaskId } = body;

  if (typeof poster !== "string" || !StrKey.isValidEd25519PublicKey(poster)) {
    return arenaError(400, "invalid_poster", "poster must be a Stellar G... address.");
  }
  if (typeof description !== "string" || description.trim().length < 10 || typeof criteria !== "string" || !criteria.trim()) {
    return arenaError(400, "invalid_content", "description (10+ characters) and criteria are required.");
  }
  if (gladiatorOnly !== undefined && typeof gladiatorOnly !== "boolean") {
    return arenaError(400, "invalid_gladiator_only", "gladiatorOnly must be a boolean.");
  }
  if (minQualifierScore !== undefined && !isMinQualifierScore(minQualifierScore)) {
    return arenaError(400, "invalid_min_qualifier_score", "minQualifierScore must be an integer from 1 to 100.");
  }
  if (contractTaskId !== undefined && (!Number.isSafeInteger(contractTaskId) || contractTaskId < 0)) {
    return arenaError(400, "invalid_task_id", "contractTaskId must be a non-negative safe integer.");
  }
  if (!ESCROW_CONTRACT_ID) return arenaError(503, "escrow_not_configured", "The escrow contract is not configured.");

  // Same range as the dashboard dialog: JSON-safe, collisions negligible.
  const id: number = contractTaskId ?? randomInt(1, 2 ** 47);
  const record = { contractTaskId: id, poster, description, criteria, gladiatorOnly: gladiatorOnly === true, minQualifierScore };

  return arenaJson({
    success: true,
    contractTaskId: id,
    contentHash: taskContentHash(description, criteria),
    network: NETWORK_PASSPHRASE,
    escrow: ESCROW_CONTRACT_ID,
    message: taskRecordMessage(record),
    next: "Sign `message` with the poster's key (Freighter signMessage), lock the reward with post_task under this contractTaskId, then POST /api/tasks with `recordBody` plus posterSignature.",
    recordBody: { ...record },
  });
}
