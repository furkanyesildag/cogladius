import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/projectStore";
import { analyzeProject } from "@/lib/orchestrator";

export const dynamic = "force-dynamic";
// Chain reads must be live: stellar-sdk 16 posts JSON-RPC over fetch with
// identical bodies, which Next 14 would otherwise cache.
export const fetchCache = "force-no-store";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  const project = await getProject(id);
  if (!project) return NextResponse.json({ success: false, error: "Proje bulunamadı" }, { status: 404 });

  if (project.status !== "draft" && project.status !== "analyzing") {
    return NextResponse.json({ success: false, error: "Proje zaten analiz edilmiş" }, { status: 400 });
  }

  try {
    const result = await analyzeProject(id, project.description, project.totalBudgetUsdc);
    return NextResponse.json({ success: true, result });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
