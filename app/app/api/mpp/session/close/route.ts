/**
 * POST /api/mpp/session/close { channel, issuedAt, signature }
 *
 * The channel funder (the agent) asks the provider to close. The request is a
 * SEP-53 signature by the channel's on-chain `from` address, so only the
 * funder can end its own session. The provider closes with the highest
 * commitment it holds: it receives what was committed and the remainder goes
 * back to the funder in the same transaction.
 */
import { NextRequest, NextResponse } from "next/server";
import { inspectChannel, closeWithHighest } from "@cogladius/agent-sdk/payments/provider";
import { closeMessage } from "@cogladius/agent-sdk/payments/session";
import { commitmentLedger, mppConfigured, mppNet, providerKeypair } from "@/lib/mpp/server";
import { verifySep53 } from "@/lib/sep53";
import { isFresh } from "@/lib/actionMessages";
import { explorerTx } from "@/lib/constants";
import { fromStroops } from "@cogladius/agent-sdk/network";

export const dynamic = "force-dynamic";
// Chain reads must be live: stellar-sdk 16 posts JSON-RPC over fetch with
// identical bodies, which Next 14 would otherwise cache.
export const fetchCache = "force-no-store";

export async function POST(req: NextRequest) {
  if (!mppConfigured()) return NextResponse.json({ success: false, error: "MPP payments are not enabled" }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const channel = String(body.channel || "");
  const issuedAt = Number(body.issuedAt);
  if (!isFresh(issuedAt)) return NextResponse.json({ success: false, error: "request expired; sign again" }, { status: 401 });

  const net = mppNet();
  let info;
  try {
    info = await inspectChannel(net, channel);
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message ?? String(err) }, { status: 404 });
  }
  if (info.to !== providerKeypair().publicKey()) {
    return NextResponse.json({ success: false, error: "channel does not pay this provider" }, { status: 400 });
  }
  if (!verifySep53(info.from, closeMessage(net.networkPassphrase, channel, issuedAt), String(body.signature || ""))) {
    return NextResponse.json({ success: false, error: "signature is not from the channel funder" }, { status: 403 });
  }

  try {
    const { hash, amount } = await closeWithHighest(net, commitmentLedger(), channel, providerKeypair());
    return NextResponse.json({ success: true, hash, amount: fromStroops(amount), explorerUrl: explorerTx(hash) });
  } catch (err: any) {
    const code = err?.code ?? "close_failed";
    const hint =
      code === "nothing_to_close"
        ? "No commitment was ever accepted on this channel. Recover the deposit yourself: close_start, then refund after the waiting period."
        : undefined;
    return NextResponse.json({ success: false, code, error: err?.message ?? String(err), hint }, { status: code === "nothing_to_close" ? 409 : 500 });
  }
}
