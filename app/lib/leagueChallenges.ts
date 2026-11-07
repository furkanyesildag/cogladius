/**
 * Gladiator League qualifier challenges. Same contract as arenaChallenges: each
 * attempt's data is derived from the attemptId, the agent ends with
 * `RESULT: <number>`, and a wrong number fails before any judge call.
 *
 * The themes are Stellar, Soroban and Cogladius mechanics. Every rule an answer
 * needs is written in the task, so the data alone decides the result; where a
 * rule is a simplified model of the network, the task says so.
 *
 * `expected` must never leave the server: routes return title, description and
 * criteria only, and nothing about the result is stored.
 */
import { createHash } from "crypto";
import type { ArenaChallenge } from "./arenaChallenges";

class Rng {
  private buf = Buffer.alloc(0);
  private at = 0;
  private counter = 0;
  constructor(private readonly seed: string) {}
  private byte(): number {
    if (this.at >= this.buf.length) {
      this.buf = createHash("sha256").update(`${this.seed}:${this.counter++}`).digest();
      this.at = 0;
    }
    return this.buf[this.at++];
  }
  /** Integer in [min, max]; max - min must stay well below 2^24. */
  int(min: number, max: number): number {
    const n = (this.byte() << 16) | (this.byte() << 8) | this.byte();
    return min + (n % (max - min + 1));
  }
  chance(oneIn: number): boolean {
    return this.int(1, oneIn) === 1;
  }
}

const CRITERIA =
  "The final RESULT line is correct. The answer shows the method step by step, applies every rule in the task, names at least one record where a rule changed the outcome, and states one edge case the rules leave open.";

const STROOPS_PER_XLM = 10_000_000;

/** Stroops as an exact XLM string with 7 decimals. */
function xlm(stroops: number): string {
  const s = String(stroops).padStart(8, "0");
  return `${s.slice(0, -7)}.${s.slice(-7)}`;
}

const tenths = (n: number) => `${Math.floor(n / 10)}.${n % 10}`;
const label = (prefix: string, i: number) => `${prefix}-${String(i + 1).padStart(2, "0")}`;

/** Account minimum balance, selling liabilities and the zero floor. */
function spendableBalances(r: Rng): ArenaChallenge {
  const baseReserve = STROOPS_PER_XLM / 2;
  let total = 0;
  const accounts = Array.from({ length: 10 }, (_, i) => {
    const subentries = r.int(0, 30);
    const numSponsoring = r.int(0, 5);
    const numSponsored = r.int(0, Math.min(5, subentries));
    const minimum = (2 + subentries + numSponsoring - numSponsored) * baseReserve;
    const liabilities = r.chance(3) ? r.int(1, 8_000_000) * 5 : 0;
    // One account in three sits close to its minimum, so the floor really applies.
    const balance = minimum + (r.chance(3) ? r.int(0, 25_000_000) : r.int(0, 15_000_000) * 200);
    total += Math.max(0, balance - minimum - liabilities);
    return {
      account: label("acct", i),
      balanceXlm: xlm(balance),
      subentries,
      numSponsoring,
      numSponsored,
      sellingLiabilitiesXlm: xlm(liabilities),
    };
  });
  return {
    kind: "reserves",
    title: "Compute spendable XLM after reserves",
    description:
      `Each account below must keep a minimum balance of (2 + subentries + numSponsoring - numSponsored) x baseReserve, with baseReserve = 0.5 XLM. XLM promised to open sell offers (sellingLiabilitiesXlm) is not spendable either. An account's spendable amount is its balance minus its minimum minus its selling liabilities, and never below zero. What is the total spendable XLM across all accounts, exact to 7 decimals?\n\n${JSON.stringify(accounts)}`,
    criteria: CRITERIA,
    expected: BigInt(total),
    decimals: 7,
  };
}

/** Replay escrow contract calls through its state machine. */
function escrowStates(r: Rng): ArenaChallenge {
  const grace = r.int(10, 60) * 60;
  const question = r.int(0, 2);
  const passThreshold = 70;
  let answer = 0;
  const tasks = Array.from({ length: 10 }, (_, i) => {
    const reward = r.int(10, 900);
    const deadline = 1_800_000_000 + r.int(0, 86_400);
    let at = deadline - r.int(600, 7_200);
    let status = "Open" as "Open" | "Active" | "Completed" | "Disputed" | "Refunded";
    const calls = Array.from({ length: r.int(1, 5) }, () => {
      at += r.int(60, 2_400);
      const kind = ["activate", "activate", "release_to_winner", "refund", "refund", "flag_disputed"][r.int(0, 5)];
      if (kind === "activate") {
        if (status === "Open") status = "Active";
        return { at, call: kind };
      }
      if (kind === "release_to_winner") {
        const score = r.int(50, 99);
        if ((status === "Open" || status === "Active") && score >= passThreshold) status = "Completed";
        return { at, call: kind, score };
      }
      if (kind === "refund") {
        const signedByPoster = r.chance(2);
        const inWindow = at <= deadline + grace;
        if ((status === "Open" && (!inWindow || signedByPoster)) || (status === "Active" && !inWindow)) status = "Refunded";
        return { at, call: kind, signedByPoster };
      }
      if (status === "Completed") status = "Disputed";
      return { at, call: kind };
    });
    const paid = status === "Completed" || status === "Disputed";
    const refunded = status === "Refunded";
    if (question === 0 ? paid : question === 1 ? refunded : !paid && !refunded) answer += reward;
    return { task: label("task", i), rewardXlm: tenths(reward), deadline, calls };
  });
  const asked = [
    "How many XLM in total were paid to winners?",
    "How many XLM in total were refunded to posters?",
    "How many XLM in total are still locked in the escrow (tasks still Open or Active)?",
  ][question];
  return {
    kind: "escrow-states",
    title: "Replay calls on the Cogladius escrow",
    description:
      `Replay the calls below on the Cogladius escrow contract, each task starting Open, with settle_grace = ${grace} seconds and pass_threshold = ${passThreshold}. A call that breaks a rule fails and changes nothing.\n- activate: only from Open, moves to Active.\n- release_to_winner: only from Open or Active, and score must be at least pass_threshold. Moves to Completed and pays the reward to the winner.\n- refund: only from Open or Active. While at <= deadline + settle_grace, an Active task cannot be refunded at all and an Open task only when signedByPoster is true. After that window anyone may refund either. Moves to Refunded and returns the reward to the poster.\n- flag_disputed: only from Completed, moves to Disputed. It moves no funds, so the winner keeps the reward.\n\n${asked}\n\n${JSON.stringify(tasks)}`,
    criteria: CRITERIA,
    expected: BigInt(answer),
    decimals: 1,
  };
}

/** Fee-bump validity (CAP-15 style) against a sponsor balance that runs down. */
function feeBumps(r: Rng): ArenaChallenge {
  const ledgerBaseFee = r.int(1, 8) * 100;
  const start = r.int(6_000, 28_000);
  let balance = start;
  let charged = 0;
  const envelopes = Array.from({ length: 14 }, (_, i) => {
    const innerOps = r.int(1, 6);
    const outerOps = innerOps + 1;
    const innerFee = r.chance(4) ? 0 : innerOps * r.int(1, 12) * 100;
    // Bids scatter around the minimum, so each validity rule rejects some envelopes.
    const bumpFee = outerOps * r.int(1, 12) * 100 + (r.chance(3) ? r.int(1, 99) : 0);
    const coversLedger = bumpFee >= ledgerBaseFee * outerOps;
    const rateOk = bumpFee * innerOps >= innerFee * outerOps;
    if (coversLedger && rateOk && balance >= bumpFee) {
      const fee = ledgerBaseFee * outerOps;
      balance -= fee;
      charged += fee;
    }
    return { envelope: label("bump", i), innerOps, innerFee, bumpFee };
  });
  return {
    kind: "fee-bump",
    title: "Total the fees a fee-bump sponsor pays",
    description:
      `A sponsor wraps the transactions below in fee-bump envelopes, in this order. It starts with ${start} stroops. This ledger's effective base fee is ${ledgerBaseFee} stroops per operation, and a fee-bump envelope counts as innerOps + 1 operations. An envelope is included only if all of these hold when it is reached, otherwise it is skipped and costs nothing:\n1. bumpFee >= effective base fee x (innerOps + 1).\n2. The outer fee rate is at least the inner fee rate: bumpFee / (innerOps + 1) >= innerFee / innerOps.\n3. The sponsor's current balance is at least bumpFee (the full bid must be covered, even though less is charged).\nAn included envelope charges the sponsor effective base fee x (innerOps + 1), not bumpFee, and the inner fee is never charged. How many stroops does the sponsor pay in total?\n\n${JSON.stringify(envelopes)}`,
    criteria: CRITERIA,
    expected: BigInt(charged),
    decimals: 0,
  };
}

/** Soroban TTL extension and a simplified rent charge. */
function ttlRent(r: Rng): ArenaChallenge {
  const currentLedger = 50_000_000 + r.int(0, 9_000_000);
  const maxEntryTtl = 3_110_400;
  const persistentRate = r.int(5, 40) * 100;
  const temporaryRate = r.int(1, 8) * 100;
  let total = 0n;
  const entries = Array.from({ length: 12 }, (_, i) => {
    const durability = r.chance(3) ? "temporary" : "persistent";
    const sizeBytes = r.int(100, 66_000);
    const threshold = r.int(5, 100) * 1_000;
    const mode = r.int(0, 5);
    let ttl: number;
    if (mode === 0) ttl = -r.int(1, 50_000); // expired
    else if (mode === 1) ttl = threshold; // exactly on the threshold
    else if (mode === 2) ttl = threshold + r.int(1, 50_000); // not due yet
    else ttl = r.int(0, threshold - 1); // due
    const liveUntilLedger = currentLedger + ttl;
    const extendTo = r.chance(5) ? maxEntryTtl + r.int(1, 2_000_000) : r.chance(5) ? r.int(1, Math.max(1, Math.abs(ttl))) : r.int(50_000, 2_000_000);

    if (ttl >= 0 && ttl < threshold) {
      const newLiveUntil = currentLedger + Math.min(extendTo, maxEntryTtl);
      if (newLiveUntil > liveUntilLedger) {
        const rate = BigInt(durability === "persistent" ? persistentRate : temporaryRate);
        const numerator = BigInt(sizeBytes) * BigInt(newLiveUntil - liveUntilLedger) * rate;
        const denominator = 1024n * 1000n;
        total += (numerator + denominator - 1n) / denominator;
      }
    }
    return { entry: label("entry", i), durability, sizeBytes, liveUntilLedger, threshold, extendTo };
  });
  return {
    kind: "ttl-rent",
    title: "Price a batch of Soroban TTL extensions",
    description:
      `Apply extend_ttl(threshold, extendTo) to each ledger entry below, with the current ledger at ${currentLedger} and max_entry_ttl = ${maxEntryTtl}. This uses a simplified rent model, not the live network's fee schedule.\n- TTL = liveUntilLedger - current ledger. An entry with a negative TTL has expired: it cannot be extended and costs nothing.\n- If TTL >= threshold, nothing happens and nothing is charged. Only a TTL strictly below threshold extends.\n- Otherwise the new liveUntilLedger is current ledger + min(extendTo, max_entry_ttl). If that is not later than the existing liveUntilLedger, nothing happens: extend never shortens.\n- A real extension charges ceil(sizeBytes x ledgersAdded x rate / (1024 x 1000)) stroops, where ledgersAdded is the new liveUntilLedger minus the old one, and rate is ${persistentRate} for persistent entries and ${temporaryRate} for temporary ones. Round up per entry, not on the total.\nHow many stroops of rent are charged in total?\n\n${JSON.stringify(entries)}`,
    criteria: CRITERIA,
    expected: total,
    decimals: 0,
  };
}

/** Sequence numbers, time bounds and fees on failed transactions. */
function sequenceReplay(r: Rng): ArenaChallenge {
  const startSeq = BigInt(r.int(100_000_000, 110_000_000)) << 32n;
  const closeTime = 1_800_000_000 + r.int(0, 86_400);
  let seq = startSeq;
  let fees = 0;
  const txs = Array.from({ length: 16 }, (_, i) => {
    const pick = r.int(0, 7);
    const useSeq = pick === 0 ? seq : pick === 1 ? seq + 2n : seq + 1n; // stale, gap, right
    const ops = r.int(1, 5);
    const maxFee = r.chance(6) ? ops * 100 - r.int(1, 99) : ops * r.int(1, 5) * 100;
    const tooEarly = r.chance(8);
    const tooLate = !tooEarly && r.chance(8);
    const minTime = tooEarly ? closeTime + r.int(1, 600) : r.chance(2) ? 0 : closeTime - r.int(0, 600);
    const maxTime = tooLate ? closeTime - r.int(1, 600) : r.chance(2) ? 0 : closeTime + r.int(0, 600);
    const opsSucceed = !r.chance(4);
    const inTime = minTime <= closeTime && (maxTime === 0 || closeTime <= maxTime);
    if (useSeq === seq + 1n && inTime && maxFee >= ops * 100) {
      seq = useSeq;
      fees += ops * 100;
    }
    return { tx: label("tx", i), seq: useSeq.toString(), ops, maxFee, minTime, maxTime, opsSucceed };
  });
  return {
    kind: "sequence",
    title: "Replay transactions against a sequence number",
    description:
      `An account's current sequence number is ${startSeq.toString()} (a 64-bit value, so handle it as an exact integer). The transactions below reach one ledger, closing at time ${closeTime}, in this order. The base fee is 100 stroops per operation. Each is checked when it is reached:\n1. seq must equal the account's current sequence number + 1.\n2. minTime <= close time, and maxTime is 0 (no limit) or close time <= maxTime.\n3. maxFee >= 100 x ops.\nA transaction that fails a check is rejected: no fee, and the sequence number does not move. Any other transaction is included: the sequence number becomes its seq and it pays 100 x ops, even when opsSucceed is false (a failed operation still costs the fee and uses the sequence number). How many stroops of fees does the account pay in total?\n\n${JSON.stringify(txs)}`,
    criteria: CRITERIA,
    expected: BigInt(fees),
    decimals: 0,
  };
}

/** The Cogladius settlement rule: late work, unjudged work, ties and the pass mark. */
function settlementCrank(r: Rng): ArenaChallenge {
  const agents = ["agent-a", "agent-b", "agent-c", "agent-d", "agent-e", "agent-f"];
  const earned = new Map<string, number>();
  const tasks = Array.from({ length: 9 }, (_, i) => {
    const reward = r.int(10, 900);
    const deadline = 1_800_000_000 + r.int(0, 86_400);
    const escrowStatus = ["Open", "Active", "Active", "Active", "Completed", "Refunded"][r.int(0, 5)];
    const first = deadline - r.int(200, 2_400); // some work lands after the deadline
    const submitters = agents.filter(() => r.chance(2));
    let at = first;
    const submissions = submitters.map((agent) => {
      at += r.int(30, 500);
      const judged = !r.chance(6);
      // Close scores on purpose, so that rounded averages tie.
      const centre = r.int(60, 88);
      return { agent, submittedAt: at, judgeScores: judged ? [centre + r.int(-2, 2), centre + r.int(-2, 2), centre + r.int(-2, 2)] : [] };
    });
    const ranked = submissions
      .filter((s) => s.judgeScores.length === 3 && s.submittedAt <= deadline)
      .map((s) => ({ ...s, avg: Math.round((s.judgeScores[0] + s.judgeScores[1] + s.judgeScores[2]) / 3) }))
      .sort((a, b) => b.avg - a.avg || a.submittedAt - b.submittedAt);
    if ((escrowStatus === "Open" || escrowStatus === "Active") && ranked[0] && ranked[0].avg >= 70) {
      earned.set(ranked[0].agent, (earned.get(ranked[0].agent) ?? 0) + reward);
    }
    return { task: label("task", i), rewardXlm: tenths(reward), deadline, escrowStatus, submissions };
  });
  return {
    kind: "settlement",
    title: "Run the Cogladius settlement crank",
    description:
      `Settle each Cogladius task below as the crank does. A submission counts only if it has judge scores and submittedAt <= deadline. Its score is the average of its three judge scores, rounded to the nearest integer. The winner is the highest score; a tie goes to the earliest submittedAt. The escrow pays the winner the reward only if the winner's score is at least 70 and escrowStatus is Open or Active. A winner under 70 means nobody is paid: the runner-up never gets the reward. What is the largest total, in XLM, received by any single agent across all tasks?\n\n${JSON.stringify(tasks)}`,
    criteria: CRITERIA,
    expected: BigInt(Math.max(0, ...Array.from(earned.values()))),
    decimals: 1,
  };
}

const GENERATORS = [spendableBalances, escrowStates, feeBumps, ttlRent, sequenceReplay, settlementCrank];

export function buildLeagueChallenge(attemptId: string): ArenaChallenge {
  const r = new Rng(`league:${attemptId.toLowerCase()}`);
  const c = GENERATORS[r.int(0, GENERATORS.length - 1)](r);
  return {
    ...c,
    description: `${c.description}\n\nExplain your method, then end your answer with one line in exactly this form: RESULT: <number>`,
  };
}
