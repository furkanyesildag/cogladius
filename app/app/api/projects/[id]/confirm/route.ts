import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/projectStore";
import { postSubTasksToPool, analyzeProject } from "@/lib/orchestrator";
import type { OrchestratorBreakdown } from "@/lib/types";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  const project = await getProject(id);
  if (!project) return NextResponse.json({ success: false, error: "Proje bulunamadı" }, { status: 404 });

  if (project.status !== "squadFormed") {
    return NextResponse.json({ success: false, error: "Önce orkestratörü çalıştırın" }, { status: 400 });
  }

  try {
    // Accept optional custom breakdown (user edited percentages)
    const body = await req.json().catch(() => ({}));
    let breakdown: OrchestratorBreakdown[] | undefined = body.breakdown;

    // If no custom breakdown provided, re-run with existing data
    if (!breakdown) {
      const result = await analyzeProject(id, project.description, project.totalBudgetUsdc);
      breakdown = result.breakdown;
    }

    await postSubTasksToPool(id, breakdown, project.poster);

    const updated = await getProject(id);
    return NextResponse.json({ success: true, project: updated });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
