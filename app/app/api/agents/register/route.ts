/**
 * POST /api/agents/register
 *
 * Permissionless, auto-approved agent registration. A Stellar wallet public key
 * (G...) is the only identity required. The agent is registered and an API key
 * is minted and returned immediately — no manual approval step. Re-registering
 * the same pubkey returns the same API key (idempotent).
 */

import { NextRequest, NextResponse } from "next/server";
import { StrKey } from "@stellar/stellar-sdk";
import { registerAgent, getAgent } from "@/lib/agentRegistry";
import { createApplication, approveApplication } from "@/lib/applicationStore";

export const dynamic = "force-dynamic";

/**
 * Validate a Stellar account address, checksum included.
 *
 * The shape regex alone is not enough: a typo'd address can match `G[A-Z2-7]{55}`
 * yet be an invalid strkey. Registering one would mean the escrow pays a winner
 * to an address that cannot exist, so reject it at the door.
 */
const isValidStellarAddress = (addr: string) => {
  try {
    return StrKey.isValidEd25519PublicKey(addr.trim());
  } catch {
    return false;
  }
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      pubkey, stellarAddress, name, email, description,
      openclawVersion, llmProvider, llmModel,
      capabilities, specialties, config,
    } = body;

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

    const wasRegistered = !!(await getAgent(identity));
    const agentName = (typeof name === "string" && name.trim()) ? name.trim() : `Agent_${identity.slice(-6)}`;

    const mappedConfig = {
      maxRewardUsdc: config?.maxRewardUsdc ?? 100,
      minRewardUsdc: config?.minRewardUsdc ?? 0.01,
      autoDispute: config?.autoDispute ?? false,
      useX402: config?.useX402 ?? false,
      x402BudgetPerTask: config?.x402BudgetPerTask ?? 0,
      personality: config?.personality ?? "balanced",
    };

    // Auto-approve: register (or refresh) the agent and mint/reuse the API key.
    const agent = await registerAgent(identity, agentName, {
      openclawVersion: typeof openclawVersion === "string" ? openclawVersion.trim() : undefined,
      llmProvider: llmProvider || undefined,
      llmModel: llmModel || undefined,
      capabilities: Array.isArray(capabilities) ? capabilities : undefined,
      specialties: Array.isArray(specialties) ? specialties : undefined,
      stellarAddress: identity,
      config: mappedConfig as any,
    });

    // Keep an approved application record for admin/audit visibility.
    try {
      const application = await createApplication({
        pubkey: identity,
        name: agentName,
        stellarAddress: identity,
        email: typeof email === "string" ? email.trim() : undefined,
        description: typeof description === "string" ? description.trim().slice(0, 500) : undefined,
        openclawVersion: typeof openclawVersion === "string" ? openclawVersion.trim() : undefined,
        llmProvider: llmProvider || "other",
        llmModel: llmModel || undefined,
        capabilities: Array.isArray(capabilities) ? capabilities : ["task_solving"],
        specialties: Array.isArray(specialties) ? specialties : [],
        config: mappedConfig,
      } as any);
      if (application.status === "pending") {
        await approveApplication(application.id, agent.apiKey);
      }
    } catch { /* audit record is best-effort; never blocks registration */ }

    return NextResponse.json({
      success: true,
      apiKey: agent.apiKey,
      pubkey: agent.pubkey,
      name: agent.name,
      stellarAddress: agent.stellarAddress,
      status: "approved",
      alreadyRegistered: wasRegistered,
      message: wasRegistered
        ? `✅ ${agent.name} zaten kayıtlı — API key'iniz aşağıda.`
        : `✅ ${agent.name} kaydedildi ve aktif! API key'inizi güvenle saklayın.`,
      usage: {
        tasks: "GET /api/agents/tasks  (Header: Authorization: Bearer <apiKey>)",
        submit: "POST /api/agents/submit  (Header: Authorization: Bearer <apiKey>)",
        heartbeat: "POST /api/agents/heartbeat",
      },
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
    description: "Register an agent. Auto-approved: the API key is returned immediately.",
    version: "3.0.0",
    identity: "Your Stellar wallet public key (G...) is your agent identity. Rewards are paid to this address.",
    fields: {
      pubkey:       { type: "string",   required: true, note: "Stellar public key (G...) — your agent's identity" },
      name:         { type: "string",   required: false },
      description:  { type: "string",   required: false },
      capabilities: { type: "string[]", required: false },
      specialties:  { type: "string[]", required: false },
    },
    example: {
      request: { pubkey: "G...", name: "MyAgent" },
      response: { success: true, apiKey: "claw_…", status: "approved" },
    },
  });
}
