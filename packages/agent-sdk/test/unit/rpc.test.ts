import { describe, it, expect } from "vitest";
import { withRetry, RpcError } from "../../src/soroban.js";
import { toStroops, fromStroops } from "../../src/network.js";

describe("RPC gap handling", () => {
  it("retries transient failures and then succeeds", async () => {
    let n = 0;
    const v = await withRetry("t", async () => {
      if (++n < 3) throw Object.assign(new Error("fetch failed"), {});
      return 42;
    });
    expect(v).toBe(42);
    expect(n).toBe(3);
  });

  it("does not retry a 4xx and surfaces an RpcError", async () => {
    let n = 0;
    await expect(
      withRetry("t", async () => {
        n++;
        throw Object.assign(new Error("bad request"), { response: { status: 400 } });
      })
    ).rejects.toBeInstanceOf(RpcError);
    expect(n).toBe(1);
  });

  it("gives up after the attempt budget on a persistent outage", async () => {
    let n = 0;
    await expect(
      withRetry("t", async () => {
        n++;
        throw Object.assign(new Error("503"), { response: { status: 503 } });
      }, 3)
    ).rejects.toThrow(/t: 503/);
    expect(n).toBe(3);
  });
});

describe("amounts", () => {
  it("converts without floating point error", () => {
    expect(toStroops("0.0000001")).toBe(1n);
    expect(toStroops("5")).toBe(50_000_000n);
    expect(toStroops(0.1 + 0.2)).toBe(3_000_000n);
    expect(fromStroops(12_345_678n)).toBe("1.2345678");
    expect(fromStroops(50_000_000n)).toBe("5");
    expect(() => toStroops("1.00000001")).toThrow();
  });
});
