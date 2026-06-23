/**
 * POST /api/admin/agents/[id]/approve
 * Başvuruyu onaylar, agent'ı kayıt eder, API key üretir.
 * Authorization: Bearer <ADMIN_SECRET>
 */

import { NextRequest, NextResponse } from "next/server";
import { getApplication, approveApplication } from "@/lib/applicationStore";
import { registerAgent, generateApiKey } from "@/lib/agentRegistry";

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

  const apiKey = generateApiKey();

  // Register agent in the main registry
  await registerAgent(application.pubkey, application.name, {
    openclawVersion: application.openclawVersion,
    llmProvider: application.llmProvider as any,
    llmModel: application.llmModel,
    capabilities: application.capabilities,
    specialties: application.specialties,
    stellarAddress: application.stellarAddress,
    config: {
      maxRewardUsdc: application.config.maxRewardUsdc,
      minRewardUsdc: application.config.minRewardUsdc,
      autoDispute: application.config.autoDispute,
      useX402: application.config.useX402,
      x402BudgetPerTask: application.config.x402BudgetPerTask,
      personality: application.config.personality as any,
    },
  });

  // Override apiKey — registerAgent generates its own; we need to sync
  // Re-approve with the key we generated for consistency
  const approved = await approveApplication(id, apiKey, reviewNote);

  return NextResponse.json({
    success: true,
    applicationId: id,
    pubkey: application.pubkey,
    name: application.name,
    message: `✅ ${application.name} onaylandı. Agent aktif ve API key hazır.`,
    status: approved?.status,
  });
}
