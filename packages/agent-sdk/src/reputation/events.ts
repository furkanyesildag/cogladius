/**
 * Read escrow events through Soroban RPC `getEvents` and decode them into
 * `EscrowEvent`s for `deriveReputation`.
 *
 * RPC keeps a limited event window (commonly about seven days). `fetchEscrowEvents`
 * clamps the start to the oldest ledger the RPC still serves and reports the
 * range it actually covered. For older history, feed archived raw events (see
 * `RawEvent`) captured from RPC, a Galexie data lake or Hubble into
 * `decodeRawEvent` — every raw event carries its tx hash, so each one can be
 * checked on an explorer.
 */

import { rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import type { NetworkConfig } from "../network.js";
import { rpcServer, withRetry } from "../soroban.js";
import type { EscrowEvent, EscrowEventType } from "./derive.js";

/** An event exactly as RPC returned it, XDR kept base64 so it can be archived. */
export interface RawEvent {
  id: string;
  ledger: number;
  txHash: string;
  contractId: string;
  topics: string[];
  value: string;
}

const TYPES = new Set<EscrowEventType>(["post", "activate", "settle", "refund", "dispute", "pause", "verdict_key"]);

export function decodeRawEvent(raw: RawEvent): EscrowEvent | null {
  let name: string;
  try {
    name = String(scValToNative(xdr.ScVal.fromXDR(raw.topics[0], "base64")));
  } catch {
    return null;
  }
  if (!TYPES.has(name as EscrowEventType)) return null;
  let data: any = {};
  try {
    data = scValToNative(xdr.ScVal.fromXDR(raw.value, "base64")) ?? {};
  } catch {
    return null;
  }
  const e: EscrowEvent = { id: raw.id, ledger: raw.ledger, txHash: raw.txHash, contractId: raw.contractId, type: name as EscrowEventType };
  if (data.task_id !== undefined) e.taskId = BigInt(data.task_id).toString();
  if (data.poster !== undefined) e.poster = String(data.poster);
  if (data.winner !== undefined) e.winner = String(data.winner);
  if (data.reward !== undefined) e.reward = BigInt(data.reward).toString();
  if (data.score !== undefined) e.score = Number(data.score);
  if (data.deadline !== undefined) e.deadline = Number(data.deadline);
  return e;
}

export function toRawEvent(ev: rpc.Api.EventResponse): RawEvent {
  return {
    id: ev.id,
    ledger: ev.ledger,
    txHash: ev.txHash,
    contractId: ev.contractId ? ev.contractId.toString() : "",
    topics: ev.topic.map((t) => t.toXDR("base64")),
    value: ev.value.toXDR("base64"),
  };
}

/**
 * Page through all escrow events in `[fromLedger, toLedger]` (inclusive).
 * Returns the raw events and the range actually covered.
 */
export async function fetchEscrowEvents(
  net: NetworkConfig,
  opts: { fromLedger?: number; toLedger?: number; contractId?: string; pageSize?: number } = {}
): Promise<{ raw: RawEvent[]; fromLedger: number; toLedger: number; clamped: boolean }> {
  const server = rpcServer(net);
  const contractId = opts.contractId ?? net.escrowContractId;
  const health: any = await withRetry("getHealth", () => server.getHealth());
  const latest = Number(health.latestLedger);
  const oldest = Number(health.oldestLedger ?? latest - 120_000);
  const toLedger = Math.min(opts.toLedger ?? latest, latest);
  const requestedFrom = opts.fromLedger ?? oldest;
  const fromLedger = Math.max(requestedFrom, oldest);

  const raw: RawEvent[] = [];
  const filters = [{ type: "contract", contractIds: [contractId] }];
  const limit = opts.pageSize ?? 200;
  let cursor: string | undefined;
  // RPC providers scan a bounded ledger window per request and return a cursor
  // even when a page is short, so keep paging until the cursor passes toLedger.
  for (let page = 0; page < 100_000; page++) {
    const req: any = cursor ? { cursor, filters, limit } : { startLedger: fromLedger, endLedger: toLedger + 1, filters, limit };
    const res: any = await withRetry("getEvents", () => server.getEvents(req));
    for (const ev of res.events) {
      if (ev.ledger > toLedger) return { raw, fromLedger, toLedger, clamped: fromLedger !== requestedFrom };
      const r = toRawEvent(ev);
      raw.push({ ...r, id: normalizeEventId(r.id) });
    }
    const next: string | undefined = res.cursor;
    if (!next || next === cursor) break;
    const cursorLedger = ledgerOfToid(next.split("-")[0]);
    if (res.events.length < limit && cursorLedger >= toLedger) break;
    if (res.events.length === 0 && cursorLedger >= Number(res.latestLedger ?? toLedger)) break;
    cursor = next;
  }
  return { raw, fromLedger, toLedger, clamped: fromLedger !== requestedFrom };
}

/**
 * RPC event id format: 19-digit TOID, dash, 10-digit event index. RPC encodes
 * the operation index 0-based; Horizon/Stellar Expert operation ids are
 * 1-based, so the same event arrives as `…608-1` from RPC and `…609-1` from an
 * indexer. `fromHorizonOpId` converts the latter so both dedupe to one id.
 */
export function normalizeEventId(id: string): string {
  const [toid, idx = "0"] = id.split("-");
  return `${toid.padStart(19, "0")}-${idx.padStart(10, "0")}`;
}

export function fromHorizonOpId(id: string): string {
  const [toid, idx = "0"] = id.split("-");
  const t = BigInt(toid);
  const opIndex = t & 0xfffn;
  if (opIndex === 0n) throw new Error(`not a Horizon operation id: ${id}`);
  return normalizeEventId(`${t - 1n}-${idx}`);
}

/** Ledger sequence encoded in a TOID (upper 32 bits). */
export function ledgerOfToid(toid: string): number {
  return Number(BigInt(toid) >> 32n);
}

/**
 * Backfill escrow events older than the RPC window from the Stellar Expert
 * public API, which serves contract events with their raw topic/body XDR. The
 * transaction hash of each event is resolved through Horizon (`/operations/{toid}`),
 * so every archived event can be checked on any explorer — the indexer is only
 * a convenience for finding them.
 */
export async function fetchArchivedEvents(
  net: NetworkConfig,
  opts: { contractId?: string; beforeLedger?: number; fetch?: typeof fetch; expertBase?: string } = {}
): Promise<RawEvent[]> {
  const f = opts.fetch ?? globalThis.fetch;
  const contractId = opts.contractId ?? net.escrowContractId;
  const segment = net.networkPassphrase.startsWith("Public") ? "public" : "testnet";
  const base = opts.expertBase ?? "https://api.stellar.expert";
  const out: RawEvent[] = [];
  let url = `${base}/explorer/${segment}/contract/${contractId}/events?order=asc&limit=200`;
  for (let page = 0; page < 500 && url; page++) {
    const res: any = await withRetry("stellar.expert events", async () => {
      const r = await f(url);
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
      return r.json();
    });
    const records: any[] = res?._embedded?.records ?? [];
    for (const rec of records) {
      const [toid] = String(rec.id).split("-");
      const ledger = ledgerOfToid(toid);
      if (opts.beforeLedger !== undefined && ledger >= opts.beforeLedger) return out;
      const op: any = await withRetry("horizon operation", async () => {
        const r = await f(`${net.horizonUrl}/operations/${toid}`);
        if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
        return r.json();
      });
      out.push({
        id: fromHorizonOpId(String(rec.id)),
        ledger,
        txHash: String(op.transaction_hash),
        contractId: String(rec.contract),
        topics: rec.topicsXdr,
        value: rec.bodyXdr,
      });
    }
    const next = res?._links?.next?.href;
    url = records.length === 200 && next ? `${base}${next}` : "";
  }
  return out;
}
