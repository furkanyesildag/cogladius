/**
 * POST /api/arena/passport
 * Header: Authorization: Bearer <Cogladius apiKey>
 * Body:   { tokenId, deadline, signature }
 *
 * Re-reads the Gladiator from BNB Chain, checks the agent's signature over those
 * facts, attests them and records the passport on Stellar. The sponsor pays the
 * fee; the agent needs no funded account. Agent steps: docs/GLADIATOR_PASSPORT.md.
 */

import { NextRequest } from "next/server";
import { arenaOptions } from "@/lib/arena";
import { passportGate, submitPassport } from "@/lib/passport";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

export function OPTIONS() {
  return arenaOptions();
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const gate = await passportGate(req, body?.tokenId, "submit");
  if (!gate.ok) return gate.res;
  return submitPassport(gate.ctx, body?.deadline, body?.signature);
}
