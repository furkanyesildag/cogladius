/**
 * GET /api/mpp/session/{resource} — pay per request over a one-way payment
 * channel (MPP session mode). The agent names its channel in `x-mpp-channel`;
 * the channel is verified on-chain before it is served (see lib/mpp/server).
 * Each accepted commitment is recorded in the durable highest-commitment
 * ledger, which the close path settles from.
 */
import { NextRequest, NextResponse } from "next/server";
import { Credential } from "mppx";
import { RESOURCES } from "@/lib/mpp/resources";
import { channelServer, commitmentLedger, mppConfigured } from "@/lib/mpp/server";
import { verifyCommitment } from "@cogladius/agent-sdk/payments/provider";
import { NETWORK_PASSPHRASE } from "@/lib/constants";

export const dynamic = "force-dynamic";
// Chain reads must be live: stellar-sdk 16 posts JSON-RPC over fetch with
// identical bodies, which Next 14 would otherwise cache.
export const fetchCache = "force-no-store";

export async function GET(req: NextRequest, { params }: { params: { resource: string } }) {
  if (!mppConfigured()) return NextResponse.json({ error: "MPP payments are not enabled" }, { status: 503 });
  const resource = RESOURCES[params.resource];
  if (!resource) return NextResponse.json({ error: `unknown resource ${params.resource}` }, { status: 404 });
  const channel = req.headers.get("x-mpp-channel")?.trim();
  if (!channel) return NextResponse.json({ error: "x-mpp-channel header (C...) is required" }, { status: 400 });

  let server;
  try {
    server = await channelServer(channel);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err), code: err?.code ?? "channel_rejected" }, { status: 403 });
  }

  let result: any;
  try {
    result = await server.mppx.channel({ amount: resource.sessionPrice, description: resource.description })(req);
  } catch (err: any) {
    return NextResponse.json({ error: `commitment rejected: ${err?.message ?? err}` }, { status: 402 });
  }
  if (result.status === 402) return result.challenge;

  // Accepted by @stellar/mpp: keep the signature so the channel can be closed later.
  try {
    const cred: any = Credential.fromRequest(req);
    const amount = BigInt(cred.payload.amount);
    const sig = String(cred.payload.signature);
    if (verifyCommitment(NETWORK_PASSPHRASE, channel, server.info.commitmentKey, amount, sig)) {
      await commitmentLedger().record(channel, amount, sig);
    }
  } catch (err) {
    console.error("[mpp/session] failed to record commitment", err);
  }

  const data = await resource.load();
  return result.withReceipt(Response.json({ resource: resource.id, mode: "session", channel, data }));
}
