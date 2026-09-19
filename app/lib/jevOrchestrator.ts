/**
 * NEXUS project breakdown via Jev: first in the chain Jev -> LLM -> keywords.
 *
 * One Jev call asks, per specialty, two typed questions in parallel:
 *   need_<s>  (noul)  does the project need this specialty?  -> calibrated p
 *   share_<s> (score) how big is its share of the work?       -> weighted level
 * Specialties with p >= NEED_THRESHOLD are kept (at least 2, at most 5, by p),
 * and their shares are normalised to 100% by the caller's normalizeBreakdown.
 *
 * `reasoning` is rendered in the UI, so it must never name the model provider
 * (branding rule): it only says "AI".
 */

import type { AgentSpecialty, OrchestratorBreakdown } from "./types";
import { SPECIALTY_META } from "./specialtyMeta";
import { askJev, isJevConfigured, type JevQuestion } from "./jev";

const NEED_THRESHOLD = 0.5;
const MIN_SPECIALTIES = 2;
const MAX_SPECIALTIES = 5;

// Score levels (index = Jev legend key) and the workload % each one stands for.
const SHARE_LEVELS = [
  "A minor part of the work (about 10%)",
  "A small part (about 20%)",
  "A moderate part (about 30%)",
  "A large part (about 45%)",
  "The dominant part (60% or more)",
];
const SHARE_PCT = [10, 20, 30, 45, 65];

/** Map Jev's probability-weighted level (may fall between levels) to a %. */
function levelToPct(score: number): number {
  const s = Math.max(0, Math.min(SHARE_PCT.length - 1, score));
  const lo = Math.floor(s);
  const hi = Math.min(lo + 1, SHARE_PCT.length - 1);
  return SHARE_PCT[lo] + (SHARE_PCT[hi] - SHARE_PCT[lo]) * (s - lo);
}

export async function jevAnalyze(
  description: string,
  normalize: (items: OrchestratorBreakdown[], totalBudget: number) => void,
  totalBudget: number
): Promise<OrchestratorBreakdown[] | null> {
  if (!isJevConfigured()) return null;

  const specialties = Object.keys(SPECIALTY_META) as AgentSpecialty[];
  const questions: Record<string, JevQuestion> = {};
  for (const s of specialties) {
    const meta = SPECIALTY_META[s];
    const scope = `${meta.label} (${meta.keywords.slice(0, 6).join(", ")})`;
    questions[`need_${s}`] = {
      type: "noul",
      instructions: `Does delivering this project require dedicated ${scope} work?`,
    };
    questions[`share_${s}`] = {
      type: "score",
      instructions: `If this project needs ${scope} work, how large is that share of the total effort?`,
      criteria: SHARE_LEVELS,
    };
  }

  const answers = await askJev({ project_brief: description }, questions);
  if (!answers) return null;

  const scored = specialties
    .map((s) => {
      const need = answers[`need_${s}`];
      const share = answers[`share_${s}`];
      return {
        specialty: s,
        p: need?.type === "noul" ? need.noul : 0,
        pct: share?.type === "score" ? levelToPct(share.score) : SHARE_PCT[1],
      };
    })
    .sort((a, b) => b.p - a.p);

  let picked = scored.filter((x) => x.p >= NEED_THRESHOLD).slice(0, MAX_SPECIALTIES);
  if (picked.length < MIN_SPECIALTIES) picked = scored.slice(0, MIN_SPECIALTIES);
  // Nothing clears even a weak bar: the brief is too vague for Jev to staff.
  if (picked[0].p < 0.2) return null;

  const breakdown: OrchestratorBreakdown[] = picked.map((x) => ({
    specialty: x.specialty,
    workloadPct: x.pct,
    budgetUsdc: 0,
    reasoning: "",
    agents: [],
  }));

  normalize(breakdown, totalBudget);
  breakdown.forEach((b, i) => {
    b.reasoning = `AI: ${Math.round(picked[i].p * 100)}% likely needed · ${b.workloadPct}% of the work`;
  });
  return breakdown;
}
