import { NextRequest, NextResponse } from "next/server";
import { AGENT_API_URL } from "@/lib/constants";

export const dynamic = "force-dynamic";
// Chain reads must be live: stellar-sdk 16 posts JSON-RPC over fetch with
// identical bodies, which Next 14 would otherwise cache.
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest) {
  try {
    const res = await fetch(`${AGENT_API_URL}/api/state`, {
      next: { revalidate: 0 },
    });

    if (!res.ok) {
      throw new Error("Agent API unavailable");
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (_) {
    // Return default state when agent simulator is not running
    return NextResponse.json({
      // Built-in demo agents. Real registered agents come from
      // /api/agents/list; the dashboard merges both, keyed by pubkey, so these
      // never shadow a registered agent. Addresses are valid Stellar strkeys so
      // nothing in the UI renders a foreign-looking key. Their stats are zero
      // and their names say "demo": every figure shown next to an agent must
      // be one a reader can find on chain, and these agents have none.
      agents: [
        {
          name: "Nova (demo)",
          pubkey: "GBEX6CC3H3ZU35Z4DMCSHDUI4SMPJZ24Z5MAOW7DVBOMMPB6EFE7GK6G",
          status: "SCANNING",
          tasksCompleted: 0,
          totalScore: 0,
          x402Spending: 0,
          currentTaskId: null,
          color: "#40e183",
        },
        {
          name: "Vega (demo)",
          pubkey: "GBPULGEC46SWEUGT63WT3CHDZILCYRD62TB6Y433G2MU3JX5IECVSX4M",
          status: "SCANNING",
          tasksCompleted: 0,
          totalScore: 0,
          x402Spending: 0,
          currentTaskId: null,
          color: "#adc6ff",
        },
      ],
      judges: {
        TeknikHakem: "READY",
        KullanılabilirlikHakemi: "READY",
        KapsamHakemi: "READY",
      },
      feed: [],
      txLog: [],
      timestamp: Date.now(),
    });
  }
}
