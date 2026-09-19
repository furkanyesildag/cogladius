import { describe, it, expect } from "vitest";
import { Address, Keypair, StrKey, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { relaySponsoredPostTask, RelayRejected, RpcError, resolveNetwork } from "../../src/index.js";

const escrow = StrKey.encodeContract(Buffer.alloc(32, 1));
const asset = StrKey.encodeContract(Buffer.alloc(32, 2));
const other = StrKey.encodeContract(Buffer.alloc(32, 3));
// Unreachable RPC: a request that passes every offline check fails with RpcError.
const net = resolveNetwork("mainnet", { escrowContractId: escrow, rewardAssetContractId: asset, rpcUrl: "http://127.0.0.1:9" });
const poster = Keypair.random().publicKey();

function call(contract: string, fn: string, args: xdr.ScVal[], subs: xdr.SorobanAuthorizedInvocation[] = []) {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({ contractAddress: new Address(contract).toScAddress(), functionName: fn, args })
    ),
    subInvocations: subs,
  });
}

function entry(signer: string, root: xdr.SorobanAuthorizedInvocation, kind: "v1" | "v2" | "delegates" = "v1") {
  const creds = new xdr.SorobanAddressCredentials({
    address: new Address(signer).toScAddress(),
    nonce: xdr.Int64.fromString("1"),
    signatureExpirationLedger: 100,
    signature: xdr.ScVal.scvVoid(),
  });
  const X: any = xdr;
  const credentials =
    kind === "v1"
      ? xdr.SorobanCredentials.sorobanCredentialsAddress(creds)
      : kind === "v2"
        ? X.SorobanCredentials.sorobanCredentialsAddressV2(creds)
        : X.SorobanCredentials.sorobanCredentialsAddressWithDelegates(
            new X.SorobanAddressCredentialsWithDelegates({ addressCredentials: creds, delegates: [] })
          );
  return new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation: root }).toXDR("base64");
}

const postArgs = (reward = 10_000_000n) => [
  new Address(poster).toScVal(),
  nativeToScVal(7n, { type: "u64" }),
  nativeToScVal(reward, { type: "i128" }),
  nativeToScVal(1_900_000_000n, { type: "u64" }),
];
const transfer = (to = escrow, amount = 10_000_000n, token = asset) =>
  call(token, "transfer", [new Address(poster).toScVal(), new Address(to).toScVal(), nativeToScVal(amount, { type: "i128" })]);
const request = (authEntries: string[]) => ({ poster, taskId: "7", reward: "10000000", deadline: 1_900_000_000, authEntries });
const relay = (authEntries: string[]) =>
  relaySponsoredPostTask({ net, relayer: Keypair.random(), request: request(authEntries), maxFeeStroops: 2_000_000 });

describe("sponsored post_task relayer", () => {
  it("passes a well-formed entry through to the network", async () => {
    await expect(relay([entry(poster, call(escrow, "post_task", postArgs(), [transfer()]))])).rejects.toBeInstanceOf(RpcError);
  });

  it("accepts CAP-71 AddressV2 credentials (what mainnet RPC now records)", async () => {
    await expect(relay([entry(poster, call(escrow, "post_task", postArgs(), [transfer()]), "v2")])).rejects.toBeInstanceOf(RpcError);
  });

  it("rejects delegated credentials", async () => {
    const err = await relay([entry(poster, call(escrow, "post_task", postArgs(), [transfer()]), "delegates")]).catch((e) => e);
    expect(err).toBeInstanceOf(RelayRejected);
    expect(err.code).toBe("auth_delegates");
  });

  const cases: [string, string[], string][] = [
    ["no entries", [], "auth_count"],
    ["two entries", [entry(poster, call(escrow, "post_task", postArgs())), entry(poster, call(escrow, "post_task", postArgs()))], "auth_count"],
    ["entry for someone else", [entry(Keypair.random().publicKey(), call(escrow, "post_task", postArgs(), [transfer()]))], "auth_signer"],
    ["another contract", [entry(poster, call(other, "post_task", postArgs(), [transfer()]))], "auth_target"],
    ["another function", [entry(poster, call(escrow, "refund", postArgs(), [transfer()]))], "auth_target"],
    ["different reward than requested", [entry(poster, call(escrow, "post_task", postArgs(99n), [transfer()]))], "auth_args"],
    ["transfer to an attacker", [entry(poster, call(escrow, "post_task", postArgs(), [transfer(other)]))], "auth_nested"],
    ["transfer of another token", [entry(poster, call(escrow, "post_task", postArgs(), [transfer(escrow, 10_000_000n, other)]))], "auth_nested"],
    ["larger transfer", [entry(poster, call(escrow, "post_task", postArgs(), [transfer(escrow, 20_000_000n)]))], "auth_nested"],
    ["garbage xdr", ["AAAA"], "auth_xdr"],
  ];
  for (const [name, entries, code] of cases) {
    it(`rejects ${name}`, async () => {
      const err = await relay(entries).catch((e) => e);
      expect(err).toBeInstanceOf(RelayRejected);
      expect(err.code).toBe(code);
    });
  }
});
