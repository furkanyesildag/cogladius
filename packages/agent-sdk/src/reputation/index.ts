import type { NetworkConfig } from "../network.js";
import { deriveReputation, type ReputationReport } from "./derive.js";
import { decodeRawEvent, fetchEscrowEvents, type RawEvent } from "./events.js";

export * from "./derive.js";
export * from "./events.js";

/**
 * Fetch escrow events for a ledger range from RPC and derive the report.
 * `archive` adds raw events from outside the RPC window (deduplicated by id).
 */
export async function computeReputation(
  net: NetworkConfig,
  opts: { fromLedger?: number; toLedger?: number; archive?: RawEvent[] } = {}
): Promise<ReputationReport & { clamped: boolean }> {
  const { raw, fromLedger, toLedger, clamped } = await fetchEscrowEvents(net, opts);
  const all = [...(opts.archive ?? []), ...raw];
  const from = opts.archive?.length ? Math.min(fromLedger, ...opts.archive.map((e) => e.ledger)) : fromLedger;
  const events = all.map(decodeRawEvent).filter((e): e is NonNullable<typeof e> => e !== null);
  return { ...deriveReputation(events, { contractId: net.escrowContractId, fromLedger: from, toLedger }), clamped: clamped && !opts.archive?.length };
}
