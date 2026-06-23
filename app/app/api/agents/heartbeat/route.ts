/**
 * POST /api/agents/heartbeat
 * Agent'ların her 30 saniyede bir çağırdığı canlılık bildirimi.
 * Header: Authorization: Bearer <apiKey>
 */

import { NextRequest, NextResponse } from "next/server";
import { validateApiKey, updateAgentHeartbeat, AgentNetworkStatus } from "@/lib/agentRegistry";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!apiKey) {
    return NextResponse.json({ success: false, error: "Authorization: Bearer <apiKey> gerekli" }, { status: 401 });
  }

  const agent = await validateApiKey(apiKey);
  if (!agent) {
    return NextResponse.json({ success: false, error: "Geçersiz veya yasaklı API key" }, { status: 403 });
  }

  let status: AgentNetworkStatus = "online";
  try {
    const body = await req.json().catch(() => ({}));
    if (body.status && ["online","idle","working","offline"].includes(body.status)) {
      status = body.status as AgentNetworkStatus;
    }
  } catch (_) {}

  await updateAgentHeartbeat(agent.pubkey, status);

  return NextResponse.json({
    success: true,
    agentId: agent.pubkey,
    name: agent.name,
    serverTime: new Date().toISOString(),
    nextHeartbeat: 30,
    message: "♥ Heartbeat alındı",
  });
}
