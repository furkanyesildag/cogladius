/**
 * MPP provider wiring for the Cogladius app (server-only).
 *
 * Charge mode: @stellar/mpp charge server, unmodified. Each paid call is one
 * SEP-41 transfer of native XLM to the provider account, settled on-chain.
 *
 * Session mode: @stellar/mpp channel server, unmodified, one instance per
 * channel. Before a channel is served it is checked on-chain with the SDK's
 * `verifyChannel`: it must run the unmodified upstream one-way-channel wasm,
 * pay this provider, hold native XLM, hold at most MPP_CHANNEL_MAX_DEPOSIT
 * (default 5 XLM — the channel contract is unaudited), and give at least two
 * days to react to a unilateral close. Every accepted commitment is also written
 * to the durable highest-commitment ledger, which is what the close path uses.
 *
 * Env:
 *   MPP_SECRET_KEY              HMAC secret for challenge ids (required)
 *   MPP_PROVIDER_SECRET         provider account (receives payments, signs closes)
 *   MPP_CHANNEL_MAX_DEPOSIT     XLM, default 5
 *   MPP_CHANNEL_FACTORY_ID      upstream channel factory the SDK opens sessions through
 *   MPP_CHANNEL_WASM_HASH       default: upstream one-way-channel @ 25dea1b
 */

import { Keypair } from "@stellar/stellar-sdk";
import { Mppx as ChargeMppx, stellar as chargeStellar } from "@stellar/mpp/charge/server";
import { Mppx as ChannelMppx, stellar as channelStellar } from "@stellar/mpp/channel/server";
import { Store } from "mppx";
import { resolveNetwork, toStroops, UPSTREAM_CHANNEL_WASM_HASH, type NetworkConfig } from "@cogladius/agent-sdk/network";
import { verifyChannel, CommitmentLedger, type ChannelInfo } from "@cogladius/agent-sdk/payments/provider";
import { ESCROW_CONTRACT_ID, IS_MAINNET, NETWORK_PASSPHRASE, USDC_SAC_ID } from "@/lib/constants";
import { atomicStore, addToSet } from "./store";

export const CHANNEL_INDEX_KEY = "cogladius:mpp:channels";
// ~2 days of ledgers: the sweeper runs daily (Vercel cron), so a funder's
// unilateral close is always answered well before it becomes refundable.
export const MIN_REFUND_WAITING_PERIOD = 34_560;

function serverRpcUrl(): string {
  const u = process.env.SOROBAN_RPC_URL_SERVER || process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "";
  if (!/^https?:\/\//.test(u)) throw new Error("SOROBAN_RPC_URL_SERVER is not configured");
  return u;
}

export function mppNet(): NetworkConfig {
  return resolveNetwork(IS_MAINNET ? "mainnet" : "testnet", {
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: serverRpcUrl(),
    escrowContractId: ESCROW_CONTRACT_ID,
    rewardAssetContractId: USDC_SAC_ID,
    channelFactoryId: process.env.MPP_CHANNEL_FACTORY_ID || undefined,
    channelWasmHash: process.env.MPP_CHANNEL_WASM_HASH || UPSTREAM_CHANNEL_WASM_HASH,
  });
}

export function mppConfigured(): boolean {
  return !!(process.env.MPP_SECRET_KEY && process.env.MPP_PROVIDER_SECRET && USDC_SAC_ID);
}

export function providerKeypair(): Keypair {
  const s = process.env.MPP_PROVIDER_SECRET;
  if (!s) throw new Error("MPP_PROVIDER_SECRET is not configured");
  return Keypair.fromSecret(s);
}

export function channelPolicy() {
  const net = mppNet();
  return {
    recipient: providerKeypair().publicKey(),
    token: net.rewardAssetContractId,
    wasmHash: net.channelWasmHash!,
    maxDeposit: toStroops(process.env.MPP_CHANNEL_MAX_DEPOSIT || "5"),
    minRefundWaitingPeriod: MIN_REFUND_WAITING_PERIOD,
  };
}

function networkId() {
  return IS_MAINNET ? ("stellar:pubnet" as const) : ("stellar:testnet" as const);
}

function mppxStore() {
  const s = atomicStore("cogladius:mppx:");
  return Store.from(s as any) as any;
}

// MPP_DEBUG=1 prints @stellar/mpp's structured logs (settlement result codes etc.).
const debugLogger = {
  debug: (...a: unknown[]) => console.log("[mpp:debug]", ...a),
  info: (...a: unknown[]) => console.log("[mpp:info]", ...a),
  warn: (...a: unknown[]) => console.warn("[mpp:warn]", ...a),
  error: (...a: unknown[]) => console.error("[mpp:error]", ...a),
};

let charge: any = null;
export function chargeServer(): any {
  if (!charge) {
    const net = mppNet();
    charge = ChargeMppx.create({
      secretKey: process.env.MPP_SECRET_KEY!,
      methods: [
        chargeStellar.charge({
          recipient: providerKeypair().publicKey(),
          currency: net.rewardAssetContractId,
          network: networkId(),
          rpcUrl: net.rpcUrl,
          store: mppxStore(),
          // Sponsored + fee-bumped: the @stellar/mpp client builds with the
          // 100-stroop base inclusion fee, which mainnet rejects when Soroban
          // fees are above the minimum. The provider re-sources the transaction
          // and wraps it in a fee bump it pays for; each payment (0.01 XLM)
          // exceeds the fee, so sponsorship cannot be farmed at a loss.
          feePayer: { envelopeSigner: providerKeypair(), feeBumpSigner: providerKeypair() },
          maxFeeBumpStroops: 2_000_000,
          ...(process.env.MPP_DEBUG ? { logger: debugLogger } : {}),
        }),
      ],
    } as any);
  }
  return charge;
}

const channelServers = new Map<string, { mppx: any; info: ChannelInfo; checkedAt: number }>();
const VERIFY_TTL_MS = 30_000;

/**
 * Channel server for `channel`, after verifying the channel on-chain (cached
 * briefly). Throws ChannelRejected for channels this provider will not serve.
 */
export async function channelServer(channel: string): Promise<{ mppx: any; info: ChannelInfo }> {
  const hit = channelServers.get(channel);
  if (hit && Date.now() - hit.checkedAt < VERIFY_TTL_MS) return hit;
  const net = mppNet();
  const info = await verifyChannel(net, channel, channelPolicy());
  const mppx =
    hit?.mppx ??
    ChannelMppx.create({
      secretKey: process.env.MPP_SECRET_KEY!,
      methods: [
        channelStellar.channel({
          channel,
          commitmentKey: info.commitmentKey,
          recipient: info.to,
          currency: info.token,
          network: networkId(),
          rpcUrl: net.rpcUrl,
          store: mppxStore(),
          checkOnChainState: true,
        }),
      ],
    } as any);
  await addToSet(CHANNEL_INDEX_KEY, channel);
  const entry = { mppx, info, checkedAt: Date.now() };
  channelServers.set(channel, entry);
  return entry;
}

export function commitmentLedger(): CommitmentLedger {
  return new CommitmentLedger(atomicStore("cogladius:mpp:ledger:"), "highest");
}
