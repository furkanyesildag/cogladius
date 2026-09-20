/**
 * NEXUS project breakdown: an LLM writes the plan, a typed-decision model audits it.
 *
 * Neither model decides alone, because neither is good at the other's job. The
 * LLM can write a staffing plan and explain it, but its numbers drift and it
 * has no calibrated sense of "is this specialty really needed". The typed model
 * answers exactly that, with a probability, but it cannot write a plan at all:
 * it only answers questions it is given.
 *
 * So the flow is `llmAnalyze` -> `jevAudit` (see orchestrator.ts):
 *
 *   one call asks, per specialty, two typed questions evaluated in parallel
 *     need_<s>  (noul)   does the project require dedicated <s> work?  -> p
 *     share_<s> (score)  how large is that share of the effort?        -> level
 *
 *   then the audit applies three deterministic rules to the LLM's plan
 *     drop  a proposed specialty whose p < DROP_BELOW  (the LLM invented it)
 *     add   a missing specialty whose p >= ADD_ABOVE   (the LLM forgot it)
 *     blend the workload split half from each model, then normalise to 100%
 *
 * `jevAnalyze` remains for the case where the LLM itself is down: a typed-only
 * breakdown is still better than the keyword fallback.
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

/** Audit thresholds. Wide apart on purpose: only act on a clear disagreement. */
const DROP_BELOW = 0.35;
const ADD_ABOVE = 0.75;
/** How much of the final workload split comes from the typed model. */
const BLEND = 0.5;

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

type Sweep = { p: Record<string, number>; pct: Record<string, number> };

/**
 * One call, two typed questions per specialty. Returns null when the model is
 * not configured or does not answer, so every caller can fall back.
 */
async function sweepSpecialties(description: string): Promise<Sweep | null> {
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

  const p: Record<string, number> = {};
  const pct: Record<string, number> = {};
  for (const s of specialties) {
    const need = answers[`need_${s}`];
    const share = answers[`share_${s}`];
    p[s] = need?.type === "noul" ? need.noul : 0;
    pct[s] = share?.type === "score" ? levelToPct(share.score) : SHARE_PCT[1];
  }
  return { p, pct };
}

const pctText = (x: number) => `%${Math.round(x * 100)}`;

/**
 * Audit an LLM plan: prune what the project does not need, add what the plan
 * missed, blend the workload split. Returns null if the typed model is
 * unavailable, in which case the caller keeps the LLM plan as it is.
 */
export async function jevAudit(
  description: string,
  llm: OrchestratorBreakdown[],
  normalize: (items: OrchestratorBreakdown[], totalBudget: number) => void,
  totalBudget: number
): Promise<{ breakdown: OrchestratorBreakdown[]; dropped: string[]; added: string[] } | null> {
  if (llm.length === 0) return null;
  const sweep = await sweepSpecialties(description);
  if (!sweep) return null;

  const ranked = llm
    .map((item) => ({ item, p: sweep.p[item.specialty] ?? 0 }))
    .sort((a, b) => b.p - a.p);

  // Keep what clears the bar, but never staff a project with fewer than two
  // specialties just because the typed model was strict.
  let kept = ranked.filter((x) => x.p >= DROP_BELOW);
  if (kept.length < MIN_SPECIALTIES) kept = ranked.slice(0, MIN_SPECIALTIES);
  const dropped = ranked.filter((x) => !kept.includes(x)).map((x) => x.item.specialty);

  const present = new Set(kept.map((k) => k.item.specialty));
  const added = (Object.keys(sweep.p) as AgentSpecialty[])
    .filter((s) => !present.has(s) && sweep.p[s] >= ADD_ABOVE)
    .sort((a, b) => sweep.p[b] - sweep.p[a])
    .slice(0, Math.max(0, MAX_SPECIALTIES - kept.length));

  const breakdown: OrchestratorBreakdown[] = [
    ...kept.map(({ item, p }) => ({
      ...item,
      workloadPct: Math.max(1, Math.round((1 - BLEND) * item.workloadPct + BLEND * sweep.pct[item.specialty])),
      reasoning: `${item.reasoning} · AI kontrolü: ${pctText(p)} gerekli`,
    })),
    ...added.map((s) => ({
      specialty: s,
      workloadPct: Math.max(1, Math.round(sweep.pct[s])),
      budgetUsdc: 0,
      reasoning: `Planda yoktu, AI kontrolü ekledi: ${pctText(sweep.p[s])} gerekli`,
      agents: [],
    })),
  ];

  normalize(breakdown, totalBudget);
  return { breakdown, dropped, added };
}

/**
 * Typed-only breakdown, used when the LLM is unavailable: the specialties whose
 * probability clears NEED_THRESHOLD, at least two and at most five, by p.
 */
export async function jevAnalyze(
  description: string,
  normalize: (items: OrchestratorBreakdown[], totalBudget: number) => void,
  totalBudget: number
): Promise<OrchestratorBreakdown[] | null> {
  const sweep = await sweepSpecialties(description);
  if (!sweep) return null;

  const scored = (Object.keys(sweep.p) as AgentSpecialty[])
    .map((s) => ({ specialty: s, p: sweep.p[s], pct: sweep.pct[s] }))
    .sort((a, b) => b.p - a.p);

  let picked = scored.filter((x) => x.p >= NEED_THRESHOLD).slice(0, MAX_SPECIALTIES);
  if (picked.length < MIN_SPECIALTIES) picked = scored.slice(0, MIN_SPECIALTIES);
  // Nothing clears even a weak bar: the brief is too vague to staff.
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
    b.reasoning = `AI: ${pctText(picked[i].p)} olasılıkla gerekli · işin %${b.workloadPct}'i`;
  });
  return breakdown;
}
