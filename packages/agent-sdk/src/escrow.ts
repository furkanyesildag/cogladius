/**
 * Client for the deployed Cogladius escrow contract (read calls, posting a
 * reward, refunds). The contract is not modified or redeployed by the SDK; it
 * only calls the functions the live contract already exposes.
 */

import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { randomInt } from "node:crypto";
import type { NetworkConfig } from "./network.js";
import type { AgentSigner } from "./signer.js";
import { invoke, prepareInvocation, simulateRead, type InvokeResult } from "./soroban.js";

export type EscrowStatus = "Open" | "Active" | "Completed" | "Disputed" | "Refunded";
const STATUS: EscrowStatus[] = ["Open", "Active", "Completed", "Disputed", "Refunded"];

export interface EscrowTask {
  taskId: bigint;
  poster: string;
  /** Reward in stroops of the reward asset. */
  reward: bigint;
  /** Unix seconds. */
  deadline: number;
  status: EscrowStatus;
  winner: string | null;
}

export interface EscrowConfig {
  admin: string;
  rewardAsset: string;
  verdictPublicKeyHex: string;
  passThreshold: number;
  settleGraceSeconds: number;
  paused: boolean;
}

export class EscrowClient {
  constructor(readonly net: NetworkConfig) {
    if (!net.escrowContractId) throw new Error("NetworkConfig.escrowContractId is not set");
  }

  get contractId(): string {
    return this.net.escrowContractId;
  }

  async getTask(taskId: bigint | number): Promise<EscrowTask | null> {
    const raw = await simulateRead(this.net, this.contractId, "get_task", [u64(taskId)]);
    if (!raw) return null;
    const s = Array.isArray(raw.status) ? raw.status[0] : raw.status;
    return {
      taskId: BigInt(taskId),
      poster: String(raw.poster),
      reward: BigInt(raw.reward),
      deadline: Number(raw.deadline),
      status: typeof s === "number" ? STATUS[s] : (s as EscrowStatus),
      winner: raw.winner ? String(raw.winner) : null,
    };
  }

  async getConfig(): Promise<EscrowConfig> {
    const raw = await simulateRead(this.net, this.contractId, "get_config");
    return {
      admin: String(raw.admin),
      rewardAsset: String(raw.usdc_sac),
      verdictPublicKeyHex: Buffer.from(raw.verdict_pubkey).toString("hex"),
      passThreshold: Number(raw.pass_threshold),
      settleGraceSeconds: Number(raw.settle_grace ?? 0),
      paused: !!raw.paused,
    };
  }

  /** A random task id that is not yet used in the escrow. */
  async freeTaskId(): Promise<bigint> {
    for (let i = 0; i < 5; i++) {
      // 2^47 keeps ids JSON-safe for the HTTP API while making collisions negligible.
      const id = BigInt(randomInt(1, 2 ** 47));
      if (!(await this.getTask(id))) return id;
    }
    throw new Error("could not find a free task id");
  }

  postTaskArgs(poster: string, p: { taskId: bigint; reward: bigint; deadline: number }): xdr.ScVal[] {
    if (p.reward <= 0n) throw new Error("reward must be positive");
    return [new Address(poster).toScVal(), u64(p.taskId), i128(p.reward), u64(p.deadline)];
  }

  /** Lock `reward` stroops in the escrow for a new task (poster pays the fee). */
  async postTask(poster: AgentSigner, p: { taskId: bigint; reward: bigint; deadline: number }): Promise<InvokeResult> {
    await poster.authorizeSpend({
      amount: p.reward,
      asset: this.net.rewardAssetContractId,
      recipient: this.contractId,
      purpose: "escrow-post",
    });
    return invoke(this.net, poster, this.contractId, "post_task", this.postTaskArgs(poster.publicKey, p));
  }

  /**
   * Prepare a fee-sponsored post: `sponsorPublicKey` is the transaction source
   * and pays the fee; the poster only signs the Soroban authorization entry.
   * Returns the signed auth entries (base64 XDR) for the sponsor to submit.
   */
  async signSponsoredPost(
    poster: AgentSigner,
    sponsorPublicKey: string,
    p: { taskId: bigint; reward: bigint; deadline: number }
  ): Promise<string[]> {
    await poster.authorizeSpend({
      amount: p.reward,
      asset: this.net.rewardAssetContractId,
      recipient: this.contractId,
      purpose: "escrow-post",
    });
    const { signedAuth } = await prepareInvocation(
      this.net,
      sponsorPublicKey,
      this.contractId,
      "post_task",
      this.postTaskArgs(poster.publicKey, p),
      poster
    );
    if (!signedAuth.length) throw new Error("simulation returned no auth entry for the poster");
    return signedAuth.map((e) => e.toXDR("base64"));
  }

  /** Refund a task's reward to its poster (see the contract's refund rules). */
  async refund(caller: AgentSigner, taskId: bigint | number): Promise<InvokeResult> {
    return invoke(this.net, caller, this.contractId, "refund", [u64(taskId)]);
  }
}

export const u64 = (v: bigint | number) => nativeToScVal(BigInt(v), { type: "u64" });
export const i128 = (v: bigint | number) => nativeToScVal(BigInt(v), { type: "i128" });
