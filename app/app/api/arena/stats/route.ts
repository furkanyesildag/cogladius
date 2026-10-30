/**
 * GET /api/arena/stats → { attempts, passes, minted }
 *
 * attempts/passes come from redis (`arena:stats`); minted is the contract's
 * totalMinted(), cached for 60s so the page cannot hammer the BSC RPC.
 */

import { kvGet, kvSet } from "@/lib/kv";
import {
  MAX_ATTEMPTS_PER_DAY,
  MINTED_CACHE_KEY,
  SOURCIFY_BASE,
  arenaJson,
  arenaNotReady,
  arenaOptions,
  gladiatorAddress,
  isDryRun,
  signerAddress,
  statsRead,
  totalMintedOnChain,
} from "@/lib/arena";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export function OPTIONS() {
  return arenaOptions();
}

async function mintedCached(): Promise<number | null> {
  if (isDryRun() || !gladiatorAddress()) return null;
  const hit = await kvGet(MINTED_CACHE_KEY);
  if (hit != null && hit !== "" && !Number.isNaN(Number(hit))) return Number(hit);
  try {
    const n = await totalMintedOnChain();
    if (n != null) await kvSet(MINTED_CACHE_KEY, String(n), 60);
    return n;
  } catch {
    return null;
  }
}

export async function GET() {
  const notReady = arenaNotReady(false);
  if (notReady) return notReady;

  const [{ attempts, passes }, minted] = await Promise.all([statsRead(), mintedCached()]);
  const contract = gladiatorAddress();
  return arenaJson(
    {
      success: true,
      attempts,
      passes,
      minted,
      contract,
      chainId: 56,
      signer: signerAddress(),
      sourcify: contract ? `${SOURCIFY_BASE}/${contract}` : null,
      maxAttemptsPerDay: MAX_ATTEMPTS_PER_DAY,
      ...(isDryRun() ? { dryRun: true } : {}),
    },
    200,
    { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" }
  );
}
