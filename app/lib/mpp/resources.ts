/**
 * Paid data an agent can buy while it works. Every resource is live Stellar
 * data fetched at request time (nothing is invented), so the thing being paid
 * for is real: network state, fee pressure, the XLM/USDC order book on the
 * Stellar DEX, and the escrow's own configuration.
 */

import { getRpcServer, getEscrowConfig } from "@/lib/sorobanServer";
import { HORIZON_URL, ESCROW_CONTRACT_ID, IS_MAINNET } from "@/lib/constants";

export interface PaidResource {
  id: string;
  description: string;
  /** Price in XLM per request, human-readable. */
  chargePrice: string;
  sessionPrice: string;
  load: () => Promise<unknown>;
}

const USDC_ISSUER_MAINNET = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

export const RESOURCES: Record<string, PaidResource> = {
  "network-metrics": {
    id: "network-metrics",
    description: "Latest ledger, protocol version and Soroban fee statistics",
    chargePrice: "0.01",
    sessionPrice: "0.001",
    load: async () => {
      const server = getRpcServer();
      const [latest, fees] = await Promise.all([server.getLatestLedger(), server.getFeeStats()]);
      return {
        latestLedger: latest.sequence,
        protocolVersion: latest.protocolVersion,
        sorobanInclusionFee: fees.sorobanInclusionFee,
        inclusionFee: fees.inclusionFee,
        observedAt: new Date().toISOString(),
      };
    },
  },
  "dex-xlm-usdc": {
    id: "dex-xlm-usdc",
    description: "Top of the XLM/USDC order book and recent trades on the Stellar DEX",
    chargePrice: "0.01",
    sessionPrice: "0.001",
    load: async () => {
      const q = IS_MAINNET
        ? `counter_asset_type=credit_alphanum4&counter_asset_code=USDC&counter_asset_issuer=${USDC_ISSUER_MAINNET}`
        : "counter_asset_type=credit_alphanum4&counter_asset_code=USDC&counter_asset_issuer=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
      const [book, trades] = await Promise.all([
        fetch(`${HORIZON_URL}/order_book?selling_asset_type=native&buying_asset_type=credit_alphanum4&buying_asset_code=USDC&buying_asset_issuer=${IS_MAINNET ? USDC_ISSUER_MAINNET : "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"}&limit=5`).then((r) => r.json()),
        fetch(`${HORIZON_URL}/trades?base_asset_type=native&${q}&order=desc&limit=5`).then((r) => r.json()),
      ]);
      return {
        bids: (book.bids ?? []).map((b: any) => ({ price: b.price, amount: b.amount })),
        asks: (book.asks ?? []).map((a: any) => ({ price: a.price, amount: a.amount })),
        recentTrades: (trades._embedded?.records ?? []).map((t: any) => ({
          price: `${t.price?.n}/${t.price?.d}`,
          baseAmount: t.base_amount,
          counterAmount: t.counter_amount,
          at: t.ledger_close_time,
        })),
        observedAt: new Date().toISOString(),
      };
    },
  },
  "escrow-config": {
    id: "escrow-config",
    description: "Live configuration of the Cogladius escrow contract (threshold, grace window, pause state)",
    chargePrice: "0.01",
    sessionPrice: "0.001",
    load: async () => ({ contractId: ESCROW_CONTRACT_ID, ...(await getEscrowConfig()), observedAt: new Date().toISOString() }),
  },
};
