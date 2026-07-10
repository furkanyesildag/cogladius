/**
 * Stellar testnet helpers — Level 1 White Belt dApp.
 * Wraps Freighter (wallet) + Horizon (chain) for connect, balance, payment, faucet, history.
 */
import {
  isConnected as freighterIsConnected,
  isAllowed as freighterIsAllowed,
  setAllowed as freighterSetAllowed,
  requestAccess,
  getAddress,
  getNetworkDetails,
  signTransaction,
} from "@stellar/freighter-api";
import {
  Asset,
  BASE_FEE,
  Horizon,
  Memo,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import {
  USDC_ASSET_CODE,
  USDC_ISSUER,
  HORIZON_URL as CFG_HORIZON_URL,
  NETWORK_PASSPHRASE as CFG_NETWORK_PASSPHRASE,
  EXPLORER_BASE,
  IS_MAINNET,
} from "@/lib/constants";

// Network config is env-driven (defaults to mainnet — see constants.ts).
export const HORIZON_URL = CFG_HORIZON_URL;
export const NETWORK_PASSPHRASE = CFG_NETWORK_PASSPHRASE;
// Friendbot only exists on testnet; there is no mainnet faucet.
export const FRIENDBOT_URL = "https://friendbot.stellar.org";
export const EXPLORER_TX = (hash: string) => `${EXPLORER_BASE}/tx/${hash}`;
export const EXPLORER_ACCOUNT = (addr: string) => `${EXPLORER_BASE}/account/${addr}`;

export function getServer(): Horizon.Server {
  return new Horizon.Server(HORIZON_URL);
}

/** True if the Freighter extension is installed/available. */
export async function isFreighterAvailable(): Promise<boolean> {
  try {
    const res = await freighterIsConnected();
    if (res.error) return false;
    return res.isConnected;
  } catch {
    return false;
  }
}

export type WalletConnection = {
  address: string;
  network: string;
  networkPassphrase: string;
  isTestnet: boolean;
};

/** Prompt the user to connect Freighter and return their account + network. */
export async function connectFreighter(): Promise<WalletConnection> {
  const installed = await isFreighterAvailable();
  if (!installed) {
    throw new Error(
      "Freighter extension not found. Install it from freighter.app and reload."
    );
  }

  const allowed = await freighterIsAllowed();
  if (!allowed.isAllowed) {
    const set = await freighterSetAllowed();
    if (set.error) throw new Error(friendlyError(set.error));
  }

  const access = await requestAccess();
  if (access.error) throw new Error(friendlyError(access.error));
  if (!access.address) throw new Error("No account returned by Freighter.");

  const details = await getNetworkDetails();
  if (details.error) throw new Error(friendlyError(details.error));

  return {
    address: access.address,
    network: details.network,
    networkPassphrase: details.networkPassphrase,
    isTestnet: details.networkPassphrase === NETWORK_PASSPHRASE,
  };
}

/** Re-read the current address without prompting (for silent reconnect). */
export async function getActiveConnection(): Promise<WalletConnection | null> {
  try {
    const allowed = await freighterIsAllowed();
    if (allowed.error || !allowed.isAllowed) return null;

    const addr = await getAddress();
    if (addr.error || !addr.address) return null;

    const details = await getNetworkDetails();
    if (details.error) return null;

    return {
      address: addr.address,
      network: details.network,
      networkPassphrase: details.networkPassphrase,
      isTestnet: details.networkPassphrase === NETWORK_PASSPHRASE,
    };
  } catch {
    return null;
  }
}

export type AccountBalance = {
  /** Native XLM balance as a string, e.g. "10000.0000000". */
  xlm: string;
  /** True if the account exists/funded on the network. */
  funded: boolean;
};

/** Fetch the native XLM balance for an address. */
export async function fetchXlmBalance(address: string): Promise<AccountBalance> {
  const server = getServer();
  try {
    const account = await server.loadAccount(address);
    const native = account.balances.find(
      (b: any) => b.asset_type === "native"
    );
    return { xlm: native ? native.balance : "0", funded: true };
  } catch (err: any) {
    // 404 from Horizon = account not yet funded on this network.
    if (err?.response?.status === 404 || err?.name === "NotFoundError") {
      return { xlm: "0", funded: false };
    }
    throw err;
  }
}

/** Fetch the USDC balance + trustline status for an address. */
export async function fetchUsdcBalance(
  address: string
): Promise<{ usdc: string; hasTrustline: boolean; funded: boolean }> {
  const server = getServer();
  try {
    const account = await server.loadAccount(address);
    const line = account.balances.find(
      (b: any) =>
        b.asset_type !== "native" &&
        b.asset_code === USDC_ASSET_CODE &&
        b.asset_issuer === USDC_ISSUER
    );
    return {
      usdc: line ? line.balance : "0",
      hasTrustline: !!line,
      funded: true,
    };
  } catch (err: any) {
    if (err?.response?.status === 404 || err?.name === "NotFoundError") {
      return { usdc: "0", hasTrustline: false, funded: false };
    }
    throw err;
  }
}

/** Add a trustline for the testnet USDC asset, signed via Freighter. */
export async function addUsdcTrustline(address: string): Promise<{ hash: string }> {
  const server = getServer();
  const account = await server.loadAccount(address);
  const usdc = new Asset(USDC_ASSET_CODE, USDC_ISSUER);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.changeTrust({ asset: usdc }))
    .setTimeout(120)
    .build();

  const { signedTxXdr, error } = await signTransaction(tx.toXDR(), {
    networkPassphrase: NETWORK_PASSPHRASE,
    address,
  });
  if (error) throw new Error(typeof error === "string" ? error : "Trustline signing failed");

  const signed = TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE);
  const res = await server.submitTransaction(signed as any);
  return { hash: res.hash };
}

/** Fund an account on testnet via Friendbot (one-click faucet). No-op on mainnet. */
export async function fundWithFriendbot(address: string): Promise<void> {
  if (IS_MAINNET) {
    throw new Error(
      "Friendbot is testnet-only. On mainnet, fund the account with real XLM from an exchange or wallet."
    );
  }
  const res = await fetch(`${FRIENDBOT_URL}/?addr=${encodeURIComponent(address)}`);
  if (!res.ok) {
    let detail = "";
    try {
      const data = await res.json();
      detail = data?.detail || data?.title || "";
    } catch {
      /* ignore */
    }
    throw new Error(
      detail || `Friendbot funding failed (HTTP ${res.status}). Account may already be funded.`
    );
  }
}

export type PaymentResult = {
  hash: string;
  ledger?: number;
};

export type SendPaymentArgs = {
  from: string;
  to: string;
  /** Amount of XLM as a decimal string, e.g. "1.5". */
  amount: string;
  memo?: string;
};

/**
 * Build, sign (via Freighter) and submit a native XLM payment on testnet.
 * Returns the transaction hash on success.
 */
export async function sendXlmPayment({
  from,
  to,
  amount,
  memo,
}: SendPaymentArgs): Promise<PaymentResult> {
  const server = getServer();

  const sourceAccount = await server.loadAccount(from);

  const builder = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  }).addOperation(
    Operation.payment({
      destination: to,
      asset: Asset.native(),
      amount,
    })
  );

  if (memo && memo.trim().length > 0) {
    builder.addMemo(Memo.text(memo.trim().slice(0, 28)));
  }

  const tx = builder.setTimeout(180).build();

  const signed = await signTransaction(tx.toXDR(), {
    networkPassphrase: NETWORK_PASSPHRASE,
    address: from,
  });
  if (signed.error) throw new Error(friendlyError(signed.error));

  const signedTx = TransactionBuilder.fromXDR(
    signed.signedTxXdr,
    NETWORK_PASSPHRASE
  );

  const result = await server.submitTransaction(signedTx as any);
  return { hash: result.hash, ledger: (result as any).ledger };
}

export type PaymentRecord = {
  id: string;
  hash: string;
  type: "sent" | "received" | "create";
  counterparty: string;
  amount: string;
  createdAt: string;
};

/** Fetch recent payments (sent + received) for an account. */
export async function fetchRecentPayments(
  address: string,
  limit = 10
): Promise<PaymentRecord[]> {
  const server = getServer();
  try {
    const page = await server
      .payments()
      .forAccount(address)
      .order("desc")
      .limit(limit)
      .call();

    return page.records
      .map((rec: any): PaymentRecord | null => {
        if (rec.type === "payment" && rec.asset_type === "native") {
          const sent = rec.from === address;
          return {
            id: rec.id,
            hash: rec.transaction_hash,
            type: sent ? "sent" : "received",
            counterparty: sent ? rec.to : rec.from,
            amount: rec.amount,
            createdAt: rec.created_at,
          };
        }
        if (rec.type === "create_account") {
          const isFunder = rec.funder === address;
          return {
            id: rec.id,
            hash: rec.transaction_hash,
            type: isFunder ? "sent" : "create",
            counterparty: isFunder ? rec.account : rec.funder,
            amount: rec.starting_balance,
            createdAt: rec.created_at,
          };
        }
        return null;
      })
      .filter((r): r is PaymentRecord => r !== null);
  } catch (err: any) {
    if (err?.response?.status === 404 || err?.name === "NotFoundError") {
      return [];
    }
    throw err;
  }
}

/** Basic Stellar public key validation (G... ed25519, 56 chars). */
export function isValidStellarAddress(addr: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(addr.trim());
}

export function shortAddress(addr: string, lead = 5, tail = 5): string {
  if (!addr) return "";
  if (addr.length <= lead + tail) return addr;
  return `${addr.slice(0, lead)}…${addr.slice(-tail)}`;
}

function friendlyError(error: unknown): string {
  if (!error) return "Unknown Freighter error.";
  if (typeof error === "string") return error;
  const anyErr = error as { message?: string; code?: number };
  if (anyErr.message) return anyErr.message;
  return "Freighter request was rejected or failed.";
}

/** Turn Horizon submit errors into a readable message. */
export function parseHorizonError(err: any): string {
  const resultCodes = err?.response?.data?.extras?.result_codes;
  if (resultCodes) {
    const op = Array.isArray(resultCodes.operations)
      ? resultCodes.operations.join(", ")
      : "";
    const tx = resultCodes.transaction || "";
    const map: Record<string, string> = {
      op_underfunded: "Insufficient XLM balance for this payment + fee.",
      op_no_destination:
        "Destination account does not exist yet. Send at least 1 XLM to create it.",
      tx_insufficient_balance: "Insufficient balance to cover the transaction.",
      tx_bad_seq: "Bad sequence number — please retry.",
    };
    return map[op] || map[tx] || `Transaction failed: ${tx || op || "unknown"}.`;
  }
  if (err?.message) return err.message;
  return "Transaction failed. Please try again.";
}
