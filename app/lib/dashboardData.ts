/**
 * Dashboard views built from real data only: task records and the escrow's own
 * events. Nothing here is simulated.
 */
import type { FeedEntry, Task, TxEntry } from "./types";
import { explorerTx, shortenAddress } from "./constants";

const nowSec = () => Math.floor(Date.now() / 1000);

/** Still taking submissions: an escrowed or open task whose deadline has not passed. */
export function isAcceptingSubmissions(t: Task): boolean {
  return ["Open", "UnderReview", "AwaitingDecision"].includes(t.status) && t.deadline > nowSec();
}

/** A task that is over and needs no attention: expired, refunded or stopped. */
export function isEnded(t: Task): boolean {
  return ["Expired", "Refunded", "Stopped"].includes(t.status) || (t.status === "Open" && t.deadline <= nowSec() && !t.submissions?.length);
}

/** Status shown on the card: a task that still takes submissions reads as Open. */
export function displayStatus(t: Task): Task["status"] {
  return isAcceptingSubmissions(t) ? "Open" : t.status;
}

/** Live tasks first (soonest deadline first), then everything else newest first. */
export function sortForPool(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const la = isAcceptingSubmissions(a) ? 0 : 1;
    const lb = isAcceptingSubmissions(b) ? 0 : 1;
    if (la !== lb) return la - lb;
    if (la === 0) return a.deadline - b.deadline;
    return b.id - a.id;
  });
}

function stamp(sec: number) {
  const d = new Date(sec * 1000);
  return { time: d.toISOString(), timeStr: d.toLocaleTimeString(undefined, { hour12: false }) };
}

/** Recent submissions and judged scores, newest first. */
export function activityFromTasks(tasks: Task[], limit = 60): FeedEntry[] {
  const out: (FeedEntry & { sec: number })[] = [];
  for (const t of tasks) {
    for (const s of t.submissions ?? []) {
      const sec = Number(s.submittedAt) || 0;
      if (!sec) continue;
      const scores = (t.verdicts ?? []).filter((v) => v.agent === s.agent).map((v) => v.score);
      const avg = scores.length ? Math.round(scores.reduce((x, y) => x + y, 0) / scores.length) : null;
      const who = shortenAddress(s.agent);
      out.push({
        id: `sub-${t.id}-${s.agent}`,
        sec,
        ...stamp(sec),
        agent: "network",
        icon: "net",
        message: avg === null ? `${who} submitted to task #${t.id}` : `${who} submitted to task #${t.id}, judged ${avg}/100`,
      });
    }
  }
  return out.sort((a, b) => b.sec - a.sec).slice(0, limit).map(({ sec: _sec, ...e }) => e);
}

type RawEvent = { id: string; txHash: string; topics: string[]; value: string; ledger: number; ledgerClosedAt?: string };

/** Escrow events from /api/reputation/events, newest first, decoded for the TX column. */
export async function txFromEscrowEvents(events: RawEvent[], limit = 40): Promise<TxEntry[]> {
  const { xdr, scValToNative } = await import("@stellar/stellar-sdk");
  const out: TxEntry[] = [];
  for (const e of [...events].reverse().slice(0, limit)) {
    try {
      const topic = String(scValToNative(xdr.ScVal.fromXDR(e.topics[0], "base64")));
      const v = scValToNative(xdr.ScVal.fromXDR(e.value, "base64")) as Record<string, unknown>;
      const amount = v.reward !== undefined ? `${(Number(v.reward) / 1e7).toFixed(4)} XLM` : undefined;
      out.push({
        id: e.id,
        type: `${topic}()`,
        hash: e.txHash,
        winner: typeof v.winner === "string" ? v.winner : undefined,
        agent: typeof v.poster === "string" && topic === "post" ? shortenAddress(v.poster) : undefined,
        amount,
        taskId: v.task_id !== undefined ? Number(v.task_id) : undefined,
        time: e.ledgerClosedAt ?? "",
        explorerUrl: explorerTx(e.txHash),
        slot: e.ledger,
        ms: 0,
      });
    } catch {
      /* skip an event we cannot decode */
    }
  }
  return out;
}
