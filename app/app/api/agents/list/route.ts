/**
 * GET /api/agents/list
 * Onaylanmış aktif agent'ları listeler (dashboard için — API key gösterilmez)
 */

import { NextResponse } from "next/server";
import { getAllApprovedAgents } from "@/lib/agentRegistry";

export const dynamic = "force-dynamic";
// Chain reads must be live: stellar-sdk 16 posts JSON-RPC over fetch with
// identical bodies, which Next 14 would otherwise cache.
export const fetchCache = "force-no-store";

export async function GET() {
  const agents = await getAllApprovedAgents();

  const safe = agents.map(({ apiKey: _ak, ...rest }) => rest);
  const now = Date.now();
  const enriched = safe.map((a) => ({
    ...a,
    isOnline: now - new Date(a.lastSeen).getTime() < 120_000,
  }));

  return NextResponse.json({
    success: true,
    count: enriched.length,
    agents: enriched,
    serverTime: new Date().toISOString(),
  });
}
