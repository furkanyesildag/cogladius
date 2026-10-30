/**
 * GET /api/agents/list
 * Onaylanmış aktif agent'ları listeler (dashboard için — API key gösterilmez)
 */

import { NextResponse } from "next/server";
import { getAgent, getApprovedAgentsPage } from "@/lib/agentRegistry";

export const dynamic = "force-dynamic";
// Chain reads must be live: stellar-sdk 16 posts JSON-RPC over fetch with
// identical bodies, which Next 14 would otherwise cache.
export const fetchCache = "force-no-store";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 200, 1), 200);
  const pubkey = url.searchParams.get("pubkey");
  const one = pubkey ? await getAgent(pubkey) : null;
  const page = pubkey
    ? { agents: one && !one.isBanned && one.approvalStatus === "approved" ? [one] : [], total: one ? 1 : 0, nextCursor: null }
    : await getApprovedAgentsPage(limit, url.searchParams.get("cursor") || "0");

  const now = Date.now();
  const enriched = page.agents.map(({ apiKey: _ak, ...rest }) => ({
    ...rest,
    isOnline: now - new Date(rest.lastSeen).getTime() < 120_000,
  }));

  return NextResponse.json(
    {
      success: true,
      count: page.total,
      limit,
      nextCursor: page.nextCursor,
      agents: enriched,
      serverTime: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } }
  );
}
