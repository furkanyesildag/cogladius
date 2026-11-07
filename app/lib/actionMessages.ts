/**
 * Canonical text for actions a wallet authorizes with a SEP-53 signature.
 *
 * Shared by the browser (which asks Freighter to sign it) and the server (which
 * rebuilds it and verifies the signature). The network passphrase and escrow id
 * are part of the text, so a signature cannot be replayed against another
 * network or another deployment. `issuedAt` bounds how long it stays usable.
 */

import { hash } from "@stellar/stellar-sdk";
import { ESCROW_CONTRACT_ID, NETWORK_PASSPHRASE } from "@/lib/constants";

/** A signed action is accepted for this many seconds after `issuedAt`. */
export const ACTION_MAX_AGE_SECONDS = 600;

export function settleMessage(taskId: number, winnerAddress: string, issuedAt: number): string {
  return [
    "Cogladius: release escrowed reward",
    `network: ${NETWORK_PASSPHRASE}`,
    `escrow: ${ESCROW_CONTRACT_ID}`,
    `task: ${taskId}`,
    `winner: ${winnerAddress}`,
    `issued: ${issuedAt}`,
  ].join("\n");
}

export function disputeMessage(taskId: number, issuedAt: number): string {
  return [
    "Cogladius: dispute settled task",
    `network: ${NETWORK_PASSPHRASE}`,
    `escrow: ${ESCROW_CONTRACT_ID}`,
    `task: ${taskId}`,
    `issued: ${issuedAt}`,
  ].join("\n");
}

/**
 * Registration challenge. The service issues `nonce`; the agent signs this text
 * with the key it claims, proving it holds that key before any credential is
 * issued. The agent SDK builds the identical string.
 */
export function registrationMessage(pubkey: string, nonce: string): string {
  return [
    "Cogladius agent registration",
    `network: ${NETWORK_PASSPHRASE}`,
    `agent: ${pubkey}`,
    `nonce: ${nonce}`,
  ].join("\n");
}

/** A task's minQualifierScore is an integer from 1 to 100. */
export function isMinQualifierScore(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 100;
}

/** sha256 hex of the description and criteria. JSON keeps the boundary between them unambiguous. */
export function taskContentHash(description: string, criteria: string): string {
  return hash(Buffer.from(JSON.stringify([description, criteria]), "utf8")).toString("hex");
}

/**
 * Publishing the off-chain record of an escrowed task. It binds everything the
 * chain does not hold, so nobody who reads `poster` from the chain can publish a
 * different record first. It carries no timestamp on purpose: it is signed before
 * the reward is locked and one escrow id can hold only one record, so it fits
 * this exact content for this exact task and nothing else.
 */
export function taskRecordMessage(d: {
  contractTaskId: number;
  poster: string;
  description: string;
  criteria: string;
  gladiatorOnly: boolean;
  minQualifierScore?: number;
}): string {
  return [
    "Cogladius: publish escrowed task record",
    `network: ${NETWORK_PASSPHRASE}`,
    `escrow: ${ESCROW_CONTRACT_ID}`,
    `task: ${d.contractTaskId}`,
    `poster: ${d.poster}`,
    `content-sha256: ${taskContentHash(d.description, d.criteria)}`,
    `gladiator-only: ${d.gladiatorOnly}`,
    `min-qualifier-score: ${d.minQualifierScore ?? "none"}`,
  ].join("\n");
}

/** Deleting the record of a gated task. */
export function deleteTaskMessage(contractTaskId: number, issuedAt: number): string {
  return [
    "Cogladius: delete task record",
    `network: ${NETWORK_PASSPHRASE}`,
    `escrow: ${ESCROW_CONTRACT_ID}`,
    `task: ${contractTaskId}`,
    `issued: ${issuedAt}`,
  ].join("\n");
}

export function isFresh(issuedAt: number, now = Math.floor(Date.now() / 1000)): boolean {
  return Number.isFinite(issuedAt) && issuedAt <= now + 60 && now - issuedAt <= ACTION_MAX_AGE_SECONDS;
}
