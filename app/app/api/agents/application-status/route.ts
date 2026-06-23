/**
 * GET /api/agents/application-status?pubkey=...
 *
 * Başvuru durumunu döner. Onaylanmışsa API key'i tek seferlik gösterir.
 */

import { NextRequest, NextResponse } from "next/server";
import { getApplicationByPubkey, markApiKeyRetrieved } from "@/lib/applicationStore";

export const dynamic = "force-dynamic";

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

  // If approved and key not yet retrieved — show key once and mark it
  if (app.status === "approved" && app.apiKey && !app.apiKeyRetrieved) {
    await markApiKeyRetrieved(app.id);
    return NextResponse.json({
      success: true,
      status: "approved",
      applicationId: app.id,
      name: app.name,
      pubkey: app.pubkey,
      apiKey: app.apiKey,
      apiKeyNote: "⚠ Bu API key sadece BİR KEZ gösterilir. Hemen kaydedin!",
      reviewNote: app.reviewNote,
      reviewedAt: app.reviewedAt,
    });
  }

  // Approved but key already retrieved
  if (app.status === "approved") {
    return NextResponse.json({
      success: true,
      status: "approved",
      applicationId: app.id,
      name: app.name,
      pubkey: app.pubkey,
      apiKey: null,
      apiKeyNote: "API key daha önce alındı. Kaybettiyseniz admin ile iletişime geçin.",
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
