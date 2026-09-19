/**
 * Capture the reputation conformance fixture: every event of the live mainnet
 * escrow up to a fixed ledger, as raw XDR with tx hashes, plus the report the
 * derivation rule produces from it.
 *
 *   npx tsx scripts/capture-fixture.ts [toLedger]
 *
 * Re-running with the same toLedger must reproduce both files byte for byte.
 */
import { writeFileSync } from "node:fs";
import { MAINNET } from "../src/network.js";
import { fetchArchivedEvents, decodeRawEvent } from "../src/reputation/events.js";
import { deriveReputation } from "../src/reputation/derive.js";

const TO_LEDGER = Number(process.argv[2] ?? 64_400_000);

const raw = await fetchArchivedEvents(MAINNET, { beforeLedger: TO_LEDGER + 1 });
const fromLedger = raw.length ? raw[0].ledger : TO_LEDGER;
const fixture = {
  network: MAINNET.networkPassphrase,
  contractId: MAINNET.escrowContractId,
  fromLedger,
  toLedger: TO_LEDGER,
  source: "api.stellar.expert contract events (raw XDR) + horizon /operations/{toid} for tx hashes",
  events: raw,
};
const report = deriveReputation(
  raw.map(decodeRawEvent).filter((e): e is NonNullable<typeof e> => e !== null),
  { contractId: MAINNET.escrowContractId, fromLedger, toLedger: TO_LEDGER }
);
writeFileSync(new URL("../test/fixtures/mainnet-escrow-events.json", import.meta.url), JSON.stringify(fixture, null, 2) + "\n");
writeFileSync(new URL("../test/fixtures/mainnet-escrow-report.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(`captured ${raw.length} events, ledgers ${fromLedger}..${TO_LEDGER}; ${report.agents.length} agents, market`, report.market);
