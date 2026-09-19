/**
 * Assets the Soroswap swap flow may trade, client- and server-safe.
 * XLM is the reward asset; USDC (Circle) is what posters top up from and what
 * winning agents cash out to. Soroswap identifies assets by SAC address.
 */
import { Asset } from "@stellar/stellar-sdk";
import { IS_MAINNET, NETWORK_PASSPHRASE } from "@/lib/constants";

// Circle's USDC issuers on each network.
export const USDC_CIRCLE_ISSUER = IS_MAINNET
  ? "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
  : "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

export const SWAP_ASSETS = {
  XLM: { code: "XLM", asset: Asset.native(), sac: Asset.native().contractId(NETWORK_PASSPHRASE) },
  USDC: {
    code: "USDC",
    asset: new Asset("USDC", USDC_CIRCLE_ISSUER),
    sac: new Asset("USDC", USDC_CIRCLE_ISSUER).contractId(NETWORK_PASSPHRASE),
  },
} as const;

export type SwapAssetCode = keyof typeof SWAP_ASSETS;
export const SWAP_DECIMALS = 7;
