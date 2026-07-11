import { NextRequest, NextResponse } from "next/server";
import { createProject, getAllProjects, getProjectsByPoster } from "@/lib/projectStore";

export async function GET(req: NextRequest) {
  const poster = req.nextUrl.searchParams.get("poster");
  const projects = poster ? await getProjectsByPoster(poster) : await getAllProjects();
  return NextResponse.json({ success: true, projects });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { poster, title, description, totalBudgetUsdc, deadlineDays = 7 } = body;

    if (!poster || !title || !description || !totalBudgetUsdc) {
      return NextResponse.json({ success: false, error: "poster, title, description, totalBudgetUsdc zorunlu" }, { status: 400 });
    }
    if (totalBudgetUsdc < 0.01) {
      return NextResponse.json({ success: false, error: "Minimum bütçe 0.01 XLM" }, { status: 400 });
    }

    const deadline = Math.floor(Date.now() / 1000) + deadlineDays * 86400;
    const project = await createProject({ poster, title, description, totalBudgetUsdc, deadline });

    return NextResponse.json({ success: true, project });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
