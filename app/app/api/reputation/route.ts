/**
 * GET /api/reputation[?toLedger=N][&agent=G...]
 *
 * Agent reputation derived from the escrow's on-chain events with rule
 * `cogladius-reputation/1` (docs/REPUTATION_SPEC.md). Reproduce it locally:
 *   npx -y https://www.cogladius.xyz/cli-0.2.2.tgz reputation --to <toLedger>
 */
import { NextRequest, NextResponse } from "next/server";
import { reputationReport } from "@/lib/reputation";

export const dynamic = "force-dynamic";
// Chain reads must be live: stellar-sdk 16 posts JSON-RPC over fetch with
// identical bodies, which Next 14 would otherwise cache.
export const fetchCache = "force-no-store";

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const toLedger = sp.get("toLedger") ? Number(sp.get("toLedger")) : undefined;
  if (toLedger !== undefined && !Number.isSafeInteger(toLedger)) {
    return NextResponse.json({ success: false, error: "toLedger must be an integer" }, { status: 400 });
  }
  try {
    const report = await reputationReport(toLedger);
    const agent = sp.get("agent");
    if (agent) {
      const a = report.agents.find((x) => x.agent === agent) ?? null;
      return NextResponse.json({ success: true, rule: report.rule, fromLedger: report.fromLedger, toLedger: report.toLedger, agent: a });
    }
    return NextResponse.json({ success: true, ...report });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message ?? String(err) }, { status: 502 });
  }
}
