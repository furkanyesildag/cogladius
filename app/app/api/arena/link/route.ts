/**
 * POST /api/arena/link
 * Header: Authorization: Bearer <Cogladius apiKey>
 * Body:   { wallet, nonce, signature, signatureRecovery? }
 *
 * Verifies the wallet's EIP-712 LinkAgent signature, consumes the nonce once and
 * stores the verified agent <-> wallet pair that the Gladiator gate trusts. A
 * newer proof from the wallet owner replaces the agent linked before.
 */

import { NextRequest } from "next/server";
import { kvGet, kvIncr, kvTake } from "@/lib/kv";
import {
  arenaError,
  arenaJson,
  arenaOptions,
  clientIp,
  linkNonceKey,
  normalizeLinkSignature,
  normalizeWallet,
  requireAgent,
  setVerifiedWallet,
  verifyLinkSignature,
} from "@/lib/arena";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export function OPTIONS() {
  return arenaOptions();
}

export async function POST(req: NextRequest) {
  if ((await kvIncr(`arena:rate:link:ip:${clientIp(req)}`, 600)) > 30) {
    return arenaError(429, "rate_limited", "Too many link requests from this IP; retry in 10 minutes.", { retryAfter: 600 });
  }

  const auth = await requireAgent(req);
  if (!auth.ok) return auth.res;
  const agent = auth.agent.pubkey;

  if ((await kvIncr(`arena:rate:link:agent:${agent}`, 600)) > 20) {
    return arenaError(429, "rate_limited", "Too many link requests for this agent; retry in 10 minutes.", { retryAfter: 600 });
  }

  const body = await req.json().catch(() => null);
  const wallet = normalizeWallet(body?.wallet);
  if (!wallet) return arenaError(400, "invalid_wallet", "wallet must be a 0x EVM address.");
  const nonce = body?.nonce;
  if (typeof nonce !== "string" || !/^[0-9a-f]{32}$/.test(nonce)) {
    return arenaError(400, "invalid_nonce", "nonce must be the value returned by GET /api/arena/link/challenge.");
  }
  const signature = normalizeLinkSignature(body?.signature, body?.signatureRecovery);
  if (!signature) {
    return arenaError(400, "invalid_signature", "signature must be 65 bytes of hex, or r||s hex with signatureRecovery \"00\" or \"01\".");
  }

  const key = linkNonceKey(agent, wallet, nonce);
  const staleNonce = () =>
    arenaError(409, "nonce_invalid", "This nonce is unknown, expired, already used, or was issued for another agent or wallet. Request a new challenge.");

  // A bad signature leaves the nonce alone; only a valid proof spends it. kvTake
  // is the atomic step: of two concurrent valid requests, exactly one gets it.
  if (!(await kvGet(key))) return staleNonce();
  if (!(await verifyLinkSignature(wallet, agent, nonce, signature))) {
    return arenaError(403, "signature_mismatch", "The signature does not come from this wallet for this challenge.");
  }
  if (!(await kvTake(key))) return staleNonce();

  const { replacedAgent } = await setVerifiedWallet(agent, wallet);
  return arenaJson({ success: true, wallet, agent, verified: true, replacedAgent });
}
