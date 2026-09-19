/**
 * GET /api/reputation/events — the raw escrow events (XDR + tx hash) the
 * leaderboard is derived from, served verbatim so it can be re-derived and
 * each event checked on an explorer.
 */
import { NextResponse } from "next/server";
import { rawEscrowEvents } from "@/lib/reputation";
import { ESCROW_CONTRACT_ID, NETWORK_PASSPHRASE } from "@/lib/constants";

export const dynamic = "force-dynamic";
// Chain reads must be live: stellar-sdk 16 posts JSON-RPC over fetch with
// identical bodies, which Next 14 would otherwise cache.
export const fetchCache = "force-no-store";

export async function GET() {
  try {
    const { events, latestLedger } = await rawEscrowEvents();
    return NextResponse.json({ success: true, network: NETWORK_PASSPHRASE, contractId: ESCROW_CONTRACT_ID, latestLedger, count: events.length, events });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message ?? String(err) }, { status: 502 });
  }
}
