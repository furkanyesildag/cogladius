import { NextRequest, NextResponse } from "next/server";
import { AGENT_API_URL } from "@/lib/constants";

export const dynamic = "force-dynamic";
// Chain reads must be live: stellar-sdk 16 posts JSON-RPC over fetch with
// identical bodies, which Next 14 would otherwise cache.
export const fetchCache = "force-no-store";

/**
 * Legacy polling source (proxied from the optional agent process).
 *
 * Agents are never served from here: the only source of agents is the real
 * registry (/api/agents/list) plus on-chain reputation (/api/reputation). This
 * route used to return invented demo agents when the upstream was down; it now
 * returns empty lists instead of making anything up.
 */
export async function GET(_request: NextRequest) {
  const empty = {
    agents: [],
    judges: {
      TeknikHakem: "READY",
      KullanılabilirlikHakemi: "READY",
      KapsamHakemi: "READY",
    },
    feed: [],
    txLog: [],
    timestamp: Date.now(),
  };
  try {
    const res = await fetch(`${AGENT_API_URL}/api/state`, {
      next: { revalidate: 0 },
    });
    if (!res.ok) throw new Error("Agent API unavailable");
    const data = await res.json();
    return NextResponse.json({ ...empty, ...data, agents: [] });
  } catch (_) {
    return NextResponse.json(empty);
  }
}
