/**
 * Browser side of the Soroswap swap flow (XLM <-> USDC on the live network).
 *
 *   quote  -> /api/swap (server holds the Soroswap key)
 *   build  -> /api/swap returns an unsigned XDR for the user's own account
 *   sign   -> the connected wallet (Stellar Wallets Kit)
 *   submit -> Horizon, directly from the browser
 *
 * Receiving USDC needs a trustline; ensureTrustline adds it first if missing.
 */
import { Operation, TransactionBuilder, BASE_FEE } from "@stellar/stellar-sdk";
import { getServer, NETWORK_PASSPHRASE } from "@/lib/stellar";
import { signTransaction } from "@/lib/walletKit";
import { SWAP_ASSETS, SWAP_DECIMALS, type SwapAssetCode } from "@/lib/swapAssets";

export type SwapQuote = {
  assetIn: string;
  assetOut: string;
  amountIn: string;
  amountOut: string;
  otherAmountThreshold: string;
  tradeType: "EXACT_IN" | "EXACT_OUT";
  priceImpactPct: string;
  platform: string;
  [key: string]: unknown;
};

export function toStroops(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** SWAP_DECIMALS));
}

export function fromStroops(stroops: string | bigint): number {
  return Number(stroops) / 10 ** SWAP_DECIMALS;
}

async function callSwapApi(body: unknown) {
  const res = await fetch("/api/swap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!data?.success) throw new Error(data?.error || "Swap service unavailable.");
  return data;
}

export async function getSwapQuote(params: {
  from: SwapAssetCode;
  to: SwapAssetCode;
  amount: number;
  tradeType: "EXACT_IN" | "EXACT_OUT";
}): Promise<SwapQuote> {
  const { quote } = await callSwapApi({
    action: "quote",
    from: params.from,
    to: params.to,
    amount: toStroops(params.amount).toString(),
    tradeType: params.tradeType,
  });
  return quote as SwapQuote;
}

/** Balance of `code` on the account, or null when the USDC trustline is missing. */
export async function fetchSwapBalance(address: string, code: SwapAssetCode): Promise<number | null> {
  const account = await getServer().loadAccount(address);
  const line = account.balances.find((b: any) =>
    code === "XLM"
      ? b.asset_type === "native"
      : b.asset_code === "USDC" && b.asset_issuer === SWAP_ASSETS.USDC.asset.getIssuer()
  );
  return line ? parseFloat(line.balance) : null;
}

async function signAndSubmit(xdr: string, address: string): Promise<string> {
  const signed = await signTransaction(xdr, { networkPassphrase: NETWORK_PASSPHRASE, address });
  if (signed.error) throw new Error(signed.error);
  const tx = TransactionBuilder.fromXDR(signed.signedTxXdr, NETWORK_PASSPHRASE);
  const result = await getServer().submitTransaction(tx as any);
  return result.hash;
}

/** Add the USDC trustline if the account lacks it. Returns the tx hash, or null if none was needed. */
export async function ensureUsdcTrustline(address: string): Promise<string | null> {
  if ((await fetchSwapBalance(address, "USDC")) !== null) return null;
  const server = getServer();
  const account = await server.loadAccount(address);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.changeTrust({ asset: SWAP_ASSETS.USDC.asset }))
    .setTimeout(180)
    .build();
  return signAndSubmit(tx.toXDR(), address);
}

/** Build the swap for `address`, have the wallet sign it, and submit it. */
export async function executeSwap(quote: SwapQuote, address: string): Promise<string> {
  const { xdr } = await callSwapApi({ action: "build", quote, address });
  return signAndSubmit(xdr, address);
}
