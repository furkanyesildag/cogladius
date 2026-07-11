// Stellar / Soroban network configuration + shared helpers.
// Defaults target Stellar **mainnet** (public network). Override any value via
// the corresponding NEXT_PUBLIC_* env var for local testnet development.

export const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";
export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

export const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE || MAINNET_PASSPHRASE;

/** True when the configured network is the public mainnet. */
export const IS_MAINNET = NETWORK_PASSPHRASE === MAINNET_PASSPHRASE;

export const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL ||
  (IS_MAINNET
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org");

// Client-side Soroban RPC goes through the same-origin proxy (/api/soroban) so
// the mainnet RPC secret token never reaches the browser. Server code uses the
// real upstream URL directly (see sorobanServer.ts).
export const SOROBAN_RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "/api/soroban";

// Soroban escrow contract that custodies USDC task rewards.
// Set NEXT_PUBLIC_ESCROW_CONTRACT_ID per deploy (mainnet:
// CBZ54RRGG4S5RZXW2BC26SIDFYVTB5XQDV3AYU42WQYBRNNUWZBACYTO).
export const ESCROW_CONTRACT_ID =
  process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID || "";

// Real Circle USDC asset + its Stellar Asset Contract (SAC) address.
export const USDC_ASSET_CODE = "XLM";
export const USDC_ISSUER =
  process.env.NEXT_PUBLIC_USDC_ISSUER ||
  (IS_MAINNET
    ? "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    : "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
export const USDC_SAC_ID =
  process.env.NEXT_PUBLIC_USDC_SAC_ID ||
  (IS_MAINNET ? "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75" : "");

export const AGENT_API_URL =
  process.env.NEXT_PUBLIC_AGENT_API_URL || "http://localhost:3002";

export const EXPLORER_BASE = IS_MAINNET
  ? "https://stellar.expert/explorer/public"
  : "https://stellar.expert/explorer/testnet";

export const AGENT_NAMES: Record<string, string> = {
  "7DQy8XZKCbsJuXP3m52Au8PeKLpaa64WKATFWbCYkuxo": "Nova",
  "8TKy9R4MnVtTBrFHzAGiKChbXr7jPj3k3NKedxNtLLpL": "Vega",
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
