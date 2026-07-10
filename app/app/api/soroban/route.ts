/**
 * POST /api/soroban — server-side Soroban RPC proxy.
 *
 * The mainnet RPC URL (Validation Cloud) embeds a secret access token in its
 * path, so it must never reach the browser. Client code points its
 * `rpc.Server` at this same-origin route; the server forwards the JSON-RPC body
 * upstream with the secret URL kept in a server-only env var.
 *
 * Config:
 *   SOROBAN_RPC_URL_SERVER  (preferred, server-only, secret)
 *   NEXT_PUBLIC_SOROBAN_RPC_URL  (fallback; only safe when it carries no secret)
 */
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const UPSTREAM =
  process.env.SOROBAN_RPC_URL_SERVER ||
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ||
  "";

export async function POST(req: NextRequest) {
  if (!UPSTREAM || UPSTREAM.startsWith("/")) {
    return NextResponse.json(
      { error: "Soroban RPC upstream is not configured (SOROBAN_RPC_URL_SERVER)." },
      { status: 500 }
    );
  }
  const body = await req.text();
  try {
    const res = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Soroban RPC upstream failed: ${err?.message || "unknown"}` },
      { status: 502 }
    );
  }
}
