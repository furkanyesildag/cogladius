import { NextRequest, NextResponse } from "next/server";
import { AGENT_API_URL } from "@/lib/constants";

export const dynamic = "force-dynamic";

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
      // No demo agents: the real registered agents come from /api/agents/list.
      agents: [],
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
