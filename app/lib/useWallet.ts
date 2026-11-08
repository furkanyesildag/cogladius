"use client";

import { useStellar } from "@/lib/stellarContext";

/**
 * Stellar-backed wallet hook used across the app.
 *
 * `publicKey` is the connected Stellar address (G...) as a plain string, or
 * null when disconnected. Calling `.toString()` on it returns the address,
 * so existing call sites keep working.
 */
export function useWallet() {
  const { state, disconnect, connect } = useStellar();
  const address = state.connection?.address ?? null;
  return {
    publicKey: address,
    address,
    connected: !!address,
    connecting: state.connecting,
    /** False until the page-load reconnect attempt has finished. */
    ready: state.restored,
    walletInstalled: state.available,
    connect,
    disconnect,
  };
}
