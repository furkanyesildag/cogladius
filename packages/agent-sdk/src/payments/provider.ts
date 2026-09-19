/**
 * Provider (recipient) side of MPP session mode, for anyone selling data or
 * compute to agents over one-way channels.
 *
 * @stellar/mpp's channel server verifies each commitment and tracks the
 * cumulative amount, but it does not keep the commitment signature. Without
 * the signature a provider cannot close the channel on its own schedule (for
 * example when the funder starts a unilateral close). This module fills that
 * gap:
 *
 *   - `inspectChannel` / `verifyChannel`: read the channel's contract instance
 *     straight from the ledger (wasm hash, token, funder, recipient,
 *     commitment key, refund waiting period) and refuse channels that are not
 *     the unmodified upstream contract, pay someone else, use another token,
 *     exceed the deposit cap, or give too little time to react.
 *   - `CommitmentLedger`: durable, monotonic store of the highest commitment
 *     (amount + signature) seen per channel; a lower or equal commitment can
 *     never overwrite a higher one.
 *   - `commitmentBytes` / `verifyCommitment`: rebuild the exact bytes the
 *     channel contract verifies, so a stored signature is known to be closable.
 *   - `closeWithHighest`: close the channel with the stored highest commitment
 *     (own transaction path: correct fee bid and visible result codes).
 */

import { Address, Keypair, StrKey, rpc, xdr, scValToNative, hash, nativeToScVal } from "@stellar/stellar-sdk";
import type { NetworkConfig } from "../network.js";
import { rpcServer, simulateRead, withRetry, invoke } from "../soroban.js";
import { KeypairSigner } from "../signer.js";
import type { AtomicKV } from "./store.js";

export interface ChannelInfo {
  channel: string;
  wasmHash: string;
  token: string;
  from: string;
  to: string;
  /** Commitment verification key as a G-strkey (same encoding @stellar/mpp accepts). */
  commitmentKey: string;
  refundWaitingPeriod: number;
  /** Set once close_start or close ran. */
  closeEffectiveAtLedger: number | null;
  balance: bigint;
  deposited: bigint;
  withdrawn: bigint;
}

export class ChannelRejected extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "ChannelRejected";
  }
}

/** Read a channel's configuration from its contract instance entry. */
export async function inspectChannel(net: NetworkConfig, channel: string): Promise<ChannelInfo> {
  if (!StrKey.isValidContract(channel)) throw new ChannelRejected(`not a contract address: ${channel}`, "bad_address");
  const server = rpcServer(net);
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(channel).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    })
  );
  const res = await withRetry("getLedgerEntries", () => server.getLedgerEntries(key));
  const entry = res.entries?.[0];
  if (!entry) throw new ChannelRejected(`channel ${channel} not found`, "not_found");
  const instance = entry.val.contractData().val().instance();
  const exec = instance.executable();
  if (exec.switch().name !== "contractExecutableWasm") throw new ChannelRejected("channel is not a wasm contract", "not_wasm");
  const wasmHash = Buffer.from(exec.wasmHash()).toString("hex");

  const storage = new Map<string, any>();
  for (const e of instance.storage() ?? []) {
    const k = scValToNative(e.key());
    const name = Array.isArray(k) ? String(k[0]) : String(k);
    storage.set(name, e.val());
  }
  const need = (n: string) => {
    const v = storage.get(n);
    if (!v) throw new ChannelRejected(`channel storage has no ${n}`, "bad_storage");
    return v as xdr.ScVal;
  };
  const rawKey: Buffer = scValToNative(need("CommitmentKey"));
  const closeAt = storage.get("CloseEffectiveAtLedger");

  const [balance, deposited, withdrawn] = await Promise.all([
    simulateRead(net, channel, "balance"),
    simulateRead(net, channel, "deposited"),
    simulateRead(net, channel, "withdrawn"),
  ]);

  return {
    channel,
    wasmHash,
    token: String(scValToNative(need("Token"))),
    from: String(scValToNative(need("From"))),
    to: String(scValToNative(need("To"))),
    commitmentKey: StrKey.encodeEd25519PublicKey(Buffer.from(rawKey)),
    refundWaitingPeriod: Number(scValToNative(need("RefundWaitingPeriod"))),
    closeEffectiveAtLedger: closeAt ? Number(scValToNative(closeAt)) : null,
    balance: BigInt(balance),
    deposited: BigInt(deposited),
    withdrawn: BigInt(withdrawn),
  };
}

export interface ChannelPolicy {
  recipient: string;
  token: string;
  wasmHash: string;
  /** Refuse channels holding more than this (stroops). Bounds exposure to unaudited code. */
  maxDeposit: bigint;
  /** Refuse channels whose refund waiting period is shorter (ledgers). */
  minRefundWaitingPeriod: number;
}

export async function verifyChannel(net: NetworkConfig, channel: string, policy: ChannelPolicy): Promise<ChannelInfo> {
  const info = await inspectChannel(net, channel);
  if (info.wasmHash !== policy.wasmHash) {
    throw new ChannelRejected(`channel runs wasm ${info.wasmHash}, expected upstream ${policy.wasmHash}`, "wrong_wasm");
  }
  if (info.to !== policy.recipient) throw new ChannelRejected(`channel pays ${info.to}, not this provider`, "wrong_recipient");
  if (info.token !== policy.token) throw new ChannelRejected(`channel token ${info.token} is not ${policy.token}`, "wrong_token");
  if (info.deposited > policy.maxDeposit) {
    throw new ChannelRejected(`channel deposit ${info.deposited} exceeds the ${policy.maxDeposit} stroop cap`, "deposit_cap");
  }
  if (info.refundWaitingPeriod < policy.minRefundWaitingPeriod) {
    throw new ChannelRejected(
      `refund waiting period ${info.refundWaitingPeriod} is below the required ${policy.minRefundWaitingPeriod} ledgers`,
      "short_wait"
    );
  }
  if (info.closeEffectiveAtLedger !== null) throw new ChannelRejected("channel is closing or closed", "closing");
  return info;
}

/**
 * The bytes the channel contract signs over: XDR of
 * `ScMap{amount: i128, channel: Address, domain: Symbol("chancmmt"), network: BytesN<32>}`
 * with keys in sorted order.
 */
export function commitmentBytes(networkPassphrase: string, channel: string, amount: bigint): Buffer {
  const entry = (k: string, v: xdr.ScVal) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: v });
  const i128 = (v: bigint) =>
    xdr.ScVal.scvI128(
      new xdr.Int128Parts({
        hi: xdr.Int64.fromString((v >> 64n).toString()),
        lo: xdr.Uint64.fromString((v & ((1n << 64n) - 1n)).toString()),
      })
    );
  const map = xdr.ScVal.scvMap([
    entry("amount", i128(amount)),
    entry("channel", new Address(channel).toScVal()),
    entry("domain", xdr.ScVal.scvSymbol("chancmmt")),
    entry("network", xdr.ScVal.scvBytes(hash(Buffer.from(networkPassphrase)))),
  ]);
  return map.toXDR();
}

export function verifyCommitment(
  networkPassphrase: string,
  channel: string,
  commitmentKey: string,
  amount: bigint,
  signatureHex: string
): boolean {
  if (!/^[0-9a-fA-F]{128}$/.test(signatureHex)) return false;
  try {
    return Keypair.fromPublicKey(commitmentKey).verify(
      commitmentBytes(networkPassphrase, channel, amount),
      Buffer.from(signatureHex, "hex")
    );
  } catch {
    return false;
  }
}

export interface StoredCommitment {
  amount: string;
  signature: string; // hex
  recordedAt: string;
  closeTxHash?: string;
}

/** Durable highest-commitment store. `update()` of the backing store must be a real CAS. */
export class CommitmentLedger {
  constructor(private readonly store: AtomicKV, private readonly prefix = "cogladius:mpp:highest") {}

  key(channel: string) {
    return `${this.prefix}:${channel}`;
  }

  /**
   * Record a commitment if it is higher than the stored one. Returns the
   * highest commitment after the write and whether this one was kept.
   */
  record(channel: string, amount: bigint, signatureHex: string): Promise<{ kept: boolean; highest: StoredCommitment }> {
    return this.store.update<{ kept: boolean; highest: StoredCommitment }>(this.key(channel), (cur: StoredCommitment | null) => {
      if (cur?.closeTxHash) return { op: "noop", result: { kept: false, highest: cur } };
      if (cur && BigInt(cur.amount) >= amount) return { op: "noop", result: { kept: false, highest: cur } };
      const next: StoredCommitment = { amount: amount.toString(), signature: signatureHex, recordedAt: new Date().toISOString() };
      return { op: "set", value: next, result: { kept: true, highest: next } };
    });
  }

  async highest(channel: string): Promise<StoredCommitment | null> {
    return this.store.get(this.key(channel));
  }

  markClosed(channel: string, txHash: string): Promise<void> {
    return this.store.update(this.key(channel), (cur: StoredCommitment | null) => ({
      op: "set",
      value: { ...(cur ?? { amount: "0", signature: "", recordedAt: new Date().toISOString() }), closeTxHash: txHash },
      result: undefined,
    }));
  }
}

/**
 * Close a channel with the highest stored commitment. Pays the provider the
 * committed amount and refunds the remainder to the funder in one transaction.
 *
 * Built with the SDK's own invocation path rather than @stellar/mpp's
 * `close()`: that helper bids the 100-stroop minimum inclusion fee, which
 * mainnet rejects whenever Soroban fees are above the floor, and it does not
 * surface the rejection code. Here the fee is simulated and the result code is
 * reported. The channel requires `to.require_auth()`; the provider is the
 * transaction source, so its envelope signature satisfies it.
 */
export async function closeWithHighest(
  net: NetworkConfig,
  ledger: CommitmentLedger,
  channel: string,
  feePayer: Keypair
): Promise<{ hash: string; amount: bigint }> {
  const top = await ledger.highest(channel);
  if (!top || top.closeTxHash) throw new ChannelRejected("no open commitment to close with", "nothing_to_close");
  const amount = BigInt(top.amount);
  const res = await invoke(net, new KeypairSigner(feePayer), channel, "close", [
    nativeToScVal(amount, { type: "i128" }),
    nativeToScVal(Buffer.from(top.signature, "hex"), { type: "bytes" }),
  ]);
  await ledger.markClosed(channel, res.hash);
  return { hash: res.hash, amount };
}

export type { rpc };
