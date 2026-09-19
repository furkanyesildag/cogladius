/**
 * Multi-wallet layer on Stellar Wallets Kit (Freighter, xBull, Albedo, Lobstr,
 * Hana, Rabet, ...). It replaces direct @stellar/freighter-api calls.
 *
 * The sign* helpers keep freighter-api's return shape ({ ..., error }) so call
 * sites only swap their import. The kit touches `document`/`localStorage` at
 * import time, so it is loaded lazily and only in the browser.
 */

import { NETWORK_PASSPHRASE } from "@/lib/constants";

type Kit = typeof import("@creit.tech/stellar-wallets-kit/sdk").StellarWalletsKit;

let kitPromise: Promise<Kit> | null = null;

export function loadKit(): Promise<Kit> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Wallets are only available in the browser."));
  }
  if (!kitPromise) {
    kitPromise = (async () => {
      const [{ StellarWalletsKit }, { defaultModules }] = await Promise.all([
        import("@creit.tech/stellar-wallets-kit/sdk"),
        import("@creit.tech/stellar-wallets-kit/modules/utils"),
      ]);
      StellarWalletsKit.init({
        modules: defaultModules(),
        network: NETWORK_PASSPHRASE as any,
      });
      return StellarWalletsKit;
    })();
    kitPromise.catch(() => {
      kitPromise = null;
    });
  }
  return kitPromise;
}

function errorMessage(err: any): string {
  if (typeof err === "string") return err;
  return err?.message || "Wallet request was rejected or failed.";
}

/** Open the wallet picker and return the chosen account's address. */
export async function openWalletPicker(): Promise<string> {
  const kit = await loadKit();
  const { address } = await kit.authModal();
  if (!address) throw new Error("No account returned by the wallet.");
  return address;
}

/** Address remembered by the kit from a previous session, without prompting. */
export async function getRememberedAddress(): Promise<string | null> {
  try {
    const kit = await loadKit();
    const { address } = await kit.getAddress();
    return address || null;
  } catch {
    return null;
  }
}

/**
 * The network the wallet itself is on. Some wallets (e.g. Lobstr) can't report
 * it; then we trust the kit's configured network.
 */
export async function getWalletNetwork(): Promise<{ network: string; networkPassphrase: string }> {
  const kit = await loadKit();
  try {
    return await kit.getNetwork();
  } catch {
    return { network: "", networkPassphrase: NETWORK_PASSPHRASE };
  }
}

export async function disconnectWallet(): Promise<void> {
  try {
    const kit = await loadKit();
    await kit.disconnect();
  } catch {
    /* nothing connected */
  }
}

/** Subscribe to address changes made through the kit. Returns an unsubscribe. */
export async function onWalletChange(cb: (address: string | undefined) => void): Promise<() => void> {
  const kit = await loadKit();
  const { KitEventType } = await import("@creit.tech/stellar-wallets-kit/types");
  return kit.on(KitEventType.STATE_UPDATED, (e) => cb(e.payload.address));
}

type SignOpts = { networkPassphrase?: string; address?: string };

/**
 * Run a kit call; if no wallet has been picked yet (e.g. agent registration
 * signs before any "connect"), open the picker once and retry.
 */
async function withWallet<T>(fn: (kit: Kit) => Promise<T>): Promise<T> {
  const kit = await loadKit();
  try {
    return await fn(kit);
  } catch (err: any) {
    if (!/set the wallet first/i.test(String(err?.message))) throw err;
    await kit.authModal();
    return fn(kit);
  }
}

export async function signTransaction(xdr: string, opts: SignOpts = {}) {
  try {
    const r = await withWallet((kit) => kit.signTransaction(xdr, { networkPassphrase: NETWORK_PASSPHRASE, ...opts }));
    return { signedTxXdr: r.signedTxXdr, signerAddress: r.signerAddress ?? "", error: undefined };
  } catch (err) {
    return { signedTxXdr: "", signerAddress: "", error: errorMessage(err) };
  }
}

/** Not every wallet can sign auth entries (Albedo, xBull, Lobstr, Rabet can't). */
export async function signAuthEntry(entryXdr: string, opts: SignOpts = {}) {
  try {
    const r = await withWallet((kit) => kit.signAuthEntry(entryXdr, { networkPassphrase: NETWORK_PASSPHRASE, ...opts }));
    return { signedAuthEntry: r.signedAuthEntry, signerAddress: r.signerAddress ?? "", error: undefined };
  } catch (err) {
    return { signedAuthEntry: null, signerAddress: "", error: errorMessage(err) };
  }
}

export async function signMessage(message: string, opts: SignOpts = {}) {
  try {
    const r = await withWallet((kit) => kit.signMessage(message, { networkPassphrase: NETWORK_PASSPHRASE, ...opts }));
    return { signedMessage: r.signedMessage, signerAddress: r.signerAddress ?? "", error: undefined };
  } catch (err) {
    return { signedMessage: null, signerAddress: "", error: errorMessage(err) };
  }
}
