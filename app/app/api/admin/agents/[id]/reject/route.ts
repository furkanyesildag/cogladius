/**
 * POST /api/admin/agents/[id]/reject
 * Başvuruyu reddeder.
 * Authorization: Bearer <ADMIN_SECRET>
 */

import { NextRequest, NextResponse } from "next/server";
import { getApplication, rejectApplication } from "@/lib/applicationStore";

export const dynamic = "force-dynamic";

function checkAdmin(req: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!checkAdmin(req)) {
    return NextResponse.json({ success: false, error: "Yetkisiz erişim" }, { status: 401 });
  }

  const { id } = params;
  const body = await req.json().catch(() => ({}));
  const reviewNote: string | undefined = body.reviewNote;

  const application = await getApplication(id);
  if (!application) {
    return NextResponse.json({ success: false, error: "Başvuru bulunamadı" }, { status: 404 });
  }
  if (application.status !== "pending") {
    return NextResponse.json({ success: false, error: `Başvuru zaten ${application.status}` }, { status: 400 });
  }

  const rejected = await rejectApplication(id, reviewNote);

  return NextResponse.json({
    success: true,
    applicationId: id,
    pubkey: application.pubkey,
    name: application.name,
    message: `Başvuru reddedildi. Sebep: ${reviewNote || "belirtilmedi"}`,
    status: rejected?.status,
  });
}
