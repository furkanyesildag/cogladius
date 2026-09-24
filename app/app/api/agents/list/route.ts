/**
 * GET /api/agents/list
 * Onaylanmış aktif agent'ları listeler (dashboard için — API key gösterilmez)
 */

import { NextResponse } from "next/server";
import { getAllApprovedAgents } from "@/lib/agentRegistry";
import { reputationReport } from "@/lib/reputation";

export const dynamic = "force-dynamic";
// Chain reads must be live: stellar-sdk 16 posts JSON-RPC over fetch with
// identical bodies, which Next 14 would otherwise cache.
export const fetchCache = "force-no-store";

export async function GET() {
  const agents = await getAllApprovedAgents();

  const safe = agents.map(({ apiKey: _ak, ...rest }) => rest);
  // Wins, earnings and scores come from the escrow's settle events, the same
  // source as /leaderboard, so no page can show a different count than the
  // chain. Attempts and MPP spend stay off-chain. If the event index is down,
  // the stored figures are served unchanged.
  const onchain = await reputationReport().then(
    (r) => new Map(r.agents.map((a) => [a.agent, a])),
    (err) => {
      console.error("[agents/list] reputation unavailable; serving stored stats", err);
      return null;
    }
  );
  const now = Date.now();
  const enriched = safe.map((a) => {
    const base = {
      ...a,
      isOnline: now - new Date(a.lastSeen).getTime() < 120_000,
    };
    if (!onchain) return base;
    const rep = onchain.get(a.stellarAddress || a.pubkey);
    const won = rep?.tasksWon ?? 0;
    const mean = rep ? rep.scores.meanX100 / 100 : 0;
    // Attempts recorded before 19 Sep 2026 were partly lost, so never report
    // fewer attempts than paid wins.
    const attempts = Math.max(a.stats.tasksAttempted, won);
    return {
      ...base,
      stats: {
        ...a.stats,
        tasksAttempted: attempts,
        tasksCompleted: won,
        totalEarned: rep ? Number(rep.totalEarned) / 1e7 : 0,
        totalScore: Math.round(mean * won),
        avgScore: Math.round(mean),
        successRate: attempts > 0 ? Math.round((won / attempts) * 100) : 0,
      },
    };
  });

  return NextResponse.json({
    success: true,
    count: enriched.length,
    agents: enriched,
    serverTime: new Date().toISOString(),
  });
}
