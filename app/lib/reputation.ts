/**
 * Leaderboard data, derived only from escrow events on chain.
 *
 * Events come from Soroban RPC `getEvents` (recent window, ~7 days) and, for
 * older history, from the Stellar Expert contract-events API with each tx hash
 * resolved through Horizon. The raw events are cached (Redis) purely as a
 * cache: /api/reputation/events serves them verbatim so anyone can re-derive
 * the leaderboard with the SDK and get identical numbers. The derivation is the
 * SDK's `deriveReputation`, compiled into this app from the same source file.
 */

import { getRedis } from "./redis";
import { mppNet } from "./mpp/server";
import {
  deriveReputation,
  type ReputationReport,
} from "@cogladius/agent-sdk/reputation/derive";
import {
  decodeRawEvent,
  fetchArchivedEvents,
  fetchEscrowEvents,
  type RawEvent,
} from "@cogladius/agent-sdk/reputation/events";

const ARCHIVE_KEY = "cogladius:reputation:raw-events";
const REFRESH_MS = 60_000;

const g = globalThis as unknown as { __cogRepArchive?: RawEvent[] };
let memArchive: RawEvent[] = g.__cogRepArchive ?? [];
let lastRefresh = 0;
let latestLedger = 0;
let refreshing: Promise<void> | null = null;

async function loadArchive(): Promise<RawEvent[]> {
  const r = getRedis();
  if (!r) return memArchive;
  return ((await r.get<RawEvent[]>(ARCHIVE_KEY)) ?? []) as RawEvent[];
}

async function saveArchive(events: RawEvent[]) {
  memArchive = events;
  g.__cogRepArchive = events;
  const r = getRedis();
  if (r) await r.set(ARCHIVE_KEY, events);
}

function merge(a: RawEvent[], b: RawEvent[]): RawEvent[] {
  const m = new Map<string, RawEvent>();
  for (const e of [...a, ...b]) if (!m.has(e.id)) m.set(e.id, e);
  return [...m.values()].sort((x, y) => x.ledger - y.ledger || (x.id < y.id ? -1 : 1));
}

async function refresh(): Promise<void> {
  const net = mppNet();
  let archive = await loadArchive();
  const last = archive.length ? archive[archive.length - 1].ledger : 0;
  const recent = await fetchEscrowEvents(net, { fromLedger: last ? last + 1 : undefined });
  latestLedger = recent.toLedger;
  // A gap between what we hold and what RPC still serves: backfill from the archive source.
  if (!archive.length || last + 1 < recent.fromLedger) {
    archive = merge(archive, await fetchArchivedEvents(net, { beforeLedger: recent.fromLedger }));
  }
  archive = merge(archive, recent.raw);
  await saveArchive(archive);
  lastRefresh = Date.now();
}

export async function rawEscrowEvents(): Promise<{ events: RawEvent[]; latestLedger: number }> {
  if (Date.now() - lastRefresh > REFRESH_MS) {
    refreshing ??= refresh().finally(() => (refreshing = null));
    try {
      await refreshing;
    } catch (err) {
      console.error("[reputation] refresh failed; serving cached events", err);
    }
  }
  return { events: await loadArchive(), latestLedger };
}

/** Leaderboard for events up to `toLedger` (default: latest ledger RPC reported). */
export async function reputationReport(toLedger?: number): Promise<ReputationReport> {
  const net = mppNet();
  const { events, latestLedger: latest } = await rawEscrowEvents();
  const to = Math.min(toLedger ?? latest, latest || Number.MAX_SAFE_INTEGER);
  const from = events.length ? events[0].ledger : to;
  const decoded = events.map(decodeRawEvent).filter((e): e is NonNullable<typeof e> => e !== null);
  return deriveReputation(decoded, { contractId: net.escrowContractId, fromLedger: from, toLedger: to });
}
