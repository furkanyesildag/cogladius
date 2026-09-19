/**
 * GET /api/mpp/charge/{resource} — pay per request (MPP charge mode).
 * Unpaid requests get HTTP 402 with a Stellar charge challenge; a request that
 * carries a valid credential gets the data and a Payment-Receipt header whose
 * reference is the settlement transaction hash.
 */
import { NextRequest, NextResponse } from "next/server";
import { RESOURCES } from "@/lib/mpp/resources";
import { chargeServer, mppConfigured } from "@/lib/mpp/server";

export const dynamic = "force-dynamic";
// Chain reads must be live: stellar-sdk 16 posts JSON-RPC over fetch with
// identical bodies, which Next 14 would otherwise cache.
export const fetchCache = "force-no-store";

export async function GET(req: NextRequest, { params }: { params: { resource: string } }) {
  if (!mppConfigured()) return NextResponse.json({ error: "MPP payments are not enabled" }, { status: 503 });
  const resource = RESOURCES[params.resource];
  if (!resource) return NextResponse.json({ error: `unknown resource ${params.resource}` }, { status: 404 });

  let result: any;
  try {
    result = await chargeServer().charge({ amount: resource.chargePrice, description: resource.description })(req);
  } catch (err: any) {
    return NextResponse.json({ error: `payment verification failed: ${err?.message ?? err}` }, { status: 402 });
  }
  if (result.status === 402) return result.challenge;

  const data = await resource.load();
  return result.withReceipt(Response.json({ resource: resource.id, mode: "charge", data }));
}
