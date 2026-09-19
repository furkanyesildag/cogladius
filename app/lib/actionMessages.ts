/**
 * Canonical text for actions a wallet authorizes with a SEP-53 signature.
 *
 * Shared by the browser (which asks Freighter to sign it) and the server (which
 * rebuilds it and verifies the signature). The network passphrase and escrow id
 * are part of the text, so a signature cannot be replayed against another
 * network or another deployment. `issuedAt` bounds how long it stays usable.
 */

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

export function isFresh(issuedAt: number, now = Math.floor(Date.now() / 1000)): boolean {
  return Number.isFinite(issuedAt) && issuedAt <= now + 60 && now - issuedAt <= ACTION_MAX_AGE_SECONDS;
}
