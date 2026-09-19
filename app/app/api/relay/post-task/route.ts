/**
 * Fee-sponsored post_task relayer.
 *
 * GET  → the relayer account a poster must build its authorization against.
 * POST → { poster, taskId, reward, deadline, authEntries } — the poster's
 *        signed authorization entry for escrow.post_task. The relayer checks it
 *        authorizes exactly that call and the reward transfer (see the SDK's
 *        relaySponsoredPostTask), then submits it as the transaction source and
 *        pays the network fee.
 *
 * On mainnet the relayer spends real XLM, so it is bounded three ways: a per-tx
 * fee cap, at most RELAYER_MAX_PER_POSTER sponsored posts per poster per day,
 * and a RELAYER_DAILY_BUDGET_XLM total per day.
 *
 * Env: RELAYER_SECRET, RELAYER_MAX_FEE_XLM (0.2), RELAYER_MAX_PER_POSTER (5),
 *      RELAYER_DAILY_BUDGET_XLM (5).
 */
import { NextRequest, NextResponse } from "next/server";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { relaySponsoredPostTask, RelayRejected } from "@cogladius/agent-sdk/sponsor";
import { toStroops, fromStroops } from "@cogladius/agent-sdk/network";
import { mppNet } from "@/lib/mpp/server";
import { kvIncr, kvIncrBy } from "@/lib/kv";
import { explorerTx, HORIZON_URL } from "@/lib/constants";

export const dynamic = "force-dynamic";
// Chain reads must be live: stellar-sdk 16 posts JSON-RPC over fetch with
// identical bodies, which Next 14 would otherwise cache.
export const fetchCache = "force-no-store";

function relayer(): Keypair | null {
  const s = process.env.RELAYER_SECRET;
  return s ? Keypair.fromSecret(s) : null;
}

const DAY = 86_400;

/**
 * Spendable XLM on the relayer: balance minus the base reserve (1 XLM plus 0.5
 * per subentry). If it cannot cover one worst-case fee, sponsorship is
 * reported unavailable so clients fall back to a normal, self-paid post
 * instead of failing with txInsufficientBalance.
 */
async function relayerSpendable(pub: string): Promise<number | null> {
  try {
    const a: any = await fetch(`${HORIZON_URL}/accounts/${pub}`, { cache: "no-store" }).then((x) => x.json());
    const native = Number(a.balances?.find((b: any) => b.asset_type === "native")?.balance ?? 0);
    return native - (1 + 0.5 * Number(a.subentry_count ?? 0));
  } catch {
    return null; // unknown: do not block on a Horizon hiccup
  }
}

export async function GET() {
  const r = relayer();
  if (!r) return NextResponse.json({ success: false, error: "fee sponsorship is not enabled" }, { status: 503 });
  const spendable = await relayerSpendable(r.publicKey());
  if (spendable !== null && spendable < Number(process.env.RELAYER_MAX_FEE_XLM || "0.2")) {
    console.error(`[relay] relayer ${r.publicKey()} is low on XLM (${spendable.toFixed(4)} spendable); sponsorship paused`);
    return NextResponse.json({ success: false, code: "relayer_low_balance", error: "fee sponsorship is temporarily unavailable" }, { status: 503 });
  }
  return NextResponse.json({
    success: true,
    relayer: r.publicKey(),
    maxFee: process.env.RELAYER_MAX_FEE_XLM || "0.2",
    maxPerPosterPerDay: Number(process.env.RELAYER_MAX_PER_POSTER || 5),
    note: "Build post_task with this account as the transaction source, sign only your authorization entry, and POST it here.",
  });
}

export async function POST(req: NextRequest) {
  const r = relayer();
  if (!r) return NextResponse.json({ success: false, error: "fee sponsorship is not enabled" }, { status: 503 });
  const body = await req.json().catch(() => null);
  const poster = String(body?.poster || "");
  if (!StrKey.isValidEd25519PublicKey(poster)) {
    return NextResponse.json({ success: false, error: "poster must be a G... address" }, { status: 400 });
  }

  const perPoster = Number(process.env.RELAYER_MAX_PER_POSTER || 5);
  if ((await kvIncr(`cogladius:relay:poster:${poster}`, DAY)) > perPoster) {
    return NextResponse.json({ success: false, code: "rate_limited", error: "sponsored post limit reached for today" }, { status: 429 });
  }
  const maxFee = Number(toStroops(process.env.RELAYER_MAX_FEE_XLM || "0.2"));
  const budget = Number(toStroops(process.env.RELAYER_DAILY_BUDGET_XLM || "5"));
  // Reserve the worst-case fee against today's budget before spending anything.
  if ((await kvIncrBy("cogladius:relay:budget", maxFee, DAY)) > budget) {
    return NextResponse.json({ success: false, code: "budget_exhausted", error: "relayer daily budget exhausted" }, { status: 503 });
  }

  try {
    const res = await relaySponsoredPostTask({
      net: mppNet(),
      relayer: r,
      request: {
        poster,
        taskId: String(body.taskId),
        reward: String(body.reward),
        deadline: Number(body.deadline),
        authEntries: body.authEntries,
      },
      maxFeeStroops: maxFee,
    });
    // Release the unused part of the reservation.
    await kvIncrBy("cogladius:relay:budget", res.feeCharged - maxFee, DAY);
    return NextResponse.json({
      success: true,
      hash: res.hash,
      ledger: res.ledger,
      feePaidByRelayer: fromStroops(res.feeCharged),
      relayer: r.publicKey(),
      explorerUrl: explorerTx(res.hash),
    });
  } catch (err: any) {
    await kvIncrBy("cogladius:relay:budget", -maxFee, DAY);
    const status = err instanceof RelayRejected ? 400 : 502;
    return NextResponse.json({ success: false, code: err?.code, error: err?.message ?? String(err) }, { status });
  }
}
