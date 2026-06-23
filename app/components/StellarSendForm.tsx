"use client";

import { useCallback, useMemo, useState } from "react";
import { useStellar } from "@/lib/stellarContext";
import {
  EXPLORER_TX,
  isValidStellarAddress,
  parseHorizonError,
  sendXlmPayment,
} from "@/lib/stellar";

type TxStatus =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "submitting" }
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

export default function StellarSendForm({
  onSent,
  compact = false,
}: {
  onSent?: () => void;
  compact?: boolean;
}) {
  const { state, refreshBalance } = useStellar();
  const { connection, balance } = state;
  const address = connection?.address ?? "";
  const isTestnet = connection?.isTestnet ?? false;

  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [tx, setTx] = useState<TxStatus>({ kind: "idle" });

  const busy = tx.kind === "signing" || tx.kind === "submitting";

  const amountError = useMemo(() => {
    if (!amount) return null;
    const n = Number(amount);
    if (Number.isNaN(n) || n <= 0) return "Enter a positive amount.";
    if (balance && n > Number(balance)) return "Amount exceeds your balance.";
    return null;
  }, [amount, balance]);

  const toError = useMemo(() => {
    if (!to) return null;
    if (!isValidStellarAddress(to)) return "Not a valid Stellar address (G…).";
    if (to.trim() === address) return "You can't send to your own address.";
    return null;
  }, [to, address]);

  const canSend =
    !!connection &&
    isTestnet &&
    !busy &&
    !!to &&
    !!amount &&
    !toError &&
    !amountError;

  const handleSend = useCallback(async () => {
    if (!connection) return;
    setTx({ kind: "signing" });
    try {
      const pending = sendXlmPayment({
        from: connection.address,
        to: to.trim(),
        amount: amount.trim(),
        memo,
      });
      setTx({ kind: "submitting" });
      const res = await pending;
      setTx({ kind: "success", hash: res.hash });
      setTo("");
      setAmount("");
      setMemo("");
      await refreshBalance(connection.address);
      onSent?.();
    } catch (e: any) {
      setTx({ kind: "error", message: parseHorizonError(e) });
    }
  }, [connection, to, amount, memo, refreshBalance, onSent]);

  if (!connection) return null;

  return (
    <div>
      {!isTestnet && (
        <div
          style={{
            marginBottom: 14,
            padding: 12,
            borderRadius: 10,
            border: "1px solid var(--accent)",
            background: "var(--accent-dim)",
            fontSize: 12,
            color: "var(--accent-soft)",
          }}
        >
          Switch Freighter to <strong>Testnet</strong> to send payments.
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <label style={label}>Destination address</label>
        <input
          style={{
            ...inputStyle,
            borderColor: toError ? "var(--accent)" : "var(--bg-border-bright)",
          }}
          placeholder="G… (recipient public key)"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        {toError && (
          <span
            style={{
              color: "var(--accent-soft)",
              fontSize: 11,
              marginTop: 6,
              display: "block",
            }}
          >
            {toError}
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 160px" }}>
          <label style={label}>Amount (XLM)</label>
          <input
            style={{
              ...inputStyle,
              borderColor: amountError
                ? "var(--accent)"
                : "var(--bg-border-bright)",
            }}
            placeholder="0.00"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          {amountError && (
            <span
              style={{
                color: "var(--accent-soft)",
                fontSize: 11,
                marginTop: 6,
                display: "block",
              }}
            >
              {amountError}
            </span>
          )}
        </div>
        {!compact && (
          <div style={{ flex: "1 1 160px" }}>
            <label style={label}>Memo (optional)</label>
            <input
              style={inputStyle}
              placeholder="e.g. coffee"
              maxLength={28}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </div>
        )}
      </div>

      {compact && (
        <div style={{ marginTop: 14 }}>
          <label style={label}>Memo (optional)</label>
          <input
            style={inputStyle}
            placeholder="e.g. coffee"
            maxLength={28}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>
      )}

      <button
        onClick={handleSend}
        disabled={!canSend}
        style={{
          marginTop: 18,
          width: "100%",
          fontFamily: "var(--font)",
          fontSize: 14,
          fontWeight: 600,
          padding: "13px",
          borderRadius: 12,
          cursor: canSend ? "pointer" : "not-allowed",
          background: canSend ? "var(--accent)" : "var(--bg-surface-high)",
          color: canSend ? "#fff" : "var(--text-muted)",
          border: "none",
          transition: "background 0.15s",
        }}
      >
        {tx.kind === "signing"
          ? "Waiting for signature…"
          : tx.kind === "submitting"
          ? "Submitting to network…"
          : "Send Payment"}
      </button>

      {tx.kind === "success" && (
        <div
          style={{
            marginTop: 16,
            padding: 14,
            borderRadius: 12,
            background: "var(--green-dim)",
            border: "1px solid var(--green)",
          }}
        >
          <strong style={{ color: "var(--green)", fontSize: 14 }}>
            ✓ Payment successful
          </strong>
          <div
            style={{
              marginTop: 8,
              fontFamily: "var(--font)",
              fontSize: 11,
              color: "var(--text-muted)",
              wordBreak: "break-all",
            }}
          >
            Tx hash: {tx.hash}
          </div>
          <a
            href={EXPLORER_TX(tx.hash)}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-block",
              marginTop: 8,
              color: "var(--green)",
              fontFamily: "var(--font)",
              fontSize: 12,
            }}
          >
            View transaction on Stellar Expert →
          </a>
        </div>
      )}

      {tx.kind === "error" && (
        <div
          style={{
            marginTop: 16,
            padding: 14,
            borderRadius: 12,
            background: "var(--accent-dim)",
            border: "1px solid var(--accent)",
          }}
        >
          <strong style={{ color: "var(--accent-soft)", fontSize: 14 }}>
            ✕ Payment failed
          </strong>
          <p style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
            {tx.message}
          </p>
        </div>
      )}
    </div>
  );
}
