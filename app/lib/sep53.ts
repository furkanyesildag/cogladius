/**
 * SEP-53 message signing (https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md).
 *
 * A signed message is `ed25519_sign(sha256("Stellar Signed Message:\n" || message))`.
 * Freighter's `signMessage` produces exactly this, and so does the agent SDK, so
 * one verifier covers both wallets and headless agents.
 *
 * Server-side only (uses node:crypto).
 */

import { createHash } from "crypto";
import { Keypair } from "@stellar/stellar-sdk";

const SEP53_PREFIX = "Stellar Signed Message:\n";

export function sep53Hash(message: string | Buffer): Buffer {
  const body = typeof message === "string" ? Buffer.from(message, "utf8") : message;
  return createHash("sha256")
    .update(Buffer.concat([Buffer.from(SEP53_PREFIX, "utf8"), body]))
    .digest();
}

/** Decode a signature sent as base64 (Freighter v4, SDK) or hex. */
function decodeSignature(sig: string): Buffer | null {
  const s = sig.trim();
  if (/^[0-9a-fA-F]{128}$/.test(s)) return Buffer.from(s, "hex");
  try {
    const b = Buffer.from(s, "base64");
    return b.length === 64 ? b : null;
  } catch {
    return null;
  }
}

/** True when `signature` is a valid SEP-53 signature of `message` by `pubkey`. */
export function verifySep53(pubkey: string, message: string, signature: string): boolean {
  const sig = decodeSignature(String(signature || ""));
  if (!sig) return false;
  try {
    return Keypair.fromPublicKey(pubkey).verify(sep53Hash(message), sig);
  } catch {
    return false;
  }
}
