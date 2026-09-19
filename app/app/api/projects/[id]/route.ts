import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/projectStore";

export const dynamic = "force-dynamic";
// Chain reads must be live: stellar-sdk 16 posts JSON-RPC over fetch with
// identical bodies, which Next 14 would otherwise cache.
export const fetchCache = "force-no-store";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const project = await getProject(Number(params.id));
  if (!project) return NextResponse.json({ success: false, error: "Proje bulunamadı" }, { status: 404 });
  return NextResponse.json({ success: true, project });
}
