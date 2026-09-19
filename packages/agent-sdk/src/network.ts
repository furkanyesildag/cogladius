/**
 * Network presets. Mainnet is the default because that is where the Cogladius
 * escrow runs; every field can be overridden, so the same SDK works against a
 * testnet deployment or a local one.
 */

export const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";
export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

export interface NetworkConfig {
  /** Short name used in logs and for MPP network ids. */
  name: "mainnet" | "testnet" | "custom";
  networkPassphrase: string;
  /** Soroban RPC endpoint. Mainnet has no free public default; pass your own. */
  rpcUrl: string;
  horizonUrl: string;
  /** Cogladius HTTP API base (registration, tasks, submissions, MPP resources). */
  apiBaseUrl: string;
  /** Soroban escrow contract that holds task rewards. */
  escrowContractId: string;
  /** SEP-41 token the escrow pays rewards in (native XLM SAC on mainnet). */
  rewardAssetContractId: string;
  /** Human-readable code for the reward asset. */
  rewardAssetCode: string;
  /** one-way-channel factory used to open MPP payment sessions. */
  channelFactoryId?: string;
  /** Wasm hash of the unmodified upstream one-way-channel contract. */
  channelWasmHash?: string;
  explorerBaseUrl: string;
}

/** Upstream stellar-experimental/one-way-channel @ 25dea1b, built with stellar-cli 27. */
export const UPSTREAM_CHANNEL_WASM_HASH =
  "d6717aa80e0a1e6f5e6e6b5a8a4c00219ecbd1d3c5be61a44134324dd56e7df2";

export const MAINNET: NetworkConfig = {
  name: "mainnet",
  networkPassphrase: MAINNET_PASSPHRASE,
  rpcUrl: "https://soroban-rpc.mainnet.stellar.gateway.fm",
  horizonUrl: "https://horizon.stellar.org",
  apiBaseUrl: "https://www.cogladius.xyz",
  escrowContractId: "CAC5EDF76M5LY43BNHT47Y5NZRHO4ZRH7SRFPNHATGNKN2DI3SNK75PL",
  rewardAssetContractId: "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA",
  rewardAssetCode: "XLM",
  /** Upstream one-way-channel factory, deployed unmodified (admin: the Cogladius admin key). */
  channelFactoryId: "CBYNO7HQDG63ZFQJDSXVODOT5C5OFC767E33UOXW7BPEDKFPY3WEY7TF",
  channelWasmHash: UPSTREAM_CHANNEL_WASM_HASH,
  explorerBaseUrl: "https://stellar.expert/explorer/public",
};

export const TESTNET: NetworkConfig = {
  name: "testnet",
  networkPassphrase: TESTNET_PASSPHRASE,
  rpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
  apiBaseUrl: "http://localhost:3000",
  escrowContractId: "",
  rewardAssetContractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  rewardAssetCode: "XLM",
  channelWasmHash: UPSTREAM_CHANNEL_WASM_HASH,
  explorerBaseUrl: "https://stellar.expert/explorer/testnet",
};

export function resolveNetwork(
  base: NetworkConfig | "mainnet" | "testnet" = "mainnet",
  overrides: Partial<NetworkConfig> = {}
): NetworkConfig {
  const preset = typeof base === "string" ? (base === "testnet" ? TESTNET : MAINNET) : base;
  const out = { ...preset, ...stripUndefined(overrides) };
  out.apiBaseUrl = out.apiBaseUrl.replace(/\/+$/, "");
  return out;
}

/** MPP network id for this config. */
export function mppNetworkId(net: NetworkConfig): "stellar:pubnet" | "stellar:testnet" {
  return net.networkPassphrase === MAINNET_PASSPHRASE ? "stellar:pubnet" : "stellar:testnet";
}

export function explorerTx(net: NetworkConfig, hash: string): string {
  return `${net.explorerBaseUrl}/tx/${hash}`;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Stellar assets use 7 decimals. */
export const DECIMALS = 7;

export function toStroops(amount: number | string): bigint {
  const s = typeof amount === "number" ? amount.toFixed(DECIMALS) : amount.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`invalid amount: ${amount}`);
  const [whole, frac = ""] = s.split(".");
  if (frac.length > DECIMALS && /[1-9]/.test(frac.slice(DECIMALS))) {
    throw new Error(`amount has more than ${DECIMALS} decimals: ${amount}`);
  }
  return BigInt(whole) * 10n ** BigInt(DECIMALS) + BigInt((frac + "0".repeat(DECIMALS)).slice(0, DECIMALS));
}

export function fromStroops(stroops: bigint | string | number): string {
  const v = BigInt(stroops);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / 10n ** BigInt(DECIMALS);
  const frac = (abs % 10n ** BigInt(DECIMALS)).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}
