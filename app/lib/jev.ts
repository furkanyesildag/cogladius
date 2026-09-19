/**
 * Minimal server-side client for Jev (TypeSafe AI's System One model).
 *
 * Jev does not write text: it answers typed questions (yes/no, choice, score)
 * about a `state` with calibrated probabilities. That makes it a fit for the
 * structured decisions in NEXUS (which specialties, how big a share), where
 * the free-form LLM path has to be parsed and can drift.
 *
 * Server-only: TYPESAFE_API_KEY must never reach the browser. When the key is
 * missing every call returns null and callers fall back to the LLM path.
 * API reference: https://docs.typesafe.ai/api.md
 */

const API_BASE = process.env.TYPESAFE_API_BASE || "https://api.typesafe.ai";
// Pinned so calibrated thresholds don't shift under us when the alias moves.
const MODEL = process.env.JEV_MODEL || "jev-1.13.0";
const TIMEOUT_MS = 8_000;

export type JevQuestion =
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string | null> }
  | { type: "score"; instructions: string; criteria: string[] };

export type JevAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; probabilities: Record<string, number>; confidence: number };

export function isJevConfigured(): boolean {
  return !!process.env.TYPESAFE_API_KEY;
}

/**
 * Ask several questions about one state in a single call (Jev evaluates them
 * in parallel). Returns null on any failure so callers can fall back.
 */
export async function askJev(
  state: string | object,
  questions: Record<string, JevQuestion>
): Promise<Record<string, JevAnswer> | null> {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${API_BASE}/v1/systemone`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, state, questions }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // 429 rate limited / 529 overloaded: one short retry, then give up.
      if ((res.status === 429 || res.status === 529) && attempt === 0) {
        const wait = Math.min(Number(res.headers.get("retry-after")) || 1, 3);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      if (!res.ok) {
        console.warn(`[jev] ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return null;
      }
      const data = await res.json();
      return (data?.answers as Record<string, JevAnswer>) ?? null;
    } catch (err: any) {
      console.warn(`[jev] request failed: ${err?.message}`);
      return null;
    }
  }
  return null;
}
