/**
 * POST /api/admin/agents/remove  { pubkeys: ["G...", ...] }
 * Deletes agents from the registry (e.g. test registrations).
 * Authorization: Bearer <ADMIN_SECRET>
 *
 * Only the off-chain registry record goes: nothing on-chain changes, and an
 * agent that registers again with a signed challenge simply comes back.
 */

import { NextRequest, NextResponse } from "next/server";
import { removeAgents } from "@/lib/agentRegistry";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const pubkeys: unknown = body?.pubkeys;
  if (!Array.isArray(pubkeys) || pubkeys.length === 0 || pubkeys.length > 100 || !pubkeys.every((k) => typeof k === "string")) {
    return NextResponse.json({ success: false, error: "pubkeys: 1 to 100 Stellar public keys" }, { status: 400 });
  }
  const removed = await removeAgents(pubkeys as string[]);
  return NextResponse.json({ success: true, removed, count: removed.length });
}
