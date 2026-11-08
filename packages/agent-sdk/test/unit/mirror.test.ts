import { describe, it, expect } from "vitest";
import { Address } from "@stellar/stellar-sdk";
import { MAINNET } from "../../src/network.js";
import { fetchMirroredEvents, type RawEvent } from "../../src/reputation/events.js";

const C = MAINNET.escrowContractId;
const ev: RawEvent = { id: "0272702321326788608-0000000001", ledger: 63493457, txHash: "aa".repeat(32), contractId: C, topics: [], value: "" };
const contractParam = new Address(C).toScVal().toXDR("base64");

function fakeFetch(op: Record<string, unknown>, events: RawEvent[] = [ev]) {
  return (async (url: string) => {
    if (url.includes("/api/reputation/events")) return new Response(JSON.stringify({ success: true, contractId: C, events }));
    if (url.endsWith("/operations/272702321326788609")) return new Response(JSON.stringify(op));
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

const goodOp = { type: "invoke_host_function", transaction_hash: ev.txHash, transaction_successful: true, parameters: [{ type: "Address", value: contractParam }] };

describe("fetchMirroredEvents", () => {
  it("accepts mirror events that Horizon confirms", async () => {
    const out = await fetchMirroredEvents(MAINNET, { fetch: fakeFetch(goodOp) });
    expect(out).toHaveLength(1);
    expect(out[0].txHash).toBe(ev.txHash);
  });

  it("drops events at or after beforeLedger", async () => {
    const out = await fetchMirroredEvents(MAINNET, { fetch: fakeFetch(goodOp), beforeLedger: ev.ledger });
    expect(out).toHaveLength(0);
  });

  it("refuses an event whose tx hash does not match Horizon", async () => {
    await expect(fetchMirroredEvents(MAINNET, { fetch: fakeFetch({ ...goodOp, transaction_hash: "bb".repeat(32) }) })).rejects.toThrow(/does not match Horizon/);
  });

  it("refuses an event from a failed transaction or another contract", async () => {
    await expect(fetchMirroredEvents(MAINNET, { fetch: fakeFetch({ ...goodOp, transaction_successful: false }) })).rejects.toThrow(/does not match Horizon/);
    const other = new Address("CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE").toScVal().toXDR("base64");
    await expect(fetchMirroredEvents(MAINNET, { fetch: fakeFetch({ ...goodOp, parameters: [{ type: "Address", value: other }] }) })).rejects.toThrow(/does not match Horizon/);
  });
});
