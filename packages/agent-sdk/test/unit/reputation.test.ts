import { describe, it, expect } from "vitest";
import { deriveReputation, type EscrowEvent } from "../../src/reputation/derive.js";

const C = "CESCROW";
let n = 0;
const ev = (ledger: number, e: Partial<EscrowEvent> & { type: EscrowEvent["type"] }): EscrowEvent => ({
  id: `${String(ledger).padStart(12, "0")}-${String(n++).padStart(10, "0")}`,
  ledger,
  txHash: `tx${n}`,
  contractId: C,
  ...e,
});

const events: EscrowEvent[] = [
  ev(10, { type: "post", taskId: "1", poster: "GP1", reward: "30000000", deadline: 1 }),
  ev(11, { type: "post", taskId: "2", poster: "GP1", reward: "10000000", deadline: 1 }),
  ev(12, { type: "post", taskId: "3", poster: "GP2", reward: "10000000", deadline: 1 }),
  ev(13, { type: "post", taskId: "4", poster: "GP2", reward: "5000000", deadline: 1 }),
  ev(20, { type: "settle", taskId: "1", winner: "GA", reward: "30000000", score: 91 }),
  ev(21, { type: "settle", taskId: "2", winner: "GB", reward: "10000000", score: 74 }),
  ev(22, { type: "settle", taskId: "3", winner: "GB", reward: "10000000", score: 85 }),
  ev(23, { type: "refund", taskId: "4", poster: "GP2", reward: "5000000" }),
  ev(24, { type: "dispute", taskId: "2" }),
  ev(25, { type: "pause" }),
];
const range = { contractId: C, fromLedger: 1, toLedger: 100 };

describe("reputation derivation (cogladius-reputation/1)", () => {
  it("is independent of input order and duplicates", () => {
    const a = JSON.stringify(deriveReputation(events, range));
    const shuffled = [...events, ...events.slice(0, 4)].sort(() => Math.random() - 0.5);
    expect(JSON.stringify(deriveReputation(shuffled, range))).toBe(a);
  });

  it("computes per-agent stats and ranks by earnings", () => {
    const r = deriveReputation(events, range);
    expect(r.agents.map((a) => [a.rank, a.agent, a.tasksWon, a.totalEarned])).toEqual([
      [1, "GA", 1, "30000000"],
      [2, "GB", 2, "20000000"],
    ]);
    const gb = r.agents[1];
    expect(gb.scores).toEqual({ count: 2, meanX100: 7950, median: 74, min: 74, max: 85, histogram: { "<70": 0, "70-79": 1, "80-89": 1, "90-100": 0 } });
    expect(gb.disputedWins).toBe(1);
    expect(gb.settleTxs).toHaveLength(2);
  });

  it("computes marketplace and poster stats", () => {
    const r = deriveReputation(events, range);
    expect(r.market).toEqual({ posted: 4, settled: 3, refunded: 1, disputed: 1, settleRate: "0.7500", totalPaid: "50000000" });
    expect(r.posters).toEqual([
      { poster: "GP1", posted: 2, settled: 2, refunded: 0, totalPosted: "40000000" },
      { poster: "GP2", posted: 2, settled: 1, refunded: 1, totalPosted: "15000000" },
    ]);
  });

  it("ignores other contracts and events outside the range", () => {
    const r = deriveReputation([...events, { ...events[4], id: "x", contractId: "COTHER" }], { ...range, toLedger: 20 });
    expect(r.market.settled).toBe(1);
    expect(r.eventCount).toBe(5);
  });

  it("rounds the mean half up with integer math", () => {
    const e = [1, 2, 3].map((i) => ev(30 + i, { type: "settle", taskId: `m${i}`, winner: "GM", reward: "1", score: [70, 70, 71][i - 1] }));
    expect(deriveReputation(e, range).agents[0].scores.meanX100).toBe(7033); // 70.333…
  });
});

import { fromHorizonOpId, normalizeEventId, ledgerOfToid } from "../../src/reputation/events.js";

describe("event ids from RPC and from an indexer dedupe to one id", () => {
  it("maps a Horizon/Stellar Expert operation id onto the RPC event id", () => {
    // Same post event: RPC id vs Stellar Expert id (mainnet escrow, ledger 63493457).
    expect(fromHorizonOpId("272702321326788609-0001")).toBe(normalizeEventId("0272702321326788608-0000000001"));
    expect(ledgerOfToid("272702321326788609")).toBe(63493457);
    expect(() => fromHorizonOpId("272702321326788608-0001")).toThrow();
  });
});
