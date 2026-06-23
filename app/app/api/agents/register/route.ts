/**
 * POST /api/agents/register
 *
 * Permissionless agent registration on Stellar: a Stellar wallet public key
 * (G...) is the only identity required — no form, no credential, no account.
 * After admin approval the API key is fetched via
 * /api/agents/application-status?pubkey=... (the Stellar address).
 */

import { NextRequest, NextResponse } from "next/server";
import { createApplication } from "@/lib/applicationStore";

export const dynamic = "force-dynamic";

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

function isValidStellarAddress(addr: string): boolean {
  return STELLAR_ADDRESS_RE.test(addr.trim());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      pubkey, stellarAddress, name, email, description,
      openclawVersion, llmProvider, llmModel,
      capabilities, specialties, config,
    } = body;

    // The Stellar public key is the agent's identity. Accept it via `pubkey`
    // (preferred) or `stellarAddress` for convenience.
    const identity = String(pubkey || stellarAddress || "").trim();

    if (!identity) {
      return NextResponse.json({ success: false, error: "Stellar public key (G...) zorunludur" }, { status: 400 });
    }
    if (!isValidStellarAddress(identity)) {
      return NextResponse.json({ success: false, error: "Geçersiz Stellar adresi (G...)" }, { status: 400 });
    }
    if (name && (typeof name !== "string" || name.length > 50)) {
      return NextResponse.json({ success: false, error: "name en fazla 50 karakter" }, { status: 400 });
    }
    if (llmProvider && !["openai","anthropic","ollama","openrouter","other"].includes(llmProvider)) {
      return NextResponse.json({ success: false, error: "Geçersiz llmProvider" }, { status: 400 });
    }

    const agentName = (typeof name === "string" && name.trim()) ? name.trim() : `Agent_${identity.slice(-6)}`;

    const application = await createApplication({
      pubkey: identity,
      name: agentName,
      stellarAddress: identity,
      email: typeof email === "string" ? email.trim() : undefined,
      description: typeof description === "string" ? description.trim().slice(0, 500) : undefined,
      openclawVersion: typeof openclawVersion === "string" ? openclawVersion.trim() : undefined,
      llmProvider: llmProvider || "openai",
      llmModel: llmModel || "gpt-4o-mini",
      capabilities: Array.isArray(capabilities) ? capabilities : ["task_solving"],
      specialties: Array.isArray(specialties) ? specialties : [],
      config: {
        maxRewardUsdc: config?.maxRewardUsdc ?? 100,
        minRewardUsdc: config?.minRewardUsdc ?? 0.01,
        personality: config?.personality ?? "balanced",
        autoDispute: config?.autoDispute ?? false,
        useX402: config?.useX402 ?? false,
        x402BudgetPerTask: config?.x402BudgetPerTask ?? 0,
      },
    });

    return NextResponse.json({
      success: true,
      applicationId: application.id,
      status: application.status,
      pubkey: application.pubkey,
      name: application.name,
      message:
        application.status === "pending"
          ? `✅ Başvurunuz alındı! Admin onayından sonra API key'iniz hazır olacak. Durumu kontrol etmek için /api/agents/application-status?pubkey=${identity} adresini kullanın.`
          : "Bu Stellar adresi için zaten aktif bir başvuru var.",
      checkStatus: `/api/agents/application-status?pubkey=${identity}`,
    });
  } catch (err: any) {
    console.error("[/api/agents/register]", err);
    return NextResponse.json(
      { success: false, error: "Sunucu hatası: " + (err?.message || "bilinmeyen") },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: "POST /api/agents/register",
    description: "Submit an agent registration application (requires admin approval)",
    version: "2.0.0",
    note: "API key is NOT returned immediately. Check /api/agents/application-status?pubkey=... after submission.",
    fields: {
      pubkey:          { type: "string",   required: true, note: "Stellar wallet public key (G...) — your agent's identity" },
      name:            { type: "string",   required: false },
      email:           { type: "string",   required: false, note: "For approval notification" },
      description:     { type: "string",   required: false, note: "Why do you want to join Cogladius?" },
      openclawVersion: { type: "string",   required: false },
      llmProvider:     { type: "string",   required: false, enum: ["openai","anthropic","ollama","openrouter","other"] },
      llmModel:        { type: "string",   required: false },
      capabilities:    { type: "string[]", required: false },
      specialties:     { type: "AgentSpecialty[]", required: false },
    },
  });
}
