import { NextRequest, NextResponse } from "next/server";
import { StrKey } from "@stellar/stellar-sdk";
import { IS_MAINNET } from "@/lib/constants";
import { SWAP_ASSETS, type SwapAssetCode } from "@/lib/swapAssets";

/**
 * Server-side proxy for the Soroswap aggregator API, so SOROSWAP_API_KEY never
 * reaches the browser. Only XLM <-> USDC is allowed, which keeps the key from
 * being used as an open relay for arbitrary pairs.
 *
 *   { action: "quote", from: "XLM"|"USDC", to: ..., amount: "<stroops>", tradeType }
 *   { action: "build", quote, address }   -> { xdr } (unsigned; user signs it)
 *
 * The signed transaction is submitted by the browser straight to Horizon, so
 * this route never relays arbitrary transactions.
 *
 * API reference: https://api.soroswap.finance/docs
 */

const API = process.env.SOROSWAP_API_BASE || "https://api.soroswap.finance";
const NETWORK = IS_MAINNET ? "mainnet" : "testnet";
const PROTOCOLS = ["soroswap", "aqua", "phoenix", "sdex"];

async function soroswap(path: string, body: unknown) {
  const res = await fetch(`${API}${path}?network=${NETWORK}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SOROSWAP_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join(", ") : data?.message;
    throw new Error(msg || `Swap service error (${res.status}).`);
  }
  return data;
}

function isAsset(x: unknown): x is SwapAssetCode {
  return x === "XLM" || x === "USDC";
}

const allowedSacs = new Set(Object.values(SWAP_ASSETS).map((a) => a.sac));

export async function POST(req: NextRequest) {
  if (!process.env.SOROSWAP_API_KEY) {
    return NextResponse.json({ success: false, error: "Swaps are not enabled on this deployment." }, { status: 503 });
  }
  const body = await req.json().catch(() => null);
  try {
    switch (body?.action) {
      case "quote": {
        const { from, to, amount, tradeType } = body;
        if (!isAsset(from) || !isAsset(to) || from === to) throw new Error("Unsupported pair.");
        if (!/^[1-9]\d{0,18}$/.test(String(amount))) throw new Error("Invalid amount.");
        if (tradeType !== "EXACT_IN" && tradeType !== "EXACT_OUT") throw new Error("Invalid trade type.");
        const quote = await soroswap("/quote", {
          assetIn: SWAP_ASSETS[from].sac,
          assetOut: SWAP_ASSETS[to].sac,
          amount: String(amount),
          tradeType,
          protocols: PROTOCOLS,
          slippageBps: 100,
        });
        return NextResponse.json({ success: true, quote });
      }
      case "build": {
        const { quote, address } = body;
        if (typeof address !== "string" || !StrKey.isValidEd25519PublicKey(address)) throw new Error("Invalid address.");
        if (!allowedSacs.has(quote?.assetIn) || !allowedSacs.has(quote?.assetOut)) throw new Error("Unsupported pair.");
        const { xdr } = await soroswap("/quote/build", { quote, from: address, to: address });
        return NextResponse.json({ success: true, xdr });
      }
      default:
        return NextResponse.json({ success: false, error: "Unknown action." }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || "Swap failed." }, { status: 502 });
  }
}
