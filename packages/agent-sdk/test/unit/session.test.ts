import { describe, it, expect } from "vitest";
import { recoveryBaseline, closeMessage } from "../../src/payments/session.js";
import { MAINNET_PASSPHRASE } from "../../src/network.js";

const deposit = 50_000_000n;

describe("session recovery after a lost commitment store", () => {
  it("adopts the provider's cumulative when it matches what we recorded", () => {
    expect(recoveryBaseline({ local: 0n, recorded: 400n, serverCumulative: 400n, amount: 100n, deposit })).toBe(400n);
  });

  it("tolerates exactly one request signed but not yet persisted", () => {
    expect(recoveryBaseline({ local: 0n, recorded: 400n, serverCumulative: 500n, amount: 100n, deposit })).toBe(500n);
  });

  it("refuses when the provider claims more than we could have signed", () => {
    expect(recoveryBaseline({ local: 0n, recorded: 400n, serverCumulative: 900n, amount: 100n, deposit })).toBeNull();
  });

  it("refuses when the provider under-reports (its loss, never a reason to re-sign lower)", () => {
    expect(recoveryBaseline({ local: 400n, recorded: 400n, serverCumulative: 100n, amount: 100n, deposit })).toBeNull();
  });

  it("refuses when the result would exceed the deposit", () => {
    expect(recoveryBaseline({ local: 0n, recorded: deposit - 50n, serverCumulative: deposit - 50n, amount: 100n, deposit })).toBeNull();
  });

  it("does nothing when the local baseline is intact (a replayed/rejected voucher is not a lost store)", () => {
    expect(recoveryBaseline({ local: 400n, recorded: 400n, serverCumulative: 400n, amount: 100n, deposit })).toBeNull();
  });

  it("binds the close request to network and channel", () => {
    const m = closeMessage(MAINNET_PASSPHRASE, "CABC", 1);
    expect(m).toContain(MAINNET_PASSPHRASE);
    expect(m).toContain("channel: CABC");
  });
});
