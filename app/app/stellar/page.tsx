"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeProvider";
import { useStellar } from "@/lib/stellarContext";
import StellarSendForm from "@/components/StellarSendForm";
import {
  EXPLORER_ACCOUNT,
  EXPLORER_TX,
  fetchRecentPayments,
  fundWithFriendbot,
  shortAddress,
  type PaymentRecord,
} from "@/lib/stellar";

const card: React.CSSProperties = {
  background: "var(--bg-surface)",
  border: "1px solid var(--bg-border-bright)",
  borderRadius: 14,
  padding: "clamp(18px, 3vw, 26px)",
};

const label: React.CSSProperties = {
  fontFamily: "var(--font)",
  fontSize: 10,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  marginBottom: 8,
  display: "block",
};

export default function StellarDappPage() {
  const { state, connect, disconnect, refreshBalance, clearError } = useStellar();
  const { connection, balance, funded, balanceLoading, available, connecting } =
    state;

  const [funding, setFunding] = useState(false);
  const [fundMsg, setFundMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<PaymentRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const address = connection?.address ?? "";
  const isTestnet = connection?.isTestnet ?? false;

  const loadHistory = useCallback(async () => {
    if (!address) return;
    setHistoryLoading(true);
    try {
      setHistory(await fetchRecentPayments(address, 10));
    } catch {
      /* non-fatal */
    } finally {
      setHistoryLoading(false);
    }
  }, [address]);

  const handleFund = useCallback(async () => {
    if (!address) return;
    setFunding(true);
    setFundMsg(null);
    try {
      await fundWithFriendbot(address);
      setFundMsg("Funded! 10,000 testnet XLM added.");
      await refreshBalance(address);
      await loadHistory();
    } catch (e: any) {
      setFundMsg(e?.message || "Funding failed.");
    } finally {
      setFunding(false);
    }
  }, [address, refreshBalance, loadHistory]);

  const copyAddress = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  }, [address]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg-base)",
        color: "var(--text-primary)",
        fontFamily: "var(--font-body)",
      }}
    >
      {/* NAV */}
      <nav
        style={{
          minHeight: 56,
          background: "var(--bg-surface-low)",
          borderBottom: "1px solid var(--bg-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 clamp(14px, 4vw, 28px)",
          position: "sticky",
          top: 0,
          zIndex: 50,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Link
            href="/"
            style={{
              fontFamily: "var(--font-head)",
              fontWeight: 700,
              fontSize: 16,
              color: "var(--text-primary)",
              textDecoration: "none",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ color: "var(--accent)" }}>✦</span> Stellar Pay
          </Link>
          <span
            style={{
              fontFamily: "var(--font)",
              fontSize: 9,
              letterSpacing: "0.08em",
              color: "var(--green)",
              border: "1px solid var(--green)",
              borderRadius: 20,
              padding: "3px 10px",
              textTransform: "uppercase",
            }}
          >
            Testnet
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <ThemeToggle />
          {connection ? (
            <button
              onClick={disconnect}
              style={{
                fontFamily: "var(--font)",
                fontSize: 11,
                padding: "8px 16px",
                borderRadius: 10,
                cursor: "pointer",
                background: "transparent",
                color: "var(--text-primary)",
                border: "1px solid var(--bg-border-bright)",
              }}
            >
              {shortAddress(address)} · Disconnect
            </button>
          ) : (
            <button
              onClick={connect}
              disabled={connecting || available === false}
              style={{
                fontFamily: "var(--font)",
                fontSize: 11,
                fontWeight: 600,
                padding: "8px 18px",
                borderRadius: 10,
                cursor: connecting ? "wait" : "pointer",
                background: "var(--accent)",
                color: "#fff",
                border: "none",
                opacity: available === false ? 0.5 : 1,
              }}
            >
              {connecting ? "Connecting…" : "Connect Freighter"}
            </button>
          )}
        </div>
      </nav>

      <main
        style={{
          maxWidth: 880,
          margin: "0 auto",
          padding: "clamp(24px, 5vw, 48px) clamp(16px, 4vw, 24px) 80px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        <header style={{ marginBottom: 4 }}>
          <h1
            style={{
              fontFamily: "var(--font-head)",
              fontSize: "clamp(26px, 5vw, 38px)",
              fontWeight: 700,
              margin: 0,
              lineHeight: 1.1,
            }}
          >
            Stellar Payment dApp
          </h1>
          <p
            style={{
              color: "var(--text-muted)",
              marginTop: 10,
              fontSize: 14,
              maxWidth: 560,
            }}
          >
            Connect Freighter, check your XLM balance, and send a real payment on
            the Stellar testnet — fully on-chain.
          </p>
        </header>

        {state.error && (
          <div
            style={{
              ...card,
              borderColor: "var(--accent)",
              background: "var(--accent-dim)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span style={{ fontSize: 13, color: "var(--accent-soft)" }}>
              {state.error}
            </span>
            <button
              onClick={clearError}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 16,
              }}
            >
              ✕
            </button>
          </div>
        )}

        {available === false && (
          <div style={{ ...card }}>
            <h2 style={{ margin: 0, fontSize: 16, fontFamily: "var(--font-head)" }}>
              Freighter not detected
            </h2>
            <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 8 }}>
              You need the Freighter browser extension to use this dApp. Install
              it, switch it to <strong>Testnet</strong>, then reload this page.
            </p>
            <a
              href="https://www.freighter.app/"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-block",
                marginTop: 12,
                color: "var(--accent)",
                fontFamily: "var(--font)",
                fontSize: 13,
              }}
            >
              Get Freighter →
            </a>
          </div>
        )}

        {available !== false && !connection && (
          <div style={{ ...card, textAlign: "center", padding: "48px 24px" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✦</div>
            <h2 style={{ margin: 0, fontSize: 18, fontFamily: "var(--font-head)" }}>
              Connect your wallet to begin
            </h2>
            <p
              style={{
                color: "var(--text-muted)",
                fontSize: 13,
                marginTop: 8,
                marginBottom: 20,
              }}
            >
              We never see your secret key — Freighter signs everything locally.
            </p>
            <button
              onClick={connect}
              disabled={connecting}
              style={{
                fontFamily: "var(--font)",
                fontSize: 13,
                fontWeight: 600,
                padding: "12px 28px",
                borderRadius: 12,
                cursor: connecting ? "wait" : "pointer",
                background: "var(--accent)",
                color: "#fff",
                border: "none",
              }}
            >
              {connecting ? "Connecting…" : "Connect Freighter"}
            </button>
          </div>
        )}

        {connection && (
          <>
            {!isTestnet && (
              <div
                style={{
                  ...card,
                  borderColor: "var(--accent)",
                  background: "var(--accent-dim)",
                }}
              >
                <strong style={{ color: "var(--accent-soft)", fontSize: 14 }}>
                  Wrong network: {connection.network || "unknown"}
                </strong>
                <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 6 }}>
                  Switch Freighter to <strong>Testnet</strong> to send payments.
                </p>
              </div>
            )}

            {/* ACCOUNT + BALANCE */}
            <section style={card}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 16,
                  alignItems: "flex-start",
                }}
              >
                <div style={{ minWidth: 220 }}>
                  <span style={label}>Connected account</span>
                  <button
                    onClick={copyAddress}
                    title="Copy address"
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      fontFamily: "var(--font)",
                      fontSize: 14,
                      color: "var(--text-primary)",
                      wordBreak: "break-all",
                      textAlign: "left",
                    }}
                  >
                    {shortAddress(address, 8, 8)}{" "}
                    <span style={{ color: "var(--green)", fontSize: 11 }}>
                      {copied ? "copied!" : "⧉"}
                    </span>
                  </button>
                  <div style={{ marginTop: 6 }}>
                    <a
                      href={EXPLORER_ACCOUNT(address)}
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
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <span style={label}>XLM Balance</span>
                  <div
                    style={{
                      fontFamily: "var(--font-head)",
                      fontSize: 30,
                      fontWeight: 700,
                      color: funded ? "var(--text-primary)" : "var(--text-muted)",
                    }}
                  >
                    {balanceLoading
                      ? "…"
                      : balance
                      ? Number(balance).toLocaleString(undefined, {
                          maximumFractionDigits: 7,
                        })
                      : "0"}{" "}
                    <span style={{ fontSize: 14, color: "var(--text-muted)" }}>
                      XLM
                    </span>
                  </div>
                  <button
                    onClick={() => refreshBalance(address)}
                    style={{
                      marginTop: 4,
                      background: "transparent",
                      border: "none",
                      color: "var(--green)",
                      cursor: "pointer",
                      fontFamily: "var(--font)",
                      fontSize: 11,
                    }}
                  >
                    ↻ Refresh
                  </button>
                </div>
              </div>

              {(!funded || Number(balance) === 0) && (
                <div
                  style={{
                    marginTop: 18,
                    paddingTop: 18,
                    borderTop: "1px solid var(--bg-border)",
                  }}
                >
                  <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
                    {funded
                      ? "Your account has no XLM."
                      : "This account isn't funded on testnet yet."}{" "}
                    Get free test XLM:
                  </p>
                  <button
                    onClick={handleFund}
                    disabled={funding}
                    style={{
                      marginTop: 10,
                      fontFamily: "var(--font)",
                      fontSize: 12,
                      fontWeight: 600,
                      padding: "10px 20px",
                      borderRadius: 10,
                      cursor: funding ? "wait" : "pointer",
                      background: "var(--green)",
                      color: "#04130a",
                      border: "none",
                    }}
                  >
                    {funding ? "Funding…" : "Fund with Friendbot"}
                  </button>
                  {fundMsg && (
                    <p
                      style={{
                        marginTop: 10,
                        fontSize: 12,
                        color: "var(--text-muted)",
                      }}
                    >
                      {fundMsg}
                    </p>
                  )}
                </div>
              )}
            </section>

            {/* SEND */}
            <section style={card}>
              <h2
                style={{
                  margin: "0 0 18px",
                  fontSize: 16,
                  fontFamily: "var(--font-head)",
                }}
              >
                Send XLM
              </h2>
              <StellarSendForm onSent={loadHistory} />
            </section>

            {/* HISTORY */}
            <section style={card}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 14,
                }}
              >
                <h2
                  style={{ margin: 0, fontSize: 16, fontFamily: "var(--font-head)" }}
                >
                  Recent payments
                </h2>
                <button
                  onClick={loadHistory}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--bg-border-bright)",
                    borderRadius: 8,
                    padding: "6px 12px",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontFamily: "var(--font)",
                    fontSize: 11,
                  }}
                >
                  {historyLoading ? "Loading…" : "Load history"}
                </button>
              </div>

              {history.length === 0 ? (
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
                  {historyLoading
                    ? "Fetching from Horizon…"
                    : "No payments loaded yet. Click “Load history”."}
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {history.map((rec) => (
                    <a
                      key={rec.id}
                      href={EXPLORER_TX(rec.hash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "10px 12px",
                        borderRadius: 10,
                        background: "var(--bg-base)",
                        border: "1px solid var(--bg-border)",
                        textDecoration: "none",
                        gap: 12,
                      }}
                    >
                      <div
                        style={{ display: "flex", alignItems: "center", gap: 10 }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontFamily: "var(--font)",
                            color:
                              rec.type === "sent"
                                ? "var(--accent-soft)"
                                : "var(--green)",
                            minWidth: 56,
                          }}
                        >
                          {rec.type === "sent" ? "↗ Sent" : "↘ Received"}
                        </span>
                        <span
                          style={{
                            fontFamily: "var(--font)",
                            fontSize: 12,
                            color: "var(--text-muted)",
                          }}
                        >
                          {shortAddress(rec.counterparty)}
                        </span>
                      </div>
                      <span
                        style={{
                          fontFamily: "var(--font)",
                          fontSize: 13,
                          color: "var(--text-primary)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {rec.type === "sent" ? "-" : "+"}
                        {Number(rec.amount).toLocaleString(undefined, {
                          maximumFractionDigits: 7,
                        })}{" "}
                        XLM
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
