/**
 * GET /api/agents/list
 * Onaylanmış aktif agent'ları listeler (dashboard için — API key gösterilmez)
 */

import { NextResponse } from "next/server";
import { getAgent, getAllApprovedAgents } from "@/lib/agentRegistry";

export const dynamic = "force-dynamic";
// Chain reads must be live: stellar-sdk 16 posts JSON-RPC over fetch with
// identical bodies, which Next 14 would otherwise cache.
export const fetchCache = "force-no-store";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 200, 1), 200);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
  const pubkey = url.searchParams.get("pubkey");
  const one = pubkey ? await getAgent(pubkey) : null;
  const agents = pubkey ? (one && !one.isBanned && one.approvalStatus === "approved" ? [one] : []) : await getAllApprovedAgents();

  const safe = agents.slice(offset, offset + limit).map(({ apiKey: _ak, ...rest }) => rest);
  const now = Date.now();
  const enriched = safe.map((a) => ({
    ...a,
    isOnline: now - new Date(a.lastSeen).getTime() < 120_000,
  }));

  return NextResponse.json(
    {
      success: true,
      count: agents.length,
      limit,
      offset,
      agents: enriched,
      serverTime: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } }
  );
}
