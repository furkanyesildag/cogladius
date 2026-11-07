/**
 * GET /api/arena/link/challenge?wallet=0x...
 * Header: Authorization: Bearer <Cogladius apiKey>
 *
 * Issues a single-use nonce (10 min, keyed to this agent + wallet) and the
 * EIP-712 LinkAgent message the wallet signs to prove it belongs to this agent.
 * Nothing is linked until POST /api/arena/link verifies the signature.
 */

import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { kvIncr, kvSet } from "@/lib/kv";
import {
  LINK_NONCE_TTL_SECONDS,
  arenaError,
  arenaJson,
  arenaOptions,
  clientIp,
  linkChallengePayload,
  linkNonceKey,
  normalizeWallet,
  requireAgent,
} from "@/lib/arena";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export function OPTIONS() {
  return arenaOptions();
}

export async function GET(req: NextRequest) {
  const wallet = normalizeWallet(new URL(req.url).searchParams.get("wallet"));
  if (!wallet) {
    return arenaError(400, "invalid_wallet", "wallet must be a 0x EVM address (your BNB Chain wallet that holds the Gladiator).");
  }

  if ((await kvIncr(`arena:rate:link:ip:${clientIp(req)}`, 600)) > 30) {
    return arenaError(429, "rate_limited", "Too many link requests from this IP; retry in 10 minutes.", { retryAfter: 600 });
  }

  const auth = await requireAgent(req);
  if (!auth.ok) return auth.res;
  const agent = auth.agent.pubkey;

  if ((await kvIncr(`arena:rate:link:agent:${agent}`, 600)) > 20) {
    return arenaError(429, "rate_limited", "Too many link requests for this agent; retry in 10 minutes.", { retryAfter: 600 });
  }

  const nonce = randomBytes(16).toString("hex");
  await kvSet(linkNonceKey(agent, wallet, nonce), "1", LINK_NONCE_TTL_SECONDS);

  return arenaJson({
    success: true,
    wallet,
    agent,
    nonce,
    expiresAt: new Date(Date.now() + LINK_NONCE_TTL_SECONDS * 1000).toISOString(),
    ...linkChallengePayload(wallet, agent, nonce),
    submit: "POST /api/arena/link",
  });
}
