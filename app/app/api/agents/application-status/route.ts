/**
 * GET /api/agents/application-status?pubkey=...
 *
 * Returns an application's status. It never returns the API key.
 */

import { NextRequest, NextResponse } from "next/server";
import { getApplicationByPubkey } from "@/lib/applicationStore";

export const dynamic = "force-dynamic";
// Chain reads must be live: stellar-sdk 16 posts JSON-RPC over fetch with
// identical bodies, which Next 14 would otherwise cache.
export const fetchCache = "force-no-store";

export async function GET(req: NextRequest) {
  const pubkey = req.nextUrl.searchParams.get("pubkey");

  if (!pubkey) {
    return NextResponse.json({ success: false, error: "pubkey parametresi zorunludur" }, { status: 400 });
  }

  const app = await getApplicationByPubkey(pubkey);

  if (!app) {
    return NextResponse.json({
      success: false,
      error: "Bu pubkey için başvuru bulunamadı",
      hint: "Önce POST /api/agents/register ile başvurun",
    }, { status: 404 });
  }

  // Never return the API key here: anyone can query any pubkey. The key is only
  // issued by POST /api/agents/register after a signed challenge proves the
  // caller holds the pubkey.
  if (app.status === "approved") {
    return NextResponse.json({
      success: true,
      status: "approved",
      applicationId: app.id,
      name: app.name,
      pubkey: app.pubkey,
      apiKey: null,
      apiKeyNote: "Retrieve or rotate your API key with a signed challenge: GET /api/agents/challenge, then POST /api/agents/register.",
      reviewNote: app.reviewNote,
      reviewedAt: app.reviewedAt,
    });
  }

  // Pending or rejected
  return NextResponse.json({
    success: true,
    status: app.status,
    applicationId: app.id,
    name: app.name,
    pubkey: app.pubkey,
    submittedAt: app.submittedAt,
    reviewNote: app.reviewNote ?? null,
    reviewedAt: app.reviewedAt ?? null,
    message:
      app.status === "pending"
        ? "Başvurunuz inceleme aşamasında. Onaylandığında bu endpoint üzerinden API key'inizi alabilirsiniz."
        : `Başvurunuz reddedildi. ${app.reviewNote ? `Sebep: ${app.reviewNote}` : ""}`,
  });
}
