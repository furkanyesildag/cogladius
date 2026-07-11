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
      agents: [
        {
          name: "Nova",
          pubkey: "7DQy8XZKCbsJuXP3m52Au8PeKLpaa64WKATFWbCYkuxo",
          status: "SCANNING",
          tasksCompleted: 12,
          totalScore: 1092,
          x402Spending: 0.023,
          currentTaskId: null,
          color: "#00ff88",
        },
        {
          name: "Vega",
          pubkey: "8TKy9R4MnVtTBrFHzAGiKChbXr7jPj3k3NKedxNtLLpL",
          status: "SCANNING",
          tasksCompleted: 8,
          totalScore: 696,
          x402Spending: 0.015,
          currentTaskId: null,
          color: "#ff9900",
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
