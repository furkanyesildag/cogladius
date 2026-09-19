import { describe, it, expect } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { KeypairSigner, ScopedSigner, SpendLimitError, sep53Digest, verifySep53 } from "../../src/signer.js";

describe("SEP-53", () => {
  it("matches the SEP-53 reference vector", async () => {
    // Test vector from SEP-53 (stellar-protocol/ecosystem/sep-0053.md).
    const kp = Keypair.fromSecret("SAKICEVQLYWGSOJS4WW7HZJWAHZVEEBS527LHK5V4MLJALYKICQCJXMW");
    const sig = kp.sign(sep53Digest("Hello, World!"));
    expect(Buffer.from(sig).toString("base64")).toBe(
      "fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA=="
    );
  });

  it("round-trips through KeypairSigner and rejects other keys and messages", async () => {
    const s = KeypairSigner.random();
    const sig = await s.signMessage("cogladius");
    expect(verifySep53(s.publicKey, "cogladius", sig)).toBe(true);
    expect(verifySep53(s.publicKey, "cogladius!", sig)).toBe(false);
    expect(verifySep53(Keypair.random().publicKey(), "cogladius", sig)).toBe(false);
  });
});

describe("ScopedSigner", () => {
  const base = { asset: "C_ASSET", recipient: "G_PROVIDER" };

  it("enforces per-payment and lifetime limits and counts spend", async () => {
    const s = new ScopedSigner(KeypairSigner.random(), { maxPerPayment: 100n, maxTotal: 250n });
    await s.authorizeSpend({ ...base, amount: 100n, purpose: "mpp-charge" });
    await s.authorizeSpend({ ...base, amount: 100n, purpose: "mpp-charge" });
    await expect(s.authorizeSpend({ ...base, amount: 101n, purpose: "mpp-charge" })).rejects.toBeInstanceOf(SpendLimitError);
    await expect(s.authorizeSpend({ ...base, amount: 60n, purpose: "mpp-charge" })).rejects.toThrow(/total spend/);
    expect(s.spent).toBe(200n);
  });

  it("caps session deposits separately and does not double count commitments", async () => {
    const s = new ScopedSigner(KeypairSigner.random(), { maxSessionDeposit: 50_000_000n, maxTotal: 60_000_000n, maxPerPayment: 1_000_000n });
    await expect(s.authorizeSpend({ ...base, amount: 50_000_001n, purpose: "mpp-session-deposit" })).rejects.toThrow(/session deposit/);
    await s.authorizeSpend({ ...base, amount: 50_000_000n, purpose: "mpp-session-deposit" });
    for (let i = 0; i < 100; i++) await s.authorizeSpend({ ...base, amount: 100_000n, purpose: "mpp-session-commitment" });
    expect(s.spent).toBe(50_000_000n);
  });

  it("restricts recipients and authorized contracts", async () => {
    const s = new ScopedSigner(KeypairSigner.random(), { allowedRecipients: ["G_OK"], allowedContracts: ["C_ESCROW"] });
    await expect(s.authorizeSpend({ asset: "C", recipient: "G_BAD", amount: 1n, purpose: "mpp-charge" })).rejects.toThrow(/recipient/);
    const preimage: any = { toXDR: () => Buffer.alloc(1) };
    await expect(s.signAuthEntry(preimage, { contractId: "C_OTHER", functionName: "transfer", args: [] })).rejects.toThrow(/not allowed/);
    await expect(s.signAuthEntry(preimage, { contractId: "C_ESCROW", functionName: "post_task", args: [] })).resolves.toHaveLength(64);
  });
});
