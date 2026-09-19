/**
 * GET /api/mpp — discovery document for the paid resources agents can buy
 * with Stellar MPP (charge or session mode), and everything an agent needs to
 * open a session: provider account, asset, channel factory, required wasm,
 * deposit cap and minimum refund waiting period.
 */
import { NextResponse } from "next/server";
import { RESOURCES } from "@/lib/mpp/resources";
import { mppConfigured, mppNet, providerKeypair, channelPolicy } from "@/lib/mpp/server";
import { fromStroops } from "@cogladius/agent-sdk/network";

export const dynamic = "force-dynamic";
// Chain reads must be live: stellar-sdk 16 posts JSON-RPC over fetch with
// identical bodies, which Next 14 would otherwise cache.
export const fetchCache = "force-no-store";

export async function GET() {
  if (!mppConfigured()) {
    return NextResponse.json({ success: false, error: "MPP payments are not enabled on this deployment" }, { status: 503 });
  }
  const net = mppNet();
  const policy = channelPolicy();
  return NextResponse.json({
    success: true,
    protocol: "MPP (HTTP 402), method stellar",
    network: net.networkPassphrase,
    asset: { code: net.rewardAssetCode, contract: net.rewardAssetContractId },
    recipient: providerKeypair().publicKey(),
    charge: { endpoint: "/api/mpp/charge/{resource}" },
    session: {
      endpoint: "/api/mpp/session/{resource}",
      channelHeader: "x-mpp-channel",
      channelFactory: net.channelFactoryId ?? null,
      channelWasmHash: policy.wasmHash,
      maxDeposit: fromStroops(policy.maxDeposit),
      minRefundWaitingPeriodLedgers: policy.minRefundWaitingPeriod,
      close: "POST /api/mpp/session/close { channel, issuedAt, signature } (SEP-53 by the channel funder)",
      warning: "The one-way-channel contract is unaudited upstream code. Deposits are capped for that reason.",
    },
    resources: Object.values(RESOURCES).map((r) => ({
      id: r.id,
      description: r.description,
      chargePrice: r.chargePrice,
      sessionPrice: r.sessionPrice,
    })),
  });
}
