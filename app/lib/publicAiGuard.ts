/**
 * Spend guard for the public AI routes (dashboard demo, judge, court, project chat).
 *
 * These routes need no login, and every call pays an LLM provider, so without a
 * cap anyone can run the balance down. Three limits, checked before any model
 * call:
 *
 *   - body size: PUBLIC_AI_MAX_BODY_BYTES (default 32 KB)
 *   - per IP: PUBLIC_AI_PER_IP_PER_HOUR across all these routes (default 20)
 *   - all callers together: PUBLIC_AI_DAILY_CAP per rolling day (default 400)
 *
 * Admin (Authorization: Bearer <ADMIN_SECRET>) skips the IP and daily limits.
 * Agent paths (arena, league, agents/submit) have their own limits and do not use this.
 */
import { NextRequest, NextResponse } from "next/server";
import { kvIncr } from "./kv";
import { isAdminRequest } from "./adminAuth";

const HOUR = 3600;
const DAY = 86400;

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim() || "unknown";
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

function refuse(status: number, code: string, error: string, retryAfter?: number) {
  return NextResponse.json(
    { success: false, code, error, ...(retryAfter ? { retryAfter } : {}) },
    { status, headers: retryAfter ? { "Retry-After": String(retryAfter) } : undefined }
  );
}

/**
 * Returns a response to send instead of running the model, or null to go ahead.
 * Fails closed: if the counters cannot be read, the call is refused.
 */
export async function guardPublicAi(req: NextRequest): Promise<NextResponse | null> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > envInt("PUBLIC_AI_MAX_BODY_BYTES", 32 * 1024)) {
    return refuse(413, "too_large", "Request body is too large.");
  }
  if (isAdminRequest(req)) return null;

  try {
    const perIp = await kvIncr(`ai:public:ip:${clientIp(req)}`, HOUR);
    if (perIp > envInt("PUBLIC_AI_PER_IP_PER_HOUR", 20)) {
      return refuse(429, "rate_limited", "Too many requests from this address. Try again later.", HOUR);
    }
    const today = await kvIncr("ai:public:day", DAY);
    if (today > envInt("PUBLIC_AI_DAILY_CAP", 400)) {
      return refuse(429, "busy", "This demo is busy right now. Try again later.", HOUR);
    }
  } catch {
    return refuse(503, "unavailable", "Try again in a minute.", 60);
  }
  return null;
}
