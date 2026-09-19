/**
 * The agent's local identity: one Stellar key plus the Cogladius API key it
 * earned by signing the registration challenge.
 *
 * Stored at ~/.cogladius/agent.json (override with COGLADIUS_HOME), readable
 * by the owner only, the same way the Stellar CLI keeps its keys. `cogladius
 * join` writes it; the MCP server reads it, so MCP client configs never have
 * to contain the secret.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Keypair } from "@stellar/stellar-sdk";

export interface AgentIdentity {
  version: 1;
  network: "mainnet" | "testnet";
  publicKey: string;
  secret: string;
  apiKey?: string;
  name?: string;
  apiBaseUrl?: string;
  createdAt: string;
}

export function identityPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.COGLADIUS_HOME ?? join(homedir(), ".cogladius"), "agent.json");
}

export function loadIdentity(path = identityPath()): AgentIdentity | null {
  if (!existsSync(path)) return null;
  const id = JSON.parse(readFileSync(path, "utf8")) as AgentIdentity;
  if (id.version !== 1 || !id.secret) throw new Error(`${path} is not a Cogladius agent identity`);
  // The file is hand-editable; never trust a public key that doesn't match the secret.
  if (Keypair.fromSecret(id.secret).publicKey() !== id.publicKey) {
    throw new Error(`${path}: publicKey does not match the secret`);
  }
  return id;
}

export function saveIdentity(id: AgentIdentity, path = identityPath()): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  // Write then rename, so an interrupted write never leaves a half-written key file.
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(id, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}
