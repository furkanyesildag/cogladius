import { describe, it, expect } from "vitest";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { commitmentBytes, verifyCommitment, CommitmentLedger } from "../../src/payments/provider.js";
import { JsonFileStore, MemoryStore } from "../../src/payments/store.js";
// @stellar/mpp's own check that commitment bytes bind channel, amount and network.
// @ts-ignore deep import of an internal module, used only as a reference implementation
import { assertCommitmentBinds } from "../../node_modules/@stellar/mpp/dist/channel/commitment.js";
import { MAINNET_PASSPHRASE, TESTNET_PASSPHRASE } from "../../src/network.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

const channel = StrKey.encodeContract(Buffer.alloc(32, 7));

describe("commitment bytes", () => {
  it("are what @stellar/mpp expects to sign", () => {
    for (const amount of [0n, 1n, 12_345_678n, (1n << 64n) + 5n]) {
      expect(() =>
        assertCommitmentBinds(commitmentBytes(MAINNET_PASSPHRASE, channel, amount), { channel, amount, network: "stellar:pubnet" })
      ).not.toThrow();
    }
    expect(() =>
      assertCommitmentBinds(commitmentBytes(TESTNET_PASSPHRASE, channel, 5n), { channel, amount: 5n, network: "stellar:pubnet" })
    ).toThrow();
  });

  it("verify only for the right key, amount and network", () => {
    const kp = Keypair.random();
    const sig = kp.sign(commitmentBytes(MAINNET_PASSPHRASE, channel, 100n)).toString("hex");
    expect(verifyCommitment(MAINNET_PASSPHRASE, channel, kp.publicKey(), 100n, sig)).toBe(true);
    expect(verifyCommitment(MAINNET_PASSPHRASE, channel, kp.publicKey(), 101n, sig)).toBe(false);
    expect(verifyCommitment(TESTNET_PASSPHRASE, channel, kp.publicKey(), 100n, sig)).toBe(false);
    expect(verifyCommitment(MAINNET_PASSPHRASE, channel, Keypair.random().publicKey(), 100n, sig)).toBe(false);
    expect(verifyCommitment(MAINNET_PASSPHRASE, channel, kp.publicKey(), 100n, "zz")).toBe(false);
  });
});

describe("CommitmentLedger (highest commitment store)", () => {
  it("keeps only the highest commitment: stale and replayed ones never overwrite it", async () => {
    const l = new CommitmentLedger(new MemoryStore());
    expect((await l.record(channel, 300n, "a".repeat(128))).kept).toBe(true);
    expect((await l.record(channel, 200n, "b".repeat(128))).kept).toBe(false); // stale
    expect((await l.record(channel, 300n, "c".repeat(128))).kept).toBe(false); // replay / equal
    expect((await l.highest(channel))!.signature).toBe("a".repeat(128));
    expect((await l.record(channel, 301n, "d".repeat(128))).kept).toBe(true);
  });

  it("refuses new commitments once the channel is closed", async () => {
    const l = new CommitmentLedger(new MemoryStore());
    await l.record(channel, 10n, "a".repeat(128));
    await l.markClosed(channel, "HASH");
    expect((await l.record(channel, 20n, "b".repeat(128))).kept).toBe(false);
  });

  it("stays monotonic under concurrent writers on the file store and survives a restart", async () => {
    const path = join(tmpdir(), `cog-ledger-${process.pid}-${Date.now()}.json`);
    const l = new CommitmentLedger(new JsonFileStore(path));
    const amounts = Array.from({ length: 50 }, (_, i) => BigInt((i * 37) % 50 + 1));
    await Promise.all(amounts.map((a) => l.record(channel, a, a.toString(16).padStart(128, "0"))));
    const reopened = new CommitmentLedger(new JsonFileStore(path));
    expect((await reopened.highest(channel))!.amount).toBe("50");
  });
});
