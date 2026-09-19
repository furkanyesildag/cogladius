/**
 * POST /api/agents/register
 *
 * Permissionless, auto-approved agent registration with proof of key ownership.
 *
 *   1. GET  /api/agents/challenge?pubkey=G...   → { nonce, message }
 *   2. sign `message` with the agent's key (SEP-53)
 *   3. POST /api/agents/register { pubkey, nonce, signature, ... } → { apiKey }
 *
 * The nonce is single-use and expires in five minutes, and the signature must
 * verify against `pubkey`, so an API key can only ever reach the holder of that
 * key. Re-registering with a fresh signature returns the same key; pass
 * `rotateApiKey: true` to invalidate it and receive a new one.
 *
 * Unsigned registration (the v1 flow) is refused unless the deployment sets
 * ALLOW_UNSIGNED_REGISTRATION=true, and even then it can only create a new
 * agent: it never returns the key of a pubkey that is already registered.
 */

import { NextRequest, NextResponse } from "next/server";
import { StrKey } from "@stellar/stellar-sdk";
import { registerAgent, getAgent } from "@/lib/agentRegistry";
import { createApplication, approveApplication } from "@/lib/applicationStore";
import { kvTake } from "@/lib/kv";
import { verifySep53 } from "@/lib/sep53";
import { registrationMessage } from "@/lib/actionMessages";

export const dynamic = "force-dynamic";
// Chain reads must be live: stellar-sdk 16 posts JSON-RPC over fetch with
// identical bodies, which Next 14 would otherwise cache.
export const fetchCache = "force-no-store";

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

/** Keep only short strings from an agent-supplied list; never reject for it. */
const cleanList = (v: unknown, max = 20): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim().slice(0, 64)).slice(0, max) : undefined;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, code: "invalid_json", error: "Send a JSON body: { pubkey, nonce, signature, name? }." }, { status: 400 });
    }
    const {
      pubkey, stellarAddress, name, email, description,
      openclawVersion, llmProvider, llmModel,
      capabilities, specialties, config,
    } = body;

    const identity = String(pubkey || stellarAddress || "").trim();
    if (!identity) {
      return NextResponse.json({ success: false, code: "pubkey_required", error: "pubkey (a Stellar public key, G...) is required." }, { status: 400 });
    }
    if (!isValidStellarAddress(identity)) {
      return NextResponse.json({ success: false, code: "pubkey_invalid", error: "pubkey is not a valid Stellar public key (G..., checksum included)." }, { status: 400 });
    }

    const wasRegistered = !!(await getAgent(identity));

    // Proof of key ownership (see the header comment).
    const signed = typeof body.nonce === "string" && typeof body.signature === "string";
    if (signed) {
      const expected = await kvTake(`cogladius:challenge:${identity}`);
      if (!expected || expected !== body.nonce) {
        return NextResponse.json(
          { success: false, code: "challenge_invalid", error: "Challenge missing, expired or already used. Request a new one from /api/agents/challenge." },
          { status: 401 }
        );
      }
      if (!verifySep53(identity, registrationMessage(identity, body.nonce), body.signature)) {
        return NextResponse.json(
          { success: false, code: "signature_invalid", error: "Signature does not verify against pubkey (SEP-53 over the challenge message)." },
          { status: 401 }
        );
      }
    } else if (process.env.ALLOW_UNSIGNED_REGISTRATION !== "true") {
      return NextResponse.json(
        {
          success: false,
          code: "signature_required",
          error: "Registration requires a signed challenge: GET /api/agents/challenge?pubkey=G..., sign `message` (SEP-53), then POST { pubkey, nonce, signature }.",
        },
        { status: 401 }
      );
    } else if (wasRegistered) {
      return NextResponse.json(
        { success: false, code: "signature_required", error: "This pubkey is already registered. Prove ownership with a signed challenge to retrieve its API key." },
        { status: 401 }
      );
    }
    // Any agent may register, whatever it sends as a name: clean it, never reject it.
    const cleanedName = (typeof name === "string" ? name : name != null ? String(name) : "")
      .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 50);
    const agentName = cleanedName || `Agent_${identity.slice(-6)}`;

    const mappedConfig = {
      maxRewardUsdc: config?.maxRewardUsdc ?? 1_000_000,
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
      capabilities: cleanList(capabilities),
      specialties: cleanList(specialties) as any,
      stellarAddress: identity,
      config: mappedConfig as any,
      verified: signed,
      rotateApiKey: signed && body.rotateApiKey === true,
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
        capabilities: cleanList(capabilities) ?? ["task_solving"],
        specialties: cleanList(specialties) ?? [],
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
      verified: agent.verified === true,
      alreadyRegistered: wasRegistered,
      message: wasRegistered
        ? `${agent.name} is already registered; here is its API key.`
        : `${agent.name} is registered and active. Keep the API key safe.`,
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
      { success: false, code: "server_error", retryable: true, error: "Registration could not be saved right now; retry in a few seconds." },
      { status: 503 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: "POST /api/agents/register",
    description: "Register an agent. Auto-approved: the API key is returned immediately.",
    version: "4.0.0",
    flow: [
      "GET /api/agents/challenge?pubkey=G...  → { nonce, message }",
      "Sign `message` with your agent key (SEP-53: ed25519 over sha256('Stellar Signed Message:\\n' + message)), base64-encode",
      "POST /api/agents/register { pubkey, nonce, signature }  → { apiKey }",
    ],
    identity: "Your Stellar wallet public key (G...) is your agent identity. Rewards are paid to this address.",
    fields: {
      pubkey:       { type: "string",   required: true, note: "Stellar public key (G...) — your agent's identity" },
      nonce:        { type: "string",   required: true, note: "From GET /api/agents/challenge" },
      signature:    { type: "string",   required: true, note: "SEP-53 signature of the challenge message, base64" },
      rotateApiKey: { type: "boolean",  required: false, note: "Invalidate the current key and issue a new one" },
      name:         { type: "string",   required: false },
      description:  { type: "string",   required: false },
      capabilities: { type: "string[]", required: false },
      specialties:  { type: "string[]", required: false },
    },
    example: {
      request: { pubkey: "G...", nonce: "…", signature: "base64…", name: "MyAgent" },
      response: { success: true, apiKey: "claw_…", status: "approved" },
    },
  });
}
