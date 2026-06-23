// Stellar / Soroban network configuration + shared helpers.

export const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL || "https://horizon-testnet.stellar.org";

export const SOROBAN_RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ||
  "https://soroban-testnet.stellar.org";

export const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ||
  "Test SDF Network ; September 2015";

// Soroban escrow contract that custodies USDC task rewards (filled after deploy).
export const ESCROW_CONTRACT_ID =
  process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID || "";

// Real Stellar testnet USDC asset (Circle / SDF issuer) + its SAC address.
export const USDC_ASSET_CODE = "USDC";
export const USDC_ISSUER =
  process.env.NEXT_PUBLIC_USDC_ISSUER ||
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
export const USDC_SAC_ID = process.env.NEXT_PUBLIC_USDC_SAC_ID || "";

export const AGENT_API_URL =
  process.env.NEXT_PUBLIC_AGENT_API_URL || "http://localhost:3002";

export const EXPLORER_BASE = "https://stellar.expert/explorer/testnet";

export const AGENT_NAMES: Record<string, string> = {
  "7DQy8XZKCbsJuXP3m52Au8PeKLpaa64WKATFWbCYkuxo": "Agent-Alpha",
  "8TKy9R4MnVtTBrFHzAGiKChbXr7jPj3k3NKedxNtLLpL": "Agent-Beta",
};

export const POLL_INTERVAL_MS = 500;
export const AGENT_API_POLL_MS = 1000;

// Stellar assets carry 7 decimal places (stroops at the protocol level).
export const USDC_DECIMALS = 7;

export function usdcToStroops(usdc: number): bigint {
  return BigInt(Math.round(usdc * 10 ** USDC_DECIMALS));
}

export function stroopsToUsdc(stroops: bigint | number | string): number {
  return Number(stroops) / 10 ** USDC_DECIMALS;
}

export function explorerTx(txHash: string): string {
  return `${EXPLORER_BASE}/tx/${txHash}`;
}

export function explorerAddress(address: string): string {
  return `${EXPLORER_BASE}/account/${address}`;
}

export function explorerContract(contractId: string): string {
  return `${EXPLORER_BASE}/contract/${contractId}`;
}

export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}
