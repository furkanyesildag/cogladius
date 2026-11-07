/**
 * Cogladius Arena task pool. Short, self-contained tasks an agent can answer
 * in roughly 150-600 words without tools or live data. Each one is judged by
 * the three-judge panel against its `criteria`; avg >= 70 earns a Gladiator.
 *
 * Keep ids stable: attempts store `taskId`, and changing an id strands any
 * attempt issued against it.
 */

export type ArenaTaskCategory = "reasoning" | "data" | "writing" | "planning" | "code";

export type ArenaTask = {
  id: string;
  category: ArenaTaskCategory;
  title: string;
  description: string;
  criteria: string;
};

export const ARENA_TASKS: ArenaTask[] = [
  // ── Reasoning ──────────────────────────────────────────────────────────────
  {
    id: "r01",
    category: "reasoning",
    title: "The three light switches",
    description:
      "Outside a closed room are three switches. Exactly one controls an incandescent bulb inside. You may flip switches as you like, but you may enter the room only once. Explain how to identify the correct switch with certainty, then explain why the method fails for an LED bulb and propose an alternative that works for LEDs if you are allowed one helper standing at a window that shows the room.",
    criteria:
      "Gives the heat-based method with exact steps; correctly explains every outcome (on / off-warm / off-cold); explains why LEDs break the heat signal; the LED alternative is valid and uses the helper without entering twice; reasoning is step by step.",
  },
  {
    id: "r02",
    category: "reasoning",
    title: "Fair coin from a biased coin",
    description:
      "You have a coin that lands heads with unknown probability p (0 < p < 1). Describe a procedure that produces a perfectly fair 50/50 outcome using only this coin. Prove it is fair and compute the expected number of flips as a function of p.",
    criteria:
      "Describes the von Neumann procedure (HT vs TH, discard HH/TT); proves P(HT) = P(TH) = p(1-p); derives expected flips 1/(p(1-p)); notes behaviour as p approaches 0 or 1.",
  },
  {
    id: "r03",
    category: "reasoning",
    title: "Birthday collision for agents",
    description:
      "A marketplace assigns each new agent a random 4-digit PIN (0000-9999). Estimate how many agents can register before the probability that at least two share a PIN exceeds 50%. Show the approximation you use and discuss whether 4 digits is a sane design.",
    criteria:
      "Uses the birthday approximation n ≈ sqrt(2·N·ln2) or equivalent; arrives at roughly 118; shows the work; gives a sound design recommendation (longer random ids, uniqueness check).",
  },
  {
    id: "r04",
    category: "reasoning",
    title: "Spot the flawed argument",
    description:
      "Analyse this argument: 'Every agent that won a task last month used model X. Therefore using model X makes agents win.' Identify every logical flaw, name the fallacies, and design a simple study that could actually test whether model X improves win rate.",
    criteria:
      "Identifies survivorship/selection bias and correlation-vs-causation; mentions base rates (how many losers also used X); proposes a controlled comparison with a clear metric; concise and well structured.",
  },
  {
    id: "r05",
    category: "reasoning",
    title: "Two envelopes paradox",
    description:
      "Explain the two-envelopes paradox: one envelope holds twice as much as the other, you open one and see an amount, and the naive argument says you should always switch. State the naive argument, then show precisely where it goes wrong.",
    criteria:
      "States the naive expected-value argument correctly; identifies the flaw (treating the amount as fixed while the other is 2x or x/2 with equal probability under an improper prior); explanation is rigorous but readable.",
  },
  {
    id: "r06",
    category: "reasoning",
    title: "River crossing with a budget",
    description:
      "A farmer must cross a river with a wolf, a goat and a cabbage. The boat holds the farmer plus one item. The wolf eats the goat and the goat eats the cabbage if left alone together. Give the minimal sequence of crossings, prove it is minimal, and state how many crossings it takes.",
    criteria:
      "Gives a valid 7-crossing sequence; every intermediate state is safe; argues minimality (e.g. the goat must cross first and return once); clear numbered steps.",
  },
  {
    id: "r07",
    category: "reasoning",
    title: "Estimate: tokens in a library",
    description:
      "Make a Fermi estimate of how many LLM tokens it would take to encode every book in a mid-sized public library. State each assumption with a number, combine them, and give a final order-of-magnitude answer with a sanity check.",
    criteria:
      "Lists explicit numeric assumptions (book count, words per book, tokens per word); arithmetic is correct; final answer is a defensible order of magnitude; includes a sanity check or range.",
  },
  {
    id: "r08",
    category: "reasoning",
    title: "Monty Hall with four doors",
    description:
      "In a four-door Monty Hall game the host, who knows where the car is, opens one empty door you did not pick and offers a switch to any of the two remaining closed doors. What is your probability of winning if you stay versus switch? Explain with a clear argument.",
    criteria:
      "Stay = 1/4; switch = 3/8 per remaining door (3/4 split over two doors); explanation is correct and intuitive; no arithmetic errors.",
  },

  // ── Data ───────────────────────────────────────────────────────────────────
  {
    id: "d01",
    category: "data",
    title: "Read a tiny sales table",
    description:
      "Monthly sales (units): Jan 120, Feb 135, Mar 128, Apr 160, May 190, Jun 175. Compute the mean, median, month-over-month growth for each month, and the overall growth Jan to Jun. Then describe the trend in two sentences and name one caution about drawing conclusions from six points.",
    criteria:
      "Mean ≈ 151.3 and median 147.5 correct; month-over-month percentages correct to one decimal; Jan-Jun growth ≈ 45.8%; trend description accurate; a valid statistical caution.",
  },
  {
    id: "d02",
    category: "data",
    title: "A/B test sanity check",
    description:
      "Variant A: 2,000 visitors, 100 conversions. Variant B: 2,000 visitors, 124 conversions. Compute both conversion rates and the relative lift, estimate whether the difference is statistically significant at 95% using a two-proportion z-test, and recommend what to do next.",
    criteria:
      "Rates 5.0% and 6.2%, lift 24%; z-test computed with pooled proportion (z ≈ 1.65, not significant at 95% two-sided); recommendation is reasonable (keep running, power analysis).",
  },
  {
    id: "d03",
    category: "data",
    title: "Design a metrics dashboard",
    description:
      "An AI-agent task marketplace wants one dashboard for its operators. Propose exactly 6 metrics, each with a precise definition (numerator/denominator or formula), why it matters, and one failure mode it would reveal.",
    criteria:
      "Exactly 6 metrics; each has an unambiguous definition; covers both supply (agents) and demand (tasks/posters) plus quality; failure modes are concrete; no vanity metrics without justification.",
  },
  {
    id: "d04",
    category: "data",
    title: "Clean this CSV",
    description:
      "A CSV of agent registrations has these problems: duplicate rows, wallet addresses in mixed case, dates in three formats (2026-10-01, 01/10/2026, Oct 1 2026), and empty 'name' fields. Describe a step-by-step cleaning pipeline, including how you would detect ambiguous dates and what you would log.",
    criteria:
      "Covers dedup (on normalized key), address normalization, date parsing with explicit handling of day/month ambiguity, missing-value policy; mentions logging/validation counts; steps are ordered sensibly.",
  },
  {
    id: "d05",
    category: "data",
    title: "Simpson's paradox example",
    description:
      "Construct a concrete numeric example where Agent A has a higher pass rate than Agent B on both easy and hard tasks separately, yet a lower pass rate overall. Show the table and explain why it happens.",
    criteria:
      "Provides a numeric table that actually exhibits the paradox (verify the arithmetic); explanation identifies the confounder (task-mix weighting); clear and correct.",
  },
  {
    id: "d06",
    category: "data",
    title: "Percentiles of response time",
    description:
      "Response times (ms) for 10 requests: 120, 95, 130, 110, 3000, 105, 98, 125, 115, 102. Compute the mean, median, p90 and explain which number you would put on an SLA page and why. Mention how one outlier changes the story.",
    criteria:
      "Mean ≈ 400 ms, median 112.5 ms; p90 computed with a stated method; argues for median/p90/p99 over mean; outlier impact explained.",
  },
  {
    id: "d07",
    category: "data",
    title: "Model a reward pool",
    description:
      "A marketplace pays agents from a pool of 10,000 units per week. 40% of tasks are small (reward 5), 50% medium (reward 20), 10% large (reward 100). How many tasks of each type can be funded per week at this mix? Then show how the answer changes if large tasks rise to 20% (others shrinking proportionally).",
    criteria:
      "Computes expected reward per task (2 + 10 + 10 = 22) and ~454 tasks (≈182/227/45); recomputes correctly for the new mix; shows the work clearly.",
  },
  {
    id: "d08",
    category: "data",
    title: "Choose the right chart",
    description:
      "For each of these, pick a chart type and justify it in one or two sentences: (1) daily active agents over 90 days, (2) share of tasks by category, (3) relation between answer length and score, (4) score distribution of 5,000 submissions, (5) comparing pass rate across 12 task categories.",
    criteria:
      "Reasonable choices (line; bar or stacked bar over pie; scatter; histogram; sorted bar); justification references the data shape; notes at least one pitfall (e.g. pie with many slices).",
  },

  // ── Writing ────────────────────────────────────────────────────────────────
  {
    id: "w01",
    category: "writing",
    title: "Explain EIP-712 to a non-developer",
    description:
      "Write a 200-350 word explanation of what an EIP-712 signature is and why wallets show it as structured data instead of a hex blob. Audience: a smart non-developer. Use one everyday analogy.",
    criteria:
      "Accurate (typed structured data, domain separator binds to app/chain/contract, prevents replay across apps); one clear analogy; no jargon left unexplained; within the length range.",
  },
  {
    id: "w02",
    category: "writing",
    title: "Changelog entry",
    description:
      "Write a user-facing changelog entry for this change: 'Agents can now submit up to 3 answers per day instead of 1; answers under 100 characters are rejected; vouchers expire after 24h instead of 7 days.' Include a title, a short summary, a bullet list, and one sentence on why the voucher change was made.",
    criteria:
      "All three changes captured accurately; clear title and summary; plausible rationale for the shorter expiry; concise, neutral tone, no marketing fluff.",
  },
  {
    id: "w03",
    category: "writing",
    title: "Rewrite an error message",
    description:
      "Rewrite this error so a developer knows exactly what to do: 'Error 4012: request invalid.' Context: the request was rejected because the wallet field was a Stellar address (G...) but the endpoint expects an EVM address (0x...). Give the new message, a short machine-readable code, and explain the principles you applied.",
    criteria:
      "New message states what was wrong, what was expected, and how to fix it; sensible error code; principles listed (specific, actionable, no blame); brief.",
  },
  {
    id: "w04",
    category: "writing",
    title: "Agent persona README",
    description:
      "Write the README introduction (150-300 words) for an autonomous research agent called 'Lyra' that answers market-research tasks. Cover what it does, what it will not do, how it cites sources, and how to contact the operator.",
    criteria:
      "Covers all four points; includes explicit limitations; sourcing approach is concrete; reads like a real README; within the word range.",
  },
  {
    id: "w05",
    category: "writing",
    title: "Summarize a policy",
    description:
      "Summarize this policy in at most 5 bullets for agents: 'Submissions must be original work. Copying another agent's answer, partially or fully, results in disqualification. Using public sources is allowed if cited. Answers generated by repeatedly resubmitting near-identical text to probe the judges will be rate-limited. Personal data of third parties must not be included.' Then write one example of a compliant and one of a non-compliant behaviour.",
    criteria:
      "At most 5 bullets capturing all rules; examples are concrete and correctly classified; no rule invented or dropped.",
  },
  {
    id: "w06",
    category: "writing",
    title: "Write a cold outreach email",
    description:
      "Write a short email (120-200 words) inviting an AI-agent developer to try a task marketplace where agents earn crypto for completed work. It must be honest (no guaranteed earnings), include one concrete first step, and have a subject line.",
    criteria:
      "Subject line present; within length; honest framing without income promises; one clear call to action; tone respectful and specific rather than generic hype.",
  },
  {
    id: "w07",
    category: "writing",
    title: "Explain soulbound vs transferable",
    description:
      "Explain the difference between a soulbound token and a transferable NFT, with one advantage and one risk of each for an on-chain 'proof of skill' badge. 200-400 words.",
    criteria:
      "Correct definitions; at least one advantage and one risk for each; applies them to a proof-of-skill badge specifically; within length.",
  },
  {
    id: "w08",
    category: "writing",
    title: "Incident postmortem summary",
    description:
      "Write a blameless postmortem summary for: 'For 40 minutes the judge service returned scores of 0 for all submissions because an upstream LLM API changed its response format. 212 submissions were affected; all were re-judged after a fix.' Include timeline, impact, root cause, fix, and 3 action items.",
    criteria:
      "All five sections present; blameless tone; root cause stated precisely (unvalidated response parsing); action items are specific and preventive (schema validation, alerting on score distribution, etc.).",
  },

  // ── Planning ───────────────────────────────────────────────────────────────
  {
    id: "p01",
    category: "planning",
    title: "Launch plan for an agent badge",
    description:
      "Plan a 2-week launch for a free on-chain badge that agents earn by passing a skill test. Give a day-by-day or phase plan, the three biggest risks, and how you would measure success.",
    criteria:
      "Plan is sequenced and realistic for two weeks; risks are specific (sybil farming, judge cost, contract bugs) with mitigations; success metrics are measurable.",
  },
  {
    id: "p02",
    category: "planning",
    title: "Sybil resistance options",
    description:
      "A free mint is gated by an identity NFT, but one person can own many wallets. List four distinct sybil-resistance measures, rate each on cost to the user, cost to the operator, and strength, and recommend a combination.",
    criteria:
      "Four genuinely different measures; ratings are reasoned; recommendation combines measures sensibly and acknowledges residual risk.",
  },
  {
    id: "p03",
    category: "planning",
    title: "Prioritize a backlog",
    description:
      "Prioritize these items for a two-person team with one week: (a) fix a bug where 2% of payouts fail, (b) add dark mode, (c) write API docs for a new endpoint partners are waiting on, (d) refactor the judge module, (e) add a leaderboard. Explain your order using an explicit framework.",
    criteria:
      "Names and applies a framework (impact/effort, RICE, etc.); payout bug ranks first with justification; trade-offs explained; realistic about one week.",
  },
  {
    id: "p04",
    category: "planning",
    title: "Migrate a database with no downtime",
    description:
      "Outline a zero-downtime plan to move a key-value store holding 2 million task records to a new provider. Include dual-write or backfill strategy, verification, cutover, and rollback.",
    criteria:
      "Covers dual-write/backfill, consistency verification, staged cutover, explicit rollback trigger and procedure; ordering is correct.",
  },
  {
    id: "p05",
    category: "planning",
    title: "Agent onboarding funnel",
    description:
      "Design a 5-step onboarding funnel that takes an AI agent from discovering a marketplace to completing its first paid task. For each step, give the user action, the main drop-off reason, and one fix.",
    criteria:
      "Five ordered, distinct steps; drop-off reasons are plausible; fixes are concrete and address the stated reason.",
  },
  {
    id: "p06",
    category: "planning",
    title: "Budget the judge panel",
    description:
      "Each submission costs 3 LLM calls at about $0.002 each. You expect 5,000 submissions per day, and each wallet may try 3 times per day. Estimate the daily and monthly cost, then propose two ways to cut it by at least 30% without hurting fairness.",
    criteria:
      "Arithmetic correct ($30/day, ~$900/month); cost-cutting ideas are concrete (pre-filters, cheaper first-pass judge, caching duplicates) with an estimate of savings; fairness addressed.",
  },
  {
    id: "p07",
    category: "planning",
    title: "Incident response runbook",
    description:
      "Write a short runbook for 'the voucher signing key may have leaked'. Include immediate steps, how to rotate safely on a contract with an owner-only setSigner, what to tell users, and how to detect abuse that already happened.",
    criteria:
      "Immediate containment first (stop signing, rotate via setSigner from owner key); communication plan; abuse detection via on-chain mint events and score/tier anomalies; ordered and actionable.",
  },
  {
    id: "p08",
    category: "planning",
    title: "Evaluate a partnership",
    description:
      "A wallet provider offers to promote your marketplace to its users in exchange for 10% of platform fees for one year. List the questions you would ask, the numbers you would need, and a decision rule for accepting.",
    criteria:
      "Questions cover audience fit, attribution, exclusivity, and termination; identifies needed numbers (CAC, LTV, fee volume); gives a clear quantitative decision rule.",
  },

  // ── Small code ─────────────────────────────────────────────────────────────
  {
    id: "c01",
    category: "code",
    title: "Debounce in TypeScript",
    description:
      "Write a typed `debounce` function in TypeScript that delays calls until `ms` milliseconds have passed without a new call, preserves the argument types, and supports a `cancel()` method. Explain one bug that naive implementations have.",
    criteria:
      "Correct, compiling TypeScript with generics preserving parameter types; cancel works; clears previous timer; explanation of a real pitfall (lost `this`, stale args, timer not cleared).",
  },
  {
    id: "c02",
    category: "code",
    title: "Validate an EVM address",
    description:
      "Write a function (any mainstream language) that checks whether a string is a valid EVM address, including EIP-55 checksum validation when the address is mixed case. Explain the checksum rule briefly.",
    criteria:
      "Checks 0x prefix and 40 hex chars; all-lower/all-upper accepted; mixed case validated via keccak256 of the lowercase hex (not SHA-3 FIPS); explanation correct.",
  },
  {
    id: "c03",
    category: "code",
    title: "Sliding-window rate limiter",
    description:
      "Implement a sliding-window rate limiter `allow(key: string): boolean` that permits at most N requests per W seconds per key, in memory. State its time and memory complexity and one limitation in a serverless deployment.",
    criteria:
      "Correct sliding-window logic (timestamps or weighted counters), evicts old entries; complexity stated correctly; mentions that serverless instances do not share memory and a shared store is needed.",
  },
  {
    id: "c04",
    category: "code",
    title: "Find the bug",
    description:
      "Find and fix the bug: `function avg(xs) { let s = 0; for (let i = 0; i <= xs.length; i++) s += xs[i]; return s / xs.length; }`. Also handle the empty-array case and explain what the original returns for [1,2,3].",
    criteria:
      "Identifies off-by-one (<=) causing undefined addition → NaN; fixed loop; empty array handled explicitly; correctly states original returns NaN.",
  },
  {
    id: "c05",
    category: "code",
    title: "SQL: top agents per category",
    description:
      "Given a table submissions(agent_id, category, score, created_at), write one SQL query that returns, for each category, the top 3 agents by average score among agents with at least 5 submissions in that category. Explain your use of window functions.",
    criteria:
      "Correct GROUP BY with HAVING count >= 5; ranking with ROW_NUMBER/RANK partitioned by category; filters rank <= 3; explanation addresses ties.",
  },
  {
    id: "c06",
    category: "code",
    title: "Retry with exponential backoff",
    description:
      "Write an async `retry(fn, { retries, baseMs })` helper in JavaScript or TypeScript with exponential backoff and full jitter, which does not retry on errors marked `nonRetryable`. Explain why jitter matters.",
    criteria:
      "Correct exponential delay with random jitter; respects retries count; rethrows last error; skips nonRetryable errors; explanation of thundering-herd avoidance.",
  },
  {
    id: "c07",
    category: "code",
    title: "Solidity review",
    description:
      "Review this Solidity snippet and list every issue: `function claim(uint amount) external { require(balances[msg.sender] >= amount); (bool ok,) = msg.sender.call{value: amount}(\"\"); balances[msg.sender] -= amount; }`. Provide a fixed version.",
    criteria:
      "Identifies reentrancy (state update after external call) and unchecked `ok`; fix uses checks-effects-interactions and/or ReentrancyGuard and requires ok; mentions missing error message/events as minor.",
  },
  {
    id: "c08",
    category: "code",
    title: "Parse a duration string",
    description:
      "Write a function `parseDuration(s)` that converts strings like '1h30m', '45s', '2d', '1h 5m 10s' into seconds, rejecting invalid input. Include at least 5 test cases with expected outputs.",
    criteria:
      "Handles d/h/m/s units, optional spaces, rejects junk and empty input; at least 5 correct test cases; code is readable.",
  },
  {
    id: "c09",
    category: "code",
    title: "Merge overlapping intervals",
    description:
      "Write a function that merges overlapping intervals, e.g. [[1,3],[2,6],[8,10],[15,18]] → [[1,6],[8,10],[15,18]]. Treat touching intervals ([1,4],[4,5]) as overlapping. Give the complexity and two edge cases.",
    criteria:
      "Sorts by start and merges correctly, including touching intervals; O(n log n) stated; edge cases (empty input, fully nested interval) handled.",
  },
  {
    id: "c10",
    category: "code",
    title: "Idempotent webhook handler",
    description:
      "Sketch a webhook handler (any language) that processes payment events exactly once even when the provider retries the same event several times and requests arrive concurrently. Explain the storage you rely on.",
    criteria:
      "Uses an idempotency key (event id) with an atomic set-if-not-exists or unique constraint; handles concurrent duplicates; returns 2xx for duplicates; explains failure between record and side effect.",
  },

  // ── Mixed ──────────────────────────────────────────────────────────────────
  {
    id: "m01",
    category: "reasoning",
    title: "Judge the judges",
    description:
      "An AI panel of three judges scores answers 0-100 and the average decides pass/fail at 70. Describe three ways an agent might game this system and, for each, a countermeasure the operator could deploy.",
    criteria:
      "Three distinct, realistic attacks (prompt injection in the answer, length padding, probing with resubmissions); countermeasures are specific and feasible; balanced and concise.",
  },
  {
    id: "m02",
    category: "planning",
    title: "Write acceptance criteria",
    description:
      "Write acceptance criteria (Given/When/Then) for this feature: 'An agent can request a skill test task; it has 30 minutes to submit; at most 3 tasks per wallet per day.' Cover the happy path and at least four edge cases.",
    criteria:
      "Correct Given/When/Then format; happy path plus at least four meaningful edge cases (expiry, 4th request, reuse of an attempt, wrong wallet); criteria are testable.",
  },
  {
    id: "m03",
    category: "data",
    title: "Explain a confidence interval",
    description:
      "An agent passed 42 out of 60 tasks. Compute a 95% confidence interval for its true pass rate using the normal approximation, interpret it in plain English, and say when you would prefer a Wilson interval.",
    criteria:
      "p̂ = 0.70; SE ≈ 0.059; CI ≈ [0.584, 0.816]; plain-English interpretation avoids the common misreading; Wilson preferred for small n or p near 0/1.",
  },
  {
    id: "m04",
    category: "writing",
    title: "Threat model in one page",
    description:
      "Write a compact threat model for a server that signs mint vouchers after an AI judge passes an answer. List assets, attackers, the top 4 threats, and one mitigation each.",
    criteria:
      "Assets include signer key and judge integrity; attackers are realistic; threats are specific (key theft, voucher replay, judge manipulation, rate abuse); mitigations match threats.",
  },
];

export function getArenaTask(id: string): ArenaTask | undefined {
  return ARENA_TASKS.find((t) => t.id === id);
}

export function pickArenaTask(exclude: string[] = []): ArenaTask {
  const pool = ARENA_TASKS.filter((t) => !exclude.includes(t.id));
  const from = pool.length ? pool : ARENA_TASKS;
  return from[Math.floor(Math.random() * from.length)];
}
