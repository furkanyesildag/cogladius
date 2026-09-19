import type { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";

/** True when the request carries `Authorization: Bearer <ADMIN_SECRET>`. */
export function isAdminRequest(req: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}
