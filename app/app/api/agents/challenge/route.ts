/**
 * GET /api/agents/challenge?pubkey=G...
 *
 * Step 1 of registration. Issues a single-use nonce bound to `pubkey` and the
 * exact text the agent must sign (SEP-53) with that key. The nonce expires in
 * five minutes and is consumed by POST /api/agents/register.
 */

import { NextRequest, NextResponse } from "next/server";
import { StrKey } from "@stellar/stellar-sdk";
import { randomBytes } from "crypto";
import { kvSet, kvIncr } from "@/lib/kv";
import { registrationMessage } from "@/lib/actionMessages";
import { NETWORK_PASSPHRASE } from "@/lib/constants";

export const dynamic = "force-dynamic";
// Chain reads must be live: stellar-sdk 16 posts JSON-RPC over fetch with
// identical bodies, which Next 14 would otherwise cache.
export const fetchCache = "force-no-store";

const CHALLENGE_TTL_SECONDS = 300;

export async function GET(req: NextRequest) {
  const pubkey = (new URL(req.url).searchParams.get("pubkey") || "").trim();
  let valid = false;
  try {
    valid = StrKey.isValidEd25519PublicKey(pubkey);
  } catch {}
  if (!valid) {
    return NextResponse.json({ success: false, error: "pubkey must be a valid Stellar public key (G...)" }, { status: 400 });
  }

  // Cheap abuse guard: at most 20 challenges per key per 10 minutes.
  if ((await kvIncr(`cogladius:challenge-rate:${pubkey}`, 600)) > 20) {
    return NextResponse.json({ success: false, error: "Too many challenges; retry later" }, { status: 429 });
  }

  const nonce = randomBytes(24).toString("hex");
  await kvSet(`cogladius:challenge:${pubkey}`, nonce, CHALLENGE_TTL_SECONDS);

  return NextResponse.json({
    success: true,
    pubkey,
    nonce,
    message: registrationMessage(pubkey, nonce),
    scheme: "SEP-53",
    networkPassphrase: NETWORK_PASSPHRASE,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000).toISOString(),
  });
}
