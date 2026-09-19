/**
 * Conformance: the derivation rule over a fixed, archived range of the live
 * mainnet escrow's events must reproduce the committed report exactly.
 *
 * The fixture holds raw event XDR plus the tx hash of every event, so each
 * input can be checked on Stellar Expert; `scripts/capture-fixture.ts`
 * regenerates both files from chain data.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { decodeRawEvent, deriveReputation, MAINNET, type RawEvent } from "../../src/index.js";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/mainnet-escrow-events.json", import.meta.url), "utf8"));
const expected = readFileSync(new URL("../fixtures/mainnet-escrow-report.json", import.meta.url), "utf8");

describe("reputation conformance (mainnet escrow, fixed ledger range)", () => {
  it("fixture is for the live mainnet escrow", () => {
    expect(fixture.contractId).toBe(MAINNET.escrowContractId);
    expect(fixture.network).toBe(MAINNET.networkPassphrase);
    for (const e of fixture.events as RawEvent[]) {
      expect(e.txHash).toMatch(/^[0-9a-f]{64}$/);
      expect(e.ledger).toBeGreaterThanOrEqual(fixture.fromLedger);
      expect(e.ledger).toBeLessThanOrEqual(fixture.toLedger);
    }
  });

  it("every archived event decodes", () => {
    for (const e of fixture.events as RawEvent[]) expect(decodeRawEvent(e)).not.toBeNull();
  });

  it("reproduces the committed report byte for byte", () => {
    const events = (fixture.events as RawEvent[]).map(decodeRawEvent).filter((e) => e !== null);
    const report = deriveReputation(events as any, {
      contractId: fixture.contractId,
      fromLedger: fixture.fromLedger,
      toLedger: fixture.toLedger,
    });
    expect(JSON.stringify(report, null, 2) + "\n").toBe(expected);
  });
});
