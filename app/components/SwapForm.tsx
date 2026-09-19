"use client";

import { useEffect, useMemo, useState } from "react";
import { useStellar } from "@/lib/stellarContext";
import { EXPLORER_TX, parseHorizonError } from "@/lib/stellar";
import {
  ensureUsdcTrustline,
  executeSwap,
  fetchSwapBalance,
  fromStroops,
  getSwapQuote,
  type SwapQuote,
} from "@/lib/soroswap";
import type { SwapAssetCode } from "@/lib/swapAssets";

/**
 * XLM <-> USDC through Soroswap's aggregator (Soroswap, Aqua, Phoenix, SDEX).
 * USDC -> XLM tops a poster up for an XLM reward; XLM -> USDC lets a winning
 * agent cash out to a stablecoin.
 */

type Status =
  | { kind: "idle" }
  | { kind: "quoting" }
  | { kind: "trustline" }
  | { kind: "swapping" }
  | { kind: "success"; hash: string }
  | { kind: "error"; message: string };

const label: React.CSSProperties = {
  fontFamily: "var(--font)",
  fontSize: 10,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  marginBottom: 8,
  display: "block",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-base)",
  border: "1px solid var(--bg-border-bright)",
  borderRadius: 10,
  padding: "12px 14px",
  color: "var(--text-primary)",
  fontFamily: "var(--font)",
  fontSize: 13,
  outline: "none",
};

const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontFamily: "var(--font)",
  fontSize: 11,
  color: "var(--text-muted)",
  marginTop: 6,
};

export default function SwapForm({ initialFrom = "USDC" }: { initialFrom?: SwapAssetCode }) {
  const { state, refreshBalance } = useStellar();
  const address = state.connection?.address ?? "";
  const onNetwork = state.connection?.isTestnet ?? false;

  const [from, setFrom] = useState<SwapAssetCode>(initialFrom);
  const to: SwapAssetCode = from === "XLM" ? "USDC" : "XLM";
  const [amount, setAmount] = useState("");
  const [balance, setBalance] = useState<number | null | undefined>(undefined);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const busy = status.kind === "quoting" || status.kind === "trustline" || status.kind === "swapping";
  const value = parseFloat(amount);
  const amountOk = Number.isFinite(value) && value > 0;

  useEffect(() => {
    if (!address) return;
    setBalance(undefined);
    fetchSwapBalance(address, from).then(setBalance).catch(() => setBalance(null));
  }, [address, from, status.kind === "success"]);

  // Re-quote (debounced) whenever the pair or amount changes.
  useEffect(() => {
    setQuote(null);
    if (!amountOk) return;
    const id = setTimeout(async () => {
      setStatus({ kind: "quoting" });
      try {
        setQuote(await getSwapQuote({ from, to, amount: value, tradeType: "EXACT_IN" }));
        setStatus({ kind: "idle" });
      } catch (e: any) {
        setStatus({ kind: "error", message: e?.message || "No route found." });
      }
    }, 450);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, amount]);

  const insufficient = useMemo(
    () => amountOk && (balance === null || (typeof balance === "number" && value > balance)),
    [amountOk, balance, value]
  );

  async function handleSwap() {
    if (!quote || !address) return;
    try {
      if (to === "USDC") {
        setStatus({ kind: "trustline" });
        await ensureUsdcTrustline(address);
      }
      setStatus({ kind: "swapping" });
      const hash = await executeSwap(quote, address);
      setStatus({ kind: "success", hash });
      setAmount("");
      void refreshBalance(address);
    } catch (e: any) {
      setStatus({ kind: "error", message: e?.response ? parseHorizonError(e) : e?.message || "Swap failed." });
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(["USDC", "XLM"] as SwapAssetCode[]).map((code) => (
          <button
            key={code}
            onClick={() => { setFrom(code); setStatus({ kind: "idle" }); }}
            disabled={busy}
            style={{
              flex: 1,
              fontFamily: "var(--font)",
              fontSize: 11,
              fontWeight: 600,
              padding: "9px",
              borderRadius: 9,
              cursor: busy ? "not-allowed" : "pointer",
              background: from === code ? "var(--accent)" : "transparent",
              color: from === code ? "#fff" : "var(--text-primary)",
              border: from === code ? "none" : "1px solid var(--bg-border-bright)",
            }}
          >
            {code === "USDC" ? "USDC → XLM · fund tasks" : "XLM → USDC · cash out"}
          </button>
        ))}
      </div>

      <label style={label}>You pay ({from})</label>
      <input
        style={inputStyle}
        inputMode="decimal"
        placeholder="0.00"
        value={amount}
        onChange={(e) => setAmount(e.target.value.replace(",", "."))}
        disabled={busy}
      />
      <div style={row}>
        <span>Balance</span>
        <span>
          {balance === undefined
            ? "…"
            : balance === null
            ? "No USDC trustline yet"
            : `${balance.toLocaleString(undefined, { maximumFractionDigits: 7 })} ${from}`}
        </span>
      </div>

      <div
        style={{
          marginTop: 16,
          padding: "12px 14px",
          borderRadius: 10,
          background: "var(--bg-surface-low)",
          border: "1px solid var(--bg-border-bright)",
        }}
      >
        <div style={{ ...row, marginTop: 0 }}>
          <span>You receive ({to})</span>
          <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
            {status.kind === "quoting" ? "…" : quote ? fromStroops(quote.amountOut).toFixed(4) : "-"}
          </span>
        </div>
        {quote && (
          <>
            <div style={row}>
              <span>Minimum after 1% slippage</span>
              <span>{fromStroops(quote.otherAmountThreshold).toFixed(4)} {to}</span>
            </div>
            <div style={row}>
              <span>Price impact · route</span>
              <span>{Number(quote.priceImpactPct).toFixed(2)}% · {quote.platform}</span>
            </div>
          </>
        )}
      </div>

      <button
        onClick={handleSwap}
        disabled={!onNetwork || !quote || busy || insufficient}
        style={{
          width: "100%",
          marginTop: 16,
          fontFamily: "var(--font)",
          fontSize: 12,
          fontWeight: 700,
          padding: "12px",
          borderRadius: 10,
          border: "none",
          background: "var(--accent)",
          color: "#fff",
          cursor: !onNetwork || !quote || busy || insufficient ? "not-allowed" : "pointer",
          opacity: !onNetwork || !quote || busy || insufficient ? 0.5 : 1,
        }}
      >
        {status.kind === "trustline"
          ? "Adding USDC trustline…"
          : status.kind === "swapping"
          ? "Confirm in your wallet…"
          : insufficient
          ? `Not enough ${from}`
          : !onNetwork
          ? "Switch your wallet to the right network"
          : `Swap ${from} → ${to}`}
      </button>

      {status.kind === "success" && (
        <p style={{ ...row, color: "var(--green)", justifyContent: "center", marginTop: 12 }}>
          Swapped ·{" "}
          <a href={EXPLORER_TX(status.hash)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
            view transaction
          </a>
        </p>
      )}
      {status.kind === "error" && (
        <p style={{ ...row, color: "var(--accent-soft)", justifyContent: "center", marginTop: 12 }}>
          {status.message}
        </p>
      )}
      <p style={{ ...row, justifyContent: "center", marginTop: 14, fontSize: 10 }}>
        Routed by Soroswap across Soroswap, Aqua, Phoenix and the Stellar DEX.
      </p>
    </div>
  );
}
