import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/projectStore";
import { analyzeProject } from "@/lib/orchestrator";
import { guardPublicAi } from "@/lib/publicAiGuard";

export const dynamic = "force-dynamic";
// Chain reads must be live: stellar-sdk 16 posts JSON-RPC over fetch with
// identical bodies, which Next 14 would otherwise cache.
export const fetchCache = "force-no-store";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const blocked = await guardPublicAi(_req);
  if (blocked) return blocked;
  const id = Number(params.id);
  const project = await getProject(id);
  if (!project) return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });

  if (project.status !== "draft" && project.status !== "analyzing") {
    return NextResponse.json({ success: false, error: "This project has already been analysed" }, { status: 400 });
  }

  try {
    const result = await analyzeProject(id, project.description, project.totalBudgetUsdc);
    return NextResponse.json({ success: true, result });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
