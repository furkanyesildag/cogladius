/**
 * GET /api/mpp/session/sweep — provider-side watchdog (Vercel cron or admin).
 *
 * If a funder started a unilateral close (`close_start`), the provider has
 * `refund_waiting_period` ledgers (≥ ~2 days, enforced when the channel was
 * accepted) to close with its highest commitment before the funder can take
 * everything back. This route closes every such channel.
 *
 * Auth: daily Vercel cron (`Authorization: Bearer <CRON_SECRET>`) or admin.
 */
import { NextRequest, NextResponse } from "next/server";
import { inspectChannel, closeWithHighest } from "@cogladius/agent-sdk/payments/provider";
import { commitmentLedger, mppConfigured, mppNet, providerKeypair, CHANNEL_INDEX_KEY } from "@/lib/mpp/server";
import { setMembers } from "@/lib/mpp/store";
import { isAdminRequest } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";
// Chain reads must be live: stellar-sdk 16 posts JSON-RPC over fetch with
// identical bodies, which Next 14 would otherwise cache.
export const fetchCache = "force-no-store";

export async function GET(req: NextRequest) {
  const cron = process.env.CRON_SECRET && req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  if (!cron && !isAdminRequest(req)) return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  if (!mppConfigured()) return NextResponse.json({ success: true, checked: 0, note: "MPP disabled" });

  const net = mppNet();
  const ledger = commitmentLedger();
  const results: any[] = [];
  for (const channel of await setMembers(CHANNEL_INDEX_KEY)) {
    try {
      const top = await ledger.highest(channel);
      if (!top || top.closeTxHash) continue;
      const info = await inspectChannel(net, channel);
      if (info.closeEffectiveAtLedger === null) {
        results.push({ channel, action: "none" });
        continue;
      }
      const { hash, amount } = await closeWithHighest(net, ledger, channel, providerKeypair());
      results.push({ channel, action: "closed", hash, amount: amount.toString() });
    } catch (err: any) {
      results.push({ channel, action: "error", error: err?.message ?? String(err) });
    }
  }
  return NextResponse.json({ success: true, checked: results.length, results });
}
