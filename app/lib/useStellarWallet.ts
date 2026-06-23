"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WatchWalletChanges } from "@stellar/freighter-api";
import {
  connectFreighter,
  fetchXlmBalance,
  getActiveConnection,
  isFreighterAvailable,
  NETWORK_PASSPHRASE,
  type WalletConnection,
} from "./stellar";

export type StellarWalletState = {
  available: boolean | null;
  connecting: boolean;
  connection: WalletConnection | null;
  balance: string | null;
  funded: boolean;
  balanceLoading: boolean;
  error: string | null;
};

export function useStellarWallet() {
  const [state, setState] = useState<StellarWalletState>({
    available: null,
    connecting: false,
    connection: null,
    balance: null,
    funded: false,
    balanceLoading: false,
    error: null,
  });
  const watcherRef = useRef<WatchWalletChanges | null>(null);

  const refreshBalance = useCallback(async (address?: string) => {
    const addr = address ?? state.connection?.address;
    if (!addr) return;
    setState((s) => ({ ...s, balanceLoading: true }));
    try {
      const bal = await fetchXlmBalance(addr);
      setState((s) => ({
        ...s,
        balance: bal.xlm,
        funded: bal.funded,
        balanceLoading: false,
      }));
    } catch (e: any) {
      setState((s) => ({
        ...s,
        balanceLoading: false,
        error: e?.message || "Failed to fetch balance.",
      }));
    }
  }, [state.connection?.address]);

  const connect = useCallback(async () => {
    setState((s) => ({ ...s, connecting: true, error: null }));
    try {
      const conn = await connectFreighter();
      setState((s) => ({ ...s, connection: conn, connecting: false }));
      void refreshBalance(conn.address);
    } catch (e: any) {
      setState((s) => ({
        ...s,
        connecting: false,
        error: e?.message || "Failed to connect Freighter.",
      }));
    }
  }, [refreshBalance]);

  const disconnect = useCallback(() => {
    watcherRef.current?.stop();
    watcherRef.current = null;
    setState((s) => ({
      ...s,
      connection: null,
      balance: null,
      funded: false,
      error: null,
    }));
  }, []);

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  // Detect Freighter availability + attempt a silent reconnect on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const available = await isFreighterAvailable();
      if (cancelled) return;
      setState((s) => ({ ...s, available }));
      if (!available) return;
      const existing = await getActiveConnection();
      if (cancelled || !existing) return;
      setState((s) => ({ ...s, connection: existing }));
      void refreshBalance(existing.address);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Watch for account/network switches in the extension while connected.
  useEffect(() => {
    if (!state.connection) return;
    const watcher = new WatchWalletChanges(2500);
    watcherRef.current = watcher;
    watcher.watch(({ address, networkPassphrase, error }) => {
      if (error || !address) return;
      setState((s) => {
        if (!s.connection) return s;
        if (
          s.connection.address === address &&
          s.connection.networkPassphrase === networkPassphrase
        ) {
          return s;
        }
        return {
          ...s,
          connection: {
            ...s.connection,
            address,
            networkPassphrase,
            isTestnet: networkPassphrase === NETWORK_PASSPHRASE,
          },
        };
      });
    });
    return () => {
      watcher.stop();
      watcherRef.current = null;
    };
  }, [state.connection?.address]);

  // Refresh balance when the watched address changes.
  useEffect(() => {
    if (state.connection?.address) void refreshBalance(state.connection.address);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.connection?.address]);

  return { state, connect, disconnect, refreshBalance, clearError };
}
