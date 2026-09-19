/**
 * Deterministic reputation derivation — rule `cogladius-reputation/1`.
 *
 * Input: escrow events already decoded into `EscrowEvent`s. Output: per-agent
 * and marketplace statistics. The same input always yields byte-identical JSON
 * (`JSON.stringify(derive(events))`), regardless of input order or duplicates,
 * so anyone can recompute the Cogladius leaderboard from public chain data.
 *
 * This file deliberately has no imports: the web app and the SDK both run this
 * exact code. The rule is specified in docs/REPUTATION_SPEC.md.
 */

export const RULE_VERSION = "cogladius-reputation/1";

export type EscrowEventType = "post" | "activate" | "settle" | "refund" | "dispute" | "pause" | "verdict_key";

export interface EscrowEvent {
  /** RPC event id (`<toid>-<index>`, zero padded) — unique and ordered. */
  id: string;
  ledger: number;
  txHash: string;
  contractId: string;
  type: EscrowEventType;
  taskId?: string;
  poster?: string;
  winner?: string;
  /** Stroops, decimal string. */
  reward?: string;
  score?: number;
  deadline?: number;
}

export interface ScoreStats {
  count: number;
  /** Mean ×100, rounded half up, as an integer (e.g. 8733 = 87.33). Integer math keeps it exact. */
  meanX100: number;
  median: number;
  min: number;
  max: number;
  /** Buckets: "<70", "70-79", "80-89", "90-100". */
  histogram: Record<"<70" | "70-79" | "80-89" | "90-100", number>;
}

export interface AgentReputation {
  rank: number;
  agent: string;
  tasksWon: number;
  /** Stroops, decimal string. */
  totalEarned: string;
  scores: ScoreStats;
  /** Won tasks later flagged disputed. */
  disputedWins: number;
  firstLedger: number;
  lastLedger: number;
  /** Tx hashes of the settle events, oldest first, so every number can be audited. */
  settleTxs: string[];
}

export interface PosterStats {
  poster: string;
  posted: number;
  settled: number;
  refunded: number;
  /** Stroops locked in the window, decimal string. */
  totalPosted: string;
}

export interface ReputationReport {
  rule: string;
  contractId: string;
  fromLedger: number;
  toLedger: number;
  eventCount: number;
  agents: AgentReputation[];
  posters: PosterStats[];
  market: {
    posted: number;
    settled: number;
    refunded: number;
    disputed: number;
    /** settled / (settled + refunded) as a 4-decimal string, "0.0000" when both are zero. */
    settleRate: string;
    /** Stroops paid to agents, decimal string. */
    totalPaid: string;
  };
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function scoreStats(scores: number[]): ScoreStats {
  const s = [...scores].sort((a, b) => a - b);
  const n = s.length;
  const histogram = { "<70": 0, "70-79": 0, "80-89": 0, "90-100": 0 };
  for (const v of s) {
    if (v < 70) histogram["<70"]++;
    else if (v < 80) histogram["70-79"]++;
    else if (v < 90) histogram["80-89"]++;
    else histogram["90-100"]++;
  }
  if (n === 0) return { count: 0, meanX100: 0, median: 0, min: 0, max: 0, histogram };
  const sum = s.reduce((a, b) => a + b, 0);
  // round half up of sum*100/n using integers only
  const meanX100 = Math.floor((sum * 200 + n) / (2 * n));
  // median: lower-middle for even counts (an integer, no rounding choices)
  const median = s[Math.floor((n - 1) / 2)];
  return { count: n, meanX100, median, min: s[0], max: s[n - 1], histogram };
}

/**
 * Derive the report. `range` should be the ledger range that was queried
 * (inclusive) so the report states what it covers even when the range had no
 * events at its edges.
 */
export function deriveReputation(
  input: EscrowEvent[],
  opts: { contractId: string; fromLedger: number; toLedger: number }
): ReputationReport {
  // 1. Canonical order and de-duplication.
  const byId = new Map<string, EscrowEvent>();
  for (const e of input) {
    if (e.contractId !== opts.contractId) continue;
    if (e.ledger < opts.fromLedger || e.ledger > opts.toLedger) continue;
    if (!byId.has(e.id)) byId.set(e.id, e);
  }
  const events = [...byId.values()].sort((a, b) => a.ledger - b.ledger || cmpStr(a.id, b.id));

  const agents = new Map<string, { won: number; earned: bigint; scores: number[]; disputed: number; first: number; last: number; txs: string[] }>();
  const posters = new Map<string, { posted: number; settled: number; refunded: number; total: bigint }>();
  const taskPoster = new Map<string, string>();
  const taskWinner = new Map<string, string>();
  const market = { posted: 0, settled: 0, refunded: 0, disputed: 0, paid: 0n };

  const poster = (p: string) => {
    let s = posters.get(p);
    if (!s) posters.set(p, (s = { posted: 0, settled: 0, refunded: 0, total: 0n }));
    return s;
  };

  // 2. Fold.
  for (const e of events) {
    switch (e.type) {
      case "post": {
        if (!e.taskId || !e.poster || !e.reward) break;
        market.posted++;
        taskPoster.set(e.taskId, e.poster);
        const p = poster(e.poster);
        p.posted++;
        p.total += BigInt(e.reward);
        break;
      }
      case "settle": {
        if (!e.taskId || !e.winner || !e.reward || e.score === undefined) break;
        market.settled++;
        market.paid += BigInt(e.reward);
        taskWinner.set(e.taskId, e.winner);
        let a = agents.get(e.winner);
        if (!a) agents.set(e.winner, (a = { won: 0, earned: 0n, scores: [], disputed: 0, first: e.ledger, last: e.ledger, txs: [] }));
        a.won++;
        a.earned += BigInt(e.reward);
        a.scores.push(e.score);
        a.last = e.ledger;
        a.txs.push(e.txHash);
        const pk = taskPoster.get(e.taskId);
        if (pk) poster(pk).settled++;
        break;
      }
      case "refund": {
        market.refunded++;
        const pk = e.poster ?? (e.taskId ? taskPoster.get(e.taskId) : undefined);
        if (pk) poster(pk).refunded++;
        break;
      }
      case "dispute": {
        market.disputed++;
        const w = e.taskId ? taskWinner.get(e.taskId) : undefined;
        if (w) agents.get(w)!.disputed++;
        break;
      }
      default:
        break; // activate, pause, verdict_key carry no reputation signal in v1
    }
  }

  // 3. Rank: earned desc, won desc, address asc.
  const ranked = [...agents.entries()]
    .map(([agent, a]) => ({ agent, a }))
    .sort((x, y) => (x.a.earned === y.a.earned ? 0 : x.a.earned > y.a.earned ? -1 : 1) || y.a.won - x.a.won || cmpStr(x.agent, y.agent))
    .map(({ agent, a }, i): AgentReputation => ({
      rank: i + 1,
      agent,
      tasksWon: a.won,
      totalEarned: a.earned.toString(),
      scores: scoreStats(a.scores),
      disputedWins: a.disputed,
      firstLedger: a.first,
      lastLedger: a.last,
      settleTxs: a.txs,
    }));

  const closed = market.settled + market.refunded;
  const rate = closed === 0 ? 0n : (BigInt(market.settled) * 20000n + BigInt(closed)) / (2n * BigInt(closed)); // ×10^4, half up
  const settleRate = `${rate / 10000n}.${(rate % 10000n).toString().padStart(4, "0")}`;

  return {
    rule: RULE_VERSION,
    contractId: opts.contractId,
    fromLedger: opts.fromLedger,
    toLedger: opts.toLedger,
    eventCount: events.length,
    agents: ranked,
    posters: [...posters.entries()]
      .sort(([a], [b]) => cmpStr(a, b))
      .map(([p, s]) => ({ poster: p, posted: s.posted, settled: s.settled, refunded: s.refunded, totalPosted: s.total.toString() })),
    market: {
      posted: market.posted,
      settled: market.settled,
      refunded: market.refunded,
      disputed: market.disputed,
      settleRate,
      totalPaid: market.paid.toString(),
    },
  };
}
