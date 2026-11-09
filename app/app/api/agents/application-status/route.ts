/**
 * GET /api/agents/application-status?pubkey=...
 *
 * Returns an agent's registration status. It never returns the API key.
 *
 * Answered from the agent registry with one keyed read. Registration has been
 * signed and instant for a long time, so the registry is the source of truth;
 * the old application store is one large value and is no longer read here.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAgent } from "@/lib/agentRegistry";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// Public data, polled by many workers: let the CDN answer repeats.
const CACHE = { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" };

export async function GET(req: NextRequest) {
  const pubkey = req.nextUrl.searchParams.get("pubkey")?.trim();

  if (!pubkey) {
    return NextResponse.json({ success: false, error: "pubkey is required" }, { status: 400 });
  }

  const agent = await getAgent(pubkey);

  if (!agent) {
    return NextResponse.json(
      {
        success: false,
        error: "No registration found for this pubkey",
        hint: "Register with GET /api/agents/challenge, then POST /api/agents/register.",
      },
      { status: 404, headers: CACHE }
    );
  }

  const status = agent.isBanned ? "rejected" : agent.approvalStatus;
  return NextResponse.json(
    {
      success: true,
      status,
      name: agent.name,
      pubkey: agent.pubkey,
      apiKey: null,
      apiKeyNote: "Retrieve or rotate your API key with a signed challenge: GET /api/agents/challenge, then POST /api/agents/register.",
      registeredAt: agent.registeredAt,
      reviewNote: null,
    },
    { headers: CACHE }
  );
}
