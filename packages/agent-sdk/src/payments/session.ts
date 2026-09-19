/**
 * MPP session mode: one funded payment channel carries many off-chain
 * cumulative commitments and settles in a single close transaction.
 *
 * What is used unmodified:
 *   - @stellar/mpp: 402 challenge/response, commitment format, commitment
 *     signing and cumulative accounting (the channel client).
 *   - stellar-experimental/one-way-channel: the channel contract, deployed from
 *     its upstream wasm through the upstream channel factory.
 *
 * What this module adds (the agent side):
 *   - opening a channel through the factory with a fresh, single-purpose
 *     commitment key, so the key that signs commitments can spend at most the
 *     channel deposit and never touches the agent's account;
 *   - persisting the session (channel id, commitment key, deposit) so a
 *     restarted agent can keep paying on the same channel;
 *   - recovery when the local commitment baseline is lost (see `fetch`);
 *   - asking the provider to close, and the funder's own exit when the
 *     provider never closes (`startClose` then `refund`).
 */

import { Address, Keypair, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { randomBytes } from "node:crypto";
import { Mppx, stellar } from "@stellar/mpp/channel/client";
import { Store } from "mppx";
import { Receipt } from "mppx";
import type { NetworkConfig } from "../network.js";
import { fromStroops, mppNetworkId } from "../network.js";
import type { AgentSigner } from "../signer.js";
import { invoke, simulateRead, latestLedger, type InvokeResult } from "../soroban.js";
import { JsonFileStore, type AtomicKV } from "./store.js";

/** Default refund waiting period: ~2 days of ledgers (the Cogladius provider requires at least this). */
export const DEFAULT_REFUND_WAITING_PERIOD = 34_560;

export interface SessionRecord {
  channel: string;
  network: string;
  funder: string;
  recipient: string;
  token: string;
  deposit: string; // stroops
  refundWaitingPeriod: number;
  commitmentSecret: string;
  openTxHash: string;
  openedAt: string;
  /** Highest cumulative amount this agent has signed (stroops). */
  signed: string;
  closeTxHash?: string;
  closedAt?: string;
}

export interface SessionPayment {
  response: Response;
  /** Cumulative amount committed after this request (stroops). */
  cumulative: bigint;
  /** Amount this request cost (stroops). */
  paid: bigint;
  receipt?: { reference: string; status: string };
}

export class SessionError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "SessionError";
  }
}

const key = (channel: string) => `session:${channel}`;

export class PaymentSession {
  readonly net: NetworkConfig;
  readonly signer: AgentSigner;
  #rec: SessionRecord;
  #store: AtomicKV;
  #mppx: ReturnType<typeof Mppx.create>;
  #lastChallenge: { amount: bigint; cumulative: bigint } | null = null;

  private constructor(net: NetworkConfig, signer: AgentSigner, rec: SessionRecord, store: AtomicKV) {
    this.net = net;
    this.signer = signer;
    this.#rec = rec;
    this.#store = store;
    this.#mppx = this.#buildClient();
  }

  get record(): Readonly<SessionRecord> {
    return this.#rec;
  }

  get channel(): string {
    return this.#rec.channel;
  }

  /**
   * Open a channel funded with `deposit` stroops, payable to `recipient`, via
   * the upstream channel factory. The deposit goes through the signer's spend
   * policy first.
   */
  static async open(opts: {
    net: NetworkConfig;
    signer: AgentSigner;
    recipient: string;
    deposit: bigint;
    token?: string;
    refundWaitingPeriod?: number;
    store?: AtomicKV;
  }): Promise<PaymentSession> {
    const { net, signer } = opts;
    if (!net.channelFactoryId) throw new SessionError("NetworkConfig.channelFactoryId is not set", "no_factory");
    const token = opts.token ?? net.rewardAssetContractId;
    const rwp = opts.refundWaitingPeriod ?? DEFAULT_REFUND_WAITING_PERIOD;
    await signer.authorizeSpend({ amount: opts.deposit, asset: token, recipient: opts.recipient, purpose: "mpp-session-deposit" });

    const commitment = Keypair.random();
    const salt = randomBytes(32);
    const res = await invoke(net, signer, net.channelFactoryId, "open", [
      nativeToScVal(salt, { type: "bytes" }),
      new Address(token).toScVal(),
      new Address(signer.publicKey).toScVal(),
      nativeToScVal(commitment.rawPublicKey(), { type: "bytes" }),
      new Address(opts.recipient).toScVal(),
      nativeToScVal(opts.deposit, { type: "i128" }),
      nativeToScVal(rwp, { type: "u32" }),
    ]);
    const channel = String(res.returnValue);
    if (!channel.startsWith("C")) throw new SessionError(`factory returned an unexpected value: ${channel}`, "open_failed");

    const rec: SessionRecord = {
      channel,
      network: net.networkPassphrase,
      funder: signer.publicKey,
      recipient: opts.recipient,
      token,
      deposit: opts.deposit.toString(),
      refundWaitingPeriod: rwp,
      commitmentSecret: commitment.secret(),
      openTxHash: res.hash,
      openedAt: new Date().toISOString(),
      signed: "0",
    };
    const store = opts.store ?? new JsonFileStore();
    await store.put(key(channel), rec);
    return new PaymentSession(net, signer, rec, store);
  }

  /** Resume a session opened earlier (commitment key and baseline come from the store). */
  static async resume(opts: { net: NetworkConfig; signer: AgentSigner; channel: string; store?: AtomicKV }): Promise<PaymentSession> {
    const store = opts.store ?? new JsonFileStore();
    const rec = (await store.get(key(opts.channel))) as SessionRecord | null;
    if (!rec) throw new SessionError(`no stored session for ${opts.channel}`, "not_found");
    if (rec.network !== opts.net.networkPassphrase) throw new SessionError("stored session is for another network", "wrong_network");
    return new PaymentSession(opts.net, opts.signer, rec, store);
  }

  #buildClient() {
    const commitmentKey = Keypair.fromSecret(this.#rec.commitmentSecret);
    // Client-side cumulative baseline, kept in the same durable store.
    const baseline = Store.from({
      get: async (k: string) => this.#store.get(`mppc:${k}`),
      put: async (k: string, v: unknown) => this.#store.put(`mppc:${k}`, v),
      delete: async (k: string) => this.#store.delete(`mppc:${k}`),
      update: async (k: string, fn: any) => this.#store.update(`mppc:${k}`, fn),
    } as any);
    return Mppx.create({
      polyfill: false,
      methods: [
        stellar.channel({
          commitmentKey,
          rpcUrl: this.net.rpcUrl,
          allowedChannels: [this.#rec.channel],
          network: mppNetworkId(this.net),
          store: baseline as any,
        }),
      ],
      onChallenge: async (challenge: any, { createCredential }: any) => {
        if (challenge.method !== "stellar" || challenge.intent !== "channel") return undefined;
        const req = challenge.request ?? {};
        if (req.channel !== this.#rec.channel) {
          throw new SessionError(`provider asked to pay on ${req.channel}, session is ${this.#rec.channel}`, "wrong_channel");
        }
        const amount = BigInt(req.amount);
        this.#lastChallenge = { amount, cumulative: BigInt(req.methodDetails?.cumulativeAmount ?? "0") };
        const next = BigInt(this.#rec.signed) + amount;
        if (next > BigInt(this.#rec.deposit)) {
          throw new SessionError(
            `session exhausted: ${fromStroops(next)} would exceed the ${fromStroops(this.#rec.deposit)} deposit`,
            "exhausted"
          );
        }
        await this.signer.authorizeSpend({ amount, asset: this.#rec.token, recipient: this.#rec.recipient, purpose: "mpp-session-commitment" });
        return createCredential();
      },
    } as any);
  }

  /**
   * Fetch a paid resource over this session. The provider learns which
   * channel to charge from the `x-mpp-channel` header.
   *
   * Recovery: if the local commitment baseline was lost while the session
   * record survived, the provider rejects the new, lower commitment as
   * non-monotonic. The session then re-signs once from the provider's reported
   * cumulative, but only when that value lies between what this session knows
   * it signed and that plus one request (a crash between signing and
   * persisting), and the result still fits in the deposit. A provider can
   * therefore never talk the agent into committing more than it was served.
   * If the whole store is lost the commitment key is gone with it; the funds
   * are still safe and come back through `startClose` + `refund`, which only
   * need the agent's own key.
   */
  async fetch(url: string, init: RequestInit = {}): Promise<SessionPayment> {
    const headers = new Headers(init.headers);
    headers.set("x-mpp-channel", this.#rec.channel);
    const before = BigInt(this.#rec.signed);
    this.#lastChallenge = null;
    let response = await this.#mppx.fetch(url, { ...init, headers });

    const challenge = this.#lastChallenge as { amount: bigint; cumulative: bigint } | null;
    if (response.status === 402 && challenge) {
      const decision = recoveryBaseline({
        local: await this.#readBaseline(),
        recorded: before,
        serverCumulative: challenge.cumulative,
        amount: challenge.amount,
        deposit: BigInt(this.#rec.deposit),
      });
      if (decision !== null) {
        await this.#store.put(`mppc:${this.#baselineKey()}`, { amount: decision.toString() });
        response = await this.#mppx.fetch(url, { ...init, headers });
      }
    }

    // The provider could not verify the commitment for a transient reason (for
    // example an RPC node it asked returned XDR its SDK cannot decode). Retry
    // once. Commitments are cumulative, so the retry's commitment also covers
    // the rejected one; at worst the provider is paid one extra request, and
    // it can never close for more than the highest commitment it accepted.
    if (response.status === 402 && (await isVerificationFailure(response.clone()))) {
      console.warn("[cogladius] session: provider could not verify the commitment; retrying once");
      await new Promise((r) => setTimeout(r, 750));
      response = await this.#mppx.fetch(url, { ...init, headers });
    }

    const after = await this.#readBaseline();
    const cumulative = after > before ? after : before;
    if (cumulative !== before) await this.#persistSigned(cumulative);
    let receipt: SessionPayment["receipt"];
    try {
      const r = Receipt.fromResponse(response) as any;
      receipt = { reference: r.reference, status: r.status };
    } catch {}
    return { response, cumulative, paid: cumulative - before, receipt };
  }

  #baselineKey(): string {
    // @stellar/mpp's client-side baseline key for this channel and network.
    return `stellar:channel:client:${mppNetworkId(this.net)}:${this.#rec.channel}:cumulative`;
  }

  async #readBaseline(): Promise<bigint> {
    const v = await this.#store.get(`mppc:${this.#baselineKey()}`);
    return v?.amount ? BigInt(v.amount) : 0n;
  }

  async #persistSigned(v: bigint) {
    this.#rec = { ...this.#rec, signed: v.toString() };
    await this.#store.update(key(this.#rec.channel), (cur: any) => ({
      op: "set",
      value: { ...(cur ?? this.#rec), signed: BigInt(cur?.signed ?? 0) > v ? cur.signed : v.toString() },
      result: undefined,
    }));
  }

  /** On-chain state: balance, withdrawn, and whether a close has started. */
  async state(): Promise<{ balance: bigint; deposited: bigint; withdrawn: bigint; signed: bigint }> {
    const [balance, deposited, withdrawn] = await Promise.all([
      simulateRead(this.net, this.#rec.channel, "balance"),
      simulateRead(this.net, this.#rec.channel, "deposited"),
      simulateRead(this.net, this.#rec.channel, "withdrawn"),
    ]);
    return { balance: BigInt(balance), deposited: BigInt(deposited), withdrawn: BigInt(withdrawn), signed: BigInt(this.#rec.signed) };
  }

  /**
   * Ask the provider to close the channel with the highest commitment it holds.
   * The close pays the provider what was committed and refunds the rest to the
   * funder in the same transaction.
   */
  async requestClose(providerBaseUrl = this.net.apiBaseUrl): Promise<{ hash: string; amount: string }> {
    const issuedAt = Math.floor(Date.now() / 1000);
    const message = closeMessage(this.net.networkPassphrase, this.#rec.channel, issuedAt);
    const sig = await this.signer.signMessage(message);
    const res = await fetch(`${providerBaseUrl.replace(/\/+$/, "")}/api/mpp/session/close`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel: this.#rec.channel, issuedAt, signature: Buffer.from(sig).toString("base64") }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new SessionError(data.error || `close failed (HTTP ${res.status})`, "close_failed");
    await this.#markClosed(data.hash);
    return { hash: data.hash, amount: data.amount };
  }

  /** Funder's exit when the provider never closes: start the waiting period. */
  async startClose(): Promise<InvokeResult & { refundableAtLedger: number }> {
    const res = await invoke(this.net, this.signer, this.#rec.channel, "close_start", []);
    return { ...res, refundableAtLedger: res.ledger + this.#rec.refundWaitingPeriod };
  }

  /** After `startClose` and the waiting period, reclaim the remaining balance. */
  async refund(): Promise<InvokeResult> {
    const res = await invoke(this.net, this.signer, this.#rec.channel, "refund", []);
    await this.#markClosed(res.hash);
    return res;
  }

  async ledgersUntilRefund(startLedger: number): Promise<number> {
    return Math.max(0, startLedger + this.#rec.refundWaitingPeriod - (await latestLedger(this.net)));
  }

  async #markClosed(hash: string) {
    this.#rec = { ...this.#rec, closeTxHash: hash, closedAt: new Date().toISOString() };
    await this.#store.put(key(this.#rec.channel), this.#rec);
  }
}

/**
 * Decide whether to re-sign from the provider's reported cumulative after a
 * lost local baseline. Returns the baseline to adopt, or null to refuse.
 */
export function recoveryBaseline(p: {
  local: bigint;
  recorded: bigint;
  serverCumulative: bigint;
  amount: bigint;
  deposit: bigint;
}): bigint | null {
  const lost = p.local < p.serverCumulative;
  if (!lost) return null;
  if (p.serverCumulative < p.recorded) return null; // provider under-reports: its own loss, not ours to fix
  if (p.serverCumulative > p.recorded + p.amount) return null; // claims more than we could have signed
  if (p.serverCumulative + p.amount > p.deposit) return null;
  return p.serverCumulative;
}

async function isVerificationFailure(res: Response): Promise<boolean> {
  try {
    const body: any = await res.json();
    return typeof body?.type === "string" && body.type.endsWith("/verification-failed");
  } catch {
    return false;
  }
}

/** Text the funder signs (SEP-53) to ask the provider to close a channel. */
export function closeMessage(networkPassphrase: string, channel: string, issuedAt: number): string {
  return ["Cogladius: close payment channel", `network: ${networkPassphrase}`, `channel: ${channel}`, `issued: ${issuedAt}`].join("\n");
}

export type { xdr };
