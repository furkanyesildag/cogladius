/**
 * MPP charge mode: pay per request. Each paid call is one SEP-41 transfer that
 * settles on-chain on its own.
 *
 * The HTTP 402 challenge/response, credential format and transaction building
 * are @stellar/mpp's, used unmodified. What this module adds is the agent-side
 * guard rail: before any credential is created the challenge is checked
 * (network, asset) and the amount is passed through the signer's spend policy.
 */

import { Mppx, stellar } from "@stellar/mpp/charge/client";
import { Receipt } from "mppx";
import type { NetworkConfig } from "../network.js";
import { mppNetworkId } from "../network.js";
import type { AgentSigner } from "../signer.js";

export interface PaidResponse {
  response: Response;
  /** On-chain reference of the payment (tx hash), when the server returned a receipt. */
  receipt?: { reference: string; status: string; method: string };
  /** Amount paid in stroops, 0n when the resource was free or cached. */
  paid: bigint;
}

export interface ChargePayerOptions {
  net: NetworkConfig;
  signer: AgentSigner;
  /** Tokens the agent agrees to pay in. Defaults to the network's reward asset. */
  allowedCurrencies?: string[];
  onPayment?: (p: { url: string; amount: bigint; recipient: string; reference?: string }) => void;
}

export class ChallengeRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChallengeRejected";
  }
}

export function createChargePayer(opts: ChargePayerOptions) {
  const kp = opts.signer.exportKeypair?.();
  if (!kp) throw new Error("MPP charge mode needs a signer that can export a Keypair (the @stellar/mpp charge client signs with one)");
  const network = mppNetworkId(opts.net);
  const currencies = opts.allowedCurrencies ?? [opts.net.rewardAssetContractId];
  let pending: { amount: bigint; recipient: string } | null = null;

  const mppx = Mppx.create({
    polyfill: false,
    methods: [stellar.charge({ keypair: kp, rpcUrl: opts.net.rpcUrl, mode: "pull" })],
    onChallenge: async (challenge: any, { createCredential }: any) => {
      if (challenge.method !== "stellar" || challenge.intent !== "charge") return undefined;
      const req = challenge.request ?? {};
      const advertised = req.methodDetails?.network;
      if (advertised && advertised !== network) {
        throw new ChallengeRejected(`challenge is for ${advertised}, agent is on ${network}`);
      }
      if (!currencies.includes(req.currency)) {
        throw new ChallengeRejected(`challenge asks for currency ${req.currency}, which is not allowed`);
      }
      const amount = BigInt(req.amount);
      await opts.signer.authorizeSpend({ amount, asset: req.currency, recipient: req.recipient, purpose: "mpp-charge" });
      pending = { amount, recipient: req.recipient };
      return createCredential();
    },
  } as any);

  return {
    async fetch(url: string, init?: RequestInit): Promise<PaidResponse> {
      pending = null;
      // Defensive: RPC pools mix node versions, and a response with XDR newer
      // than the installed stellar-sdk fails to decode before anything is
      // signed or sent, so retrying is safe. (This hit ~1 in 5 payments while
      // @stellar/mpp pinned stellar-sdk 15; see docs/MPP_INTEGRATION_WRITEUP.md.)
      let response: Response | undefined;
      for (let attempt = 0; ; attempt++) {
        try {
          response = await mppx.fetch(url, init);
          break;
        } catch (err: any) {
          if (attempt >= 3 || !/XDR Read Error/i.test(String(err?.message))) throw err;
          console.warn(`[cogladius] charge: retrying after RPC XDR decode error (${attempt + 1})`);
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
      let receipt: PaidResponse["receipt"];
      try {
        const r = Receipt.fromResponse(response) as any;
        receipt = { reference: r.reference, status: r.status, method: r.method };
      } catch {
        /* no receipt header */
      }
      // Only a successful response means the payment settled.
      const paid = pending && response.ok ? (pending as { amount: bigint }).amount : 0n;
      if (pending && response.ok) opts.onPayment?.({ url, amount: paid, recipient: (pending as any).recipient, reference: receipt?.reference });
      return { response, receipt, paid };
    },
  };
}
