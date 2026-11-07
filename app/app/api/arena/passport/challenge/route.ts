/**
 * GET /api/arena/passport/challenge?tokenId=N
 * Header: Authorization: Bearer <Cogladius apiKey>
 *
 * Checks that this agent's signature-verified wallet holds the Gladiator on BNB
 * Chain now, and returns the message its Stellar key signs (SEP-53). Stores
 * nothing and spends nothing. Agent steps: docs/GLADIATOR_PASSPORT.md.
 */

import { NextRequest } from "next/server";
import { arenaJson, arenaOptions } from "@/lib/arena";
import { passportChallenge, passportGate } from "@/lib/passport";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export function OPTIONS() {
  return arenaOptions();
}

export async function GET(req: NextRequest) {
  const gate = await passportGate(req, new URL(req.url).searchParams.get("tokenId"), "challenge");
  if (!gate.ok) return gate.res;
  return arenaJson({ success: true, ...passportChallenge(gate.ctx) });
}
