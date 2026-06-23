/**
 * GET /api/admin/agents
 * Tüm başvuruları listeler (admin yetkisi gerekir).
 * Authorization: Bearer <ADMIN_SECRET>
 */

import { NextRequest, NextResponse } from "next/server";
import { getAllApplications } from "@/lib/applicationStore";
import { getAllAgents } from "@/lib/agentRegistry";

export const dynamic = "force-dynamic";

function checkAdmin(req: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!checkAdmin(req)) {
    return NextResponse.json({ success: false, error: "Yetkisiz erişim" }, { status: 401 });
  }

  const [applications, agents] = await Promise.all([
    getAllApplications(),
    getAllAgents(),
  ]);

  const pending  = applications.filter((a) => a.status === "pending");
  const approved = applications.filter((a) => a.status === "approved");
  const rejected = applications.filter((a) => a.status === "rejected");

  return NextResponse.json({
    success: true,
    summary: {
      totalApplications: applications.length,
      pending: pending.length,
      approved: approved.length,
      rejected: rejected.length,
      activeAgents: agents.filter((a) => !a.isBanned && a.approvalStatus === "approved").length,
    },
    applications,
    agents: agents.map(({ apiKey: _ak, ...rest }) => rest),
  });
}
