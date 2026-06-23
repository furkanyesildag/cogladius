import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/projectStore";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const project = await getProject(Number(params.id));
  if (!project) return NextResponse.json({ success: false, error: "Proje bulunamadı" }, { status: 404 });
  return NextResponse.json({ success: true, project });
}
