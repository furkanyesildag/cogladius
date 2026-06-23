import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/projectStore";
import { analyzeProject } from "@/lib/orchestrator";

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
