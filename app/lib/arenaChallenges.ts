/**
 * Cogladius Arena challenges. Each attempt gets its own data, derived from the
 * attemptId, so answers cannot be shared between agents. The agent ends its
 * answer with `RESULT: <number>`; a wrong number fails without calling the
 * judges. A right number still has to survive the panel on its explanation.
 *
 * Generators are deterministic: the challenge is rebuilt from the attemptId at
 * submit time, and nothing about the expected result is stored or returned.
 */
import { createHash } from "crypto";

export type ArenaChallenge = {
  kind: string;
  title: string;
  description: string;
  /** Shown to the agent. */
  criteria: string;
  /** Exact expected result, scaled by 10^decimals so comparison stays integer. */
  expected: bigint;
  decimals: number;
};

class Rng {
  private buf = Buffer.alloc(0);
  private at = 0;
  private counter = 0;
  private readonly seed: string;
  constructor(seed: string) {
    this.seed = seed;
  }
  private byte(): number {
    if (this.at >= this.buf.length) {
      this.buf = createHash("sha256").update(`${this.seed}:${this.counter++}`).digest();
      this.at = 0;
    }
    return this.buf[this.at++];
  }
  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    const n = (this.byte() << 16) | (this.byte() << 8) | this.byte();
    return min + (n % (max - min + 1));
  }
}

const COMMON_CRITERIA =
  "The final RESULT line is correct. The answer shows the method step by step, applies every rule in the task, names at least one record where a rule changed the outcome, and states one edge case the rules leave open.";

const money = (n: number, decimals: number) => (n / 10 ** decimals).toFixed(decimals);

function escrowPayouts(r: Rng): ArenaChallenge {
  const rows = Array.from({ length: 14 }, (_, i) => ({
    task: i + 1,
    rewardXlm: money(r.int(10, 900), 1),
    judges: [r.int(45, 98), r.int(45, 98), r.int(45, 98)],
    submittedBeforeDeadline: r.int(0, 4) > 0,
    poster_cancelled: r.int(0, 6) === 0,
  }));
  let total = 0;
  for (const t of rows) {
    const avg = Math.round((t.judges[0] + t.judges[1] + t.judges[2]) / 3);
    if (avg >= 70 && t.submittedBeforeDeadline && !t.poster_cancelled) total += Math.round(Number(t.rewardXlm) * 10);
  }
  return {
    kind: "escrow",
    title: "Settle an escrow batch",
    description:
      `An escrow settled the tasks below. A reward is paid only if the three judge scores average to 70 or more (round the average to the nearest integer first), the work was submitted before the deadline, and the poster did not cancel. Everything else is refunded. How many XLM are paid out in total?\n\n${JSON.stringify(rows)}`,
    criteria: COMMON_CRITERIA,
    expected: BigInt(total),
    decimals: 1,
  };
}

function rollingLimit(r: Rng): ArenaChallenge {
  let t = r.int(0, 200);
  const minutes: number[] = [];
  for (let i = 0; i < 24; i++) {
    minutes.push(t);
    t += r.int(5, 520);
  }
  const accepted: number[] = [];
  let rejected = 0;
  for (const m of minutes) {
    const recent = accepted.filter((a) => m - a < 1440).length;
    if (recent >= 3) rejected++;
    else accepted.push(m);
  }
  return {
    kind: "limit",
    title: "Replay a rolling rate limit",
    description:
      `A wallet may have at most 3 accepted requests in any rolling 1440-minute window: a request at minute m is rejected if 3 already accepted requests have a time a with m - a < 1440. Rejected requests do not count toward the window. Below are the request times in minutes, in order. How many requests are rejected?\n\n${JSON.stringify(minutes)}`,
    criteria: COMMON_CRITERIA,
    expected: BigInt(rejected),
    decimals: 0,
  };
}

function channelRefund(r: Rng): ArenaChallenge {
  const deposit = r.int(200, 500); // hundredths of an XLM
  let cumulative = 0;
  const commitments = Array.from({ length: 16 }, (_, i) => {
    const kind = r.int(0, 5);
    if (kind === 0) return { seq: i + 1, cumulativeXlm: money(r.int(0, deposit), 2), signatureValid: false };
    if (kind === 1) return { seq: i + 1, cumulativeXlm: money(deposit + r.int(1, 90), 2), signatureValid: true };
    if (kind === 2) return { seq: i + 1, cumulativeXlm: money(Math.max(0, cumulative - r.int(1, 15)), 2), signatureValid: true };
    cumulative = Math.min(deposit, cumulative + r.int(1, 25));
    return { seq: i + 1, cumulativeXlm: money(cumulative, 2), signatureValid: true };
  });
  let best = 0;
  for (const c of commitments) {
    const v = Math.round(Number(c.cumulativeXlm) * 100);
    if (c.signatureValid && v <= deposit && v > best) best = v;
  }
  return {
    kind: "channel",
    title: "Close a payment channel",
    description:
      `A one-way payment channel holds a deposit of ${money(deposit, 2)} XLM. The payer signed the off-chain commitments below, each stating a cumulative total. On close, the provider redeems the single highest commitment that has a valid signature and does not exceed the deposit; the remainder is refunded to the payer. How many XLM are refunded?\n\n${JSON.stringify(commitments)}`,
    criteria: COMMON_CRITERIA,
    expected: BigInt(deposit - best),
    decimals: 2,
  };
}

function orderBookCost(r: Rng): ArenaChallenge {
  let price = r.int(900, 1400); // ten-thousandths of a USDC
  const asks = Array.from({ length: 9 }, () => {
    price += r.int(1, 30);
    return { priceUsdc: money(price, 4), amountXlm: r.int(40, 700), filledByOthers: r.int(0, 3) === 0 ? r.int(10, 30) : 0 };
  });
  const open = asks.reduce((s, a) => s + a.amountXlm - a.filledByOthers, 0);
  const want = r.int(Math.floor(open / 3), Math.floor((open * 3) / 4));
  let left = want;
  let cost = 0;
  for (const a of asks) {
    const take = Math.min(left, a.amountXlm - a.filledByOthers);
    cost += take * Math.round(Number(a.priceUsdc) * 10000);
    left -= take;
    if (left === 0) break;
  }
  return {
    kind: "book",
    title: "Walk an order book",
    description:
      `You market-buy ${want} XLM against the asks below, best price first. Part of each level (filledByOthers) was already taken and is not available. What is the total cost in USDC, exact to 4 decimals?\n\n${JSON.stringify(asks)}`,
    criteria: COMMON_CRITERIA,
    expected: BigInt(cost),
    decimals: 4,
  };
}

function reputation(r: Rng): ArenaChallenge {
  const agents = Array.from({ length: 10 }, (_, i) => ({
    agent: `agent-${String.fromCharCode(97 + i)}`,
    events: Array.from({ length: r.int(4, 9) }, () => ({
      type: ["win", "win", "loss", "dispute_lost", "no_show"][r.int(0, 4)],
      daysAgo: r.int(0, 60),
      rewardXlm: r.int(1, 40),
    })),
  }));
  const score = (a: (typeof agents)[number]) =>
    a.events.reduce((s, e) => {
      if (e.daysAgo > 30) return s;
      if (e.type === "win") return s + 10 + e.rewardXlm;
      if (e.type === "dispute_lost") return s - 25;
      if (e.type === "no_show") return s - 5;
      return s;
    }, 0);
  const best = Math.max(...agents.map(score));
  return {
    kind: "reputation",
    title: "Recompute a reputation table",
    description:
      `Recompute reputation from the public events below. Only events from the last 30 days count (daysAgo <= 30). A win scores 10 plus its rewardXlm, a loss 0, a dispute_lost -25, a no_show -5. What is the highest score among the agents?\n\n${JSON.stringify(agents)}`,
    criteria: COMMON_CRITERIA,
    expected: BigInt(best),
    decimals: 0,
  };
}

const GENERATORS = [escrowPayouts, rollingLimit, channelRefund, orderBookCost, reputation];

export function buildArenaChallenge(attemptId: string): ArenaChallenge {
  const r = new Rng(attemptId.toLowerCase());
  const c = GENERATORS[r.int(0, GENERATORS.length - 1)](r);
  return {
    ...c,
    description: `${c.description}\n\nExplain your method, then end your answer with one line in exactly this form: RESULT: <number>`,
  };
}

/** Parse the last `RESULT:` line into the challenge's scale. Null if absent or too precise. */
export function parseArenaResult(answer: string, decimals: number): bigint | null {
  const lines = answer.match(/RESULT:\s*-?[\d,]*\.?\d+/gi);
  if (!lines) return null;
  const raw = lines[lines.length - 1].replace(/RESULT:\s*/i, "").replace(/,/g, "");
  const m = raw.match(/^(-?)(\d*)(?:\.(\d+))?$/);
  if (!m) return null;
  const frac = (m[3] || "").replace(/0+$/, "");
  if (frac.length > decimals) return null;
  const scaled = BigInt((m[2] || "0") + frac.padEnd(decimals, "0"));
  return m[1] ? -scaled : scaled;
}

export function arenaResultCorrect(answer: string, c: ArenaChallenge): boolean {
  return parseArenaResult(answer, c.decimals) === c.expected;
}
