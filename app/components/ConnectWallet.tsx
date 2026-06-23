"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useStellar } from "@/lib/stellarContext";
import {
  EXPLORER_ACCOUNT,
  fundWithFriendbot,
  shortAddress,
} from "@/lib/stellar";
import StellarSendForm from "@/components/StellarSendForm";

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  backdropFilter: "blur(3px)",
  zIndex: 1000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};

const modalCard: React.CSSProperties = {
  width: "100%",
  maxWidth: 420,
  background: "var(--bg-surface)",
  border: "1px solid var(--bg-border-bright)",
  borderRadius: 16,
  padding: 24,
  boxShadow: "0 20px 80px rgba(0,0,0,0.5)",
};

export default function ConnectWallet() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const {
    state,
    connect: stellarConnect,
    disconnect: stellarDisconnect,
    refreshBalance,
  } = useStellar();

  const stellarConn = state.connection;
  const [chooserOpen, setChooserOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [funding, setFunding] = useState(false);
  const [fundMsg, setFundMsg] = useState<string | null>(null);

  const handleStellar = useCallback(async () => {
    setChooserOpen(false);
    await stellarConnect();
  }, [stellarConnect]);

  const handleFund = useCallback(async () => {
    if (!stellarConn) return;
    setFunding(true);
    setFundMsg(null);
    try {
      await fundWithFriendbot(stellarConn.address);
      setFundMsg("Funded with 10,000 test XLM.");
      await refreshBalance(stellarConn.address);
    } catch (e: any) {
      setFundMsg(e?.message || "Funding failed.");
    } finally {
      setFunding(false);
    }
  }, [stellarConn, refreshBalance]);

  if (!mounted) return null;

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      {/* STELLAR PILL */}
      {stellarConn && (
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setDropdownOpen((v) => !v)}
            style={{
              fontFamily: "var(--font)",
              fontSize: 11,
              fontWeight: 600,
              padding: "8px 14px",
              borderRadius: 10,
              cursor: "pointer",
              background: "var(--bg-surface-low)",
              color: "var(--text-primary)",
              border: `1px solid ${
                stellarConn.isTestnet ? "var(--accent-border)" : "var(--accent)"
              }`,
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            <span style={{ color: "var(--accent)" }}>✦</span>
            {shortAddress(stellarConn.address)}
            <span style={{ color: "var(--text-muted)", fontSize: 9 }}>▼</span>
          </button>

          {dropdownOpen && (
            <>
              <div
                onClick={() => setDropdownOpen(false)}
                style={{ position: "fixed", inset: 0, zIndex: 90 }}
              />
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  right: 0,
                  width: 268,
                  background: "var(--bg-surface)",
                  border: "1px solid var(--bg-border-bright)",
                  borderRadius: 14,
                  padding: 16,
                  zIndex: 100,
                  boxShadow: "0 16px 50px rgba(0,0,0,0.4)",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font)",
                    fontSize: 9,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: "var(--text-muted)",
                  }}
                >
                  Stellar ·{" "}
                  <span
                    style={{
                      color: stellarConn.isTestnet
                        ? "var(--green)"
                        : "var(--accent)",
                    }}
                  >
                    {stellarConn.network || "unknown"}
                  </span>
                </div>

                <div
                  style={{
                    marginTop: 10,
                    fontFamily: "var(--font-head)",
                    fontSize: 24,
                    fontWeight: 700,
                  }}
                >
                  {state.balanceLoading
                    ? "…"
                    : Number(state.balance ?? 0).toLocaleString(undefined, {
                        maximumFractionDigits: 7,
                      })}{" "}
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    XLM
                  </span>
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      setSendOpen(true);
                    }}
                    disabled={!stellarConn.isTestnet}
                    style={{
                      flex: 1,
                      fontFamily: "var(--font)",
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "9px",
                      borderRadius: 9,
                      cursor: stellarConn.isTestnet ? "pointer" : "not-allowed",
                      background: "var(--accent)",
                      color: "#fff",
                      border: "none",
                      opacity: stellarConn.isTestnet ? 1 : 0.5,
                    }}
                  >
                    Send XLM
                  </button>
                  <button
                    onClick={() => refreshBalance(stellarConn.address)}
                    title="Refresh balance"
                    style={{
                      fontFamily: "var(--font)",
                      fontSize: 11,
                      padding: "9px 12px",
                      borderRadius: 9,
                      cursor: "pointer",
                      background: "transparent",
                      color: "var(--text-primary)",
                      border: "1px solid var(--bg-border-bright)",
                    }}
                  >
                    ↻
                  </button>
                </div>

                {(!state.funded || Number(state.balance) === 0) && (
                  <button
                    onClick={handleFund}
                    disabled={funding}
                    style={{
                      marginTop: 8,
                      width: "100%",
                      fontFamily: "var(--font)",
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "9px",
                      borderRadius: 9,
                      cursor: funding ? "wait" : "pointer",
                      background: "var(--green)",
                      color: "#04130a",
                      border: "none",
                    }}
                  >
                    {funding ? "Funding…" : "Fund with Friendbot"}
                  </button>
                )}
                {fundMsg && (
                  <p
                    style={{
                      marginTop: 8,
                      fontSize: 11,
                      color: "var(--text-muted)",
                    }}
                  >
                    {fundMsg}
                  </p>
                )}

                <div
                  style={{
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: "1px solid var(--bg-border)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <Link
                    href="/stellar"
                    onClick={() => setDropdownOpen(false)}
                    style={{
                      fontFamily: "var(--font)",
                      fontSize: 11,
                      color: "var(--text-muted)",
                      textDecoration: "none",
                    }}
                  >
                    Open full Stellar dApp →
                  </Link>
                  <a
                    href={EXPLORER_ACCOUNT(stellarConn.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontFamily: "var(--font)",
                      fontSize: 11,
                      color: "var(--text-muted)",
                    }}
                  >
                    View on explorer →
                  </a>
                  <button
                    onClick={() => {
                      stellarDisconnect();
                      setDropdownOpen(false);
                    }}
                    style={{
                      marginTop: 2,
                      fontFamily: "var(--font)",
                      fontSize: 11,
                      padding: "8px",
                      borderRadius: 9,
                      cursor: "pointer",
                      background: "transparent",
                      color: "var(--accent-soft)",
                      border: "1px solid var(--accent-border)",
                    }}
                  >
                    Disconnect Stellar
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* CONNECT (nothing connected) */}
      {!stellarConn && (
        <button
          onClick={() => setChooserOpen(true)}
          style={{
            fontFamily: "var(--font)",
            fontSize: 11,
            fontWeight: 600,
            padding: "9px 18px",
            borderRadius: 10,
            cursor: "pointer",
            background: "var(--accent)",
            color: "#fff",
            border: "none",
            whiteSpace: "nowrap",
          }}
        >
          Connect Wallet
        </button>
      )}

      {/* CHOOSER MODAL */}
      {chooserOpen && (
        <div style={overlay} onClick={() => setChooserOpen(false)}>
          <div style={modalCard} onClick={(e) => e.stopPropagation()}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 6,
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontFamily: "var(--font-head)",
                  fontSize: 18,
                }}
              >
                Connect a wallet
              </h3>
              <button
                onClick={() => setChooserOpen(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 18,
                }}
              >
                ✕
              </button>
            </div>
            <p
              style={{
                color: "var(--text-muted)",
                fontSize: 12,
                marginTop: 0,
                marginBottom: 18,
              }}
            >
              Choose a network. Your keys never leave your wallet.
            </p>

            <button
              onClick={handleStellar}
              disabled={state.available === false}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 14,
                textAlign: "left",
                padding: "14px 16px",
                borderRadius: 12,
                background: "var(--bg-surface-low)",
                border: "1px solid var(--accent-border)",
                cursor: state.available === false ? "not-allowed" : "pointer",
                marginBottom: 10,
                opacity: state.available === false ? 0.55 : 1,
              }}
            >
              <span style={{ fontSize: 22, color: "var(--accent)" }}>✦</span>
              <span>
                <span
                  style={{
                    display: "block",
                    fontFamily: "var(--font-head)",
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                  }}
                >
                  Stellar — Freighter
                </span>
                <span
                  style={{
                    display: "block",
                    fontFamily: "var(--font)",
                    fontSize: 11,
                    color: "var(--text-muted)",
                  }}
                >
                  {state.available === false
                    ? "Freighter not installed"
                    : state.connecting
                    ? "Connecting…"
                    : "Testnet · USDC rewards & XLM"}
                </span>
              </span>
            </button>

            {state.error && (
              <p
                style={{
                  marginTop: 14,
                  marginBottom: 0,
                  fontSize: 11,
                  color: "var(--accent-soft)",
                }}
              >
                {state.error}
              </p>
            )}
          </div>
        </div>
      )}

      {/* INLINE SEND MODAL */}
      {sendOpen && stellarConn && (
        <div style={overlay} onClick={() => setSendOpen(false)}>
          <div style={modalCard} onClick={(e) => e.stopPropagation()}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontFamily: "var(--font-head)",
                  fontSize: 18,
                }}
              >
                Send XLM
              </h3>
              <button
                onClick={() => setSendOpen(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 18,
                }}
              >
                ✕
              </button>
            </div>
            <StellarSendForm compact onSent={() => { /* balance auto-refreshes */ }} />
          </div>
        </div>
      )}
    </div>
  );
}
