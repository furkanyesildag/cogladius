"use client";

import { useState } from "react";
import { useWallet } from "@/lib/useWallet";
import { Task } from "@/lib/types";
import { explorerTx } from "@/lib/constants";
import { useMessages } from "@/lib/i18n";

interface DisputePanelProps {
  task: Task;
  onClose: () => void;
  onDisputed: (txHash: string) => void;
}

export default function DisputePanel({
  task,
  onClose,
  onDisputed,
}: DisputePanelProps) {
  const dp = useMessages().ui.disputePanel;
  const { connected } = useWallet();

  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rewardUsdc = task.rewardUsdc ?? task.reward / 1e7;
  const stakeUsdc = rewardUsdc * 0.2;

  const canDispute =
    task.status === "Settled" && connected;

  async function handleDispute() {
    if (!connected) {
      setError(dp.errors.walletFirst);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Flag the task as disputed on-chain (Soroban). Full Agent Court
      // resolution on Stellar is a deferred deliverable.
      const res = await fetch("/api/stellar/dispute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id }),
      });
      const data = await res.json();
      if (!data?.success) throw new Error(data?.error || dp.errors.txFailed);
      setTxHash(data.hash);
      onDisputed(data.hash);
    } catch (err: any) {
      setError(err.message || dp.errors.txFailed);
    } finally {
      setLoading(false);
    }
  }

  if (txHash) {
    return (
      <div className="terminal-panel">
        <div
          className="terminal-header"
          style={{ color: "var(--orange)" }}
        >
            {dp.openedTitle(task.id)}
          </div>
          <div className="p-4 space-y-3">
            <div className="text-center">
              <div className="text-3xl mb-2">⚠️</div>
              <div className="text-[var(--orange)] font-bold text-sm">
                {dp.openedSubtitle}
              </div>
              <div className="text-xs text-[var(--muted)] mt-1">
                {dp.judgesSubtitle}
              </div>
            </div>
          <div className="bg-[var(--bg)] border border-[var(--dim)] rounded p-3">
              <div className="text-[10px] text-[var(--muted)] mb-1">{dp.txHashLabel}</div>
            <a
              href={explorerTx(txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--lobster)] text-xs hover:underline font-mono break-all"
            >
              {txHash}
            </a>
          </div>
          <button onClick={onClose} className="btn-lobster w-full text-xs">
            {dp.close}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="terminal-panel">
      <div
        className="terminal-header"
        style={{
          color: task.status === "Disputed" ? "var(--red)" : "var(--orange)",
        }}
      >
        <span
          style={{
            background:
              task.status === "Disputed" ? "var(--red)" : "var(--orange)",
          }}
        />
            {dp.disputeTitle(task.id)}
      </div>

      <div className="p-4 space-y-4">
        {task.status === "Disputed" ? (
          <div className="text-center py-4">
            <div className="text-3xl mb-2">⚠️</div>
            <div className="font-bold text-sm" style={{ color: "var(--red)" }}>
                {dp.alreadyOpen}
            </div>
            <div className="text-xs text-[var(--muted)] mt-1">
              {dp.evaluatingSubtitle}
            </div>
          </div>
        ) : task.status === "Settled" ? (
          <>
            {/* Explanation */}
            <div className="text-xs text-[var(--text-muted)] space-y-2">
              <p className="text-[var(--orange)] font-bold">
                {dp.notHappyTitle}
              </p>
              <p>{dp.stakeExplanation(stakeUsdc.toFixed(2))}</p>
            </div>

            {/* Outcome table */}
            <div className="bg-[var(--bg)] border border-[var(--dim)] rounded p-3 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">{dp.ifWin}</span>
                <span className="text-[var(--green)] font-bold">
                  {dp.ifWinDetail}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">{dp.ifLose}</span>
                <span className="font-bold" style={{ color: "var(--red)" }}>
                  {dp.ifLoseDetail}
                </span>
              </div>
              <div className="flex justify-between border-t border-[var(--dim)] pt-2">
                <span className="text-[var(--muted)]">{dp.stakeAmountLabel}</span>
                <span className="text-[var(--orange)] font-bold">
                  {stakeUsdc.toFixed(2)} XLM
                </span>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="rounded p-3 text-xs" style={{ background: "var(--red-dim)", border: "1px solid var(--red)", color: "var(--red)" }}>
                {error}
              </div>
            )}

            {/* Buttons */}
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="btn-lobster flex-1 text-xs opacity-60"
              >
                {dp.cancel}
              </button>
              {canDispute ? (
                <button
                  onClick={handleDispute}
                  disabled={loading}
                  className="btn-lobster flex-1 text-xs font-bold disabled:opacity-50"
                  style={{ borderColor: "var(--red)", color: "var(--red)" }}
                >
                  {loading ? (
                    <span className="animate-pulse">{dp.opening}</span>
                  ) : (
                    dp.openCta(stakeUsdc.toFixed(2))
                  )}
                </button>
              ) : (
                <div className="text-xs text-[var(--muted)] flex-1 text-center pt-2">
                  {dp.connectWallet}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="text-center py-4 text-[var(--muted)] text-xs">
            {dp.onlyAfterComplete}
            <br />
            {dp.currentStatus}{" "}
            <span className="text-[var(--orange)]">{task.status}</span>
          </div>
        )}
      </div>
    </div>
  );
}
