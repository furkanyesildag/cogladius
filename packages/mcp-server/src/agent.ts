/**
 * The agent context behind the MCP tools: one Stellar key, wrapped in a spend
 * policy, driving the Cogladius SDK. Everything an LLM can do through the
 * tools goes through this object, so the policy applies to all of it.
 */

import {
  CogladiusClient,
  KeypairSigner,
  ScopedSigner,
  PaymentSession,
  JsonFileStore,
  createChargePayer,
  resolveNetwork,
  loadIdentity,
  identityPath,
  toStroops,
  fromStroops,
  explorerTx,
  type NetworkConfig,
} from "cogladius";
import { join } from "node:path";

export interface AgentConfig {
  secret: string;
  /** API key from `cogladius join`; registration is skipped when present. */
  apiKey?: string;
  name?: string;
  network: "mainnet" | "testnet";
  apiBaseUrl?: string;
  rpcUrl?: string;
  /** Lifetime spend cap for this process, XLM. */
  maxSpend: string;
  maxPerPayment: string;
  maxSessionDeposit: string;
  stateDir?: string;
}

export function configFromEnv(env = process.env): AgentConfig {
  // COGLADIUS_AGENT_SECRET wins; otherwise use the identity `npx -y https://www.cogladius.xyz/cli-0.2.1.tgz join` created,
  // so MCP client configs never have to contain the secret.
  const identity = env.COGLADIUS_AGENT_SECRET ? null : loadIdentity(identityPath(env));
  const secret = env.COGLADIUS_AGENT_SECRET || identity?.secret;
  if (!secret) {
    throw new Error(
      "No agent key found. Run `npx -y https://www.cogladius.xyz/cli-0.2.1.tgz join` once (it creates and registers ~/.cogladius/agent.json), " +
        "or set COGLADIUS_AGENT_SECRET to the secret key (S...) of a Stellar account dedicated to this agent. " +
        "Fund it with only what the agent may spend; COGLADIUS_MAX_SPEND_XLM caps spending per process."
    );
  }
  return {
    secret,
    apiKey: identity?.apiKey,
    name: identity?.name,
    network: (env.COGLADIUS_NETWORK ?? identity?.network) === "testnet" ? "testnet" : "mainnet",
    apiBaseUrl: env.COGLADIUS_API_URL ?? identity?.apiBaseUrl,
    rpcUrl: env.SOROBAN_RPC_URL,
    maxSpend: env.COGLADIUS_MAX_SPEND_XLM ?? "2",
    maxPerPayment: env.COGLADIUS_MAX_PER_PAYMENT_XLM ?? "0.1",
    maxSessionDeposit: env.COGLADIUS_MAX_SESSION_DEPOSIT_XLM ?? "1",
    stateDir: env.COGLADIUS_STATE_DIR,
  };
}

export class AgentContext {
  readonly net: NetworkConfig;
  readonly signer: ScopedSigner;
  readonly client: CogladiusClient;
  readonly store: JsonFileStore;
  #charge?: ReturnType<typeof createChargePayer>;
  #session?: PaymentSession;
  #mppInfo?: any;
  readonly log: { at: string; kind: string; detail: string; tx?: string }[] = [];

  constructor(readonly cfg: AgentConfig, fetchImpl?: typeof fetch) {
    this.net = resolveNetwork(cfg.network, { apiBaseUrl: cfg.apiBaseUrl, rpcUrl: cfg.rpcUrl });
    this.signer = new ScopedSigner(KeypairSigner.fromSecret(cfg.secret), {
      maxTotal: toStroops(cfg.maxSpend),
      maxPerPayment: toStroops(cfg.maxPerPayment),
      maxSessionDeposit: toStroops(cfg.maxSessionDeposit),
    });
    this.client = new CogladiusClient({ signer: this.signer, network: this.net, fetch: fetchImpl, apiKey: cfg.apiKey, profile: { name: cfg.name ?? `MCP_${this.signer.publicKey.slice(-6)}` } });
    this.store = new JsonFileStore(join(cfg.stateDir ?? join(process.env.HOME ?? ".", ".cogladius"), `mcp-${this.signer.publicKey}.json`));
  }

  record(kind: string, detail: string, tx?: string) {
    this.log.push({ at: new Date().toISOString(), kind, detail, tx: tx ? explorerTx(this.net, tx) : undefined });
  }

  async balance(): Promise<string> {
    const res = await fetch(`${this.net.horizonUrl}/accounts/${this.signer.publicKey}`);
    if (res.status === 404) return "0 (account not funded)";
    const acct: any = await res.json();
    return acct.balances?.find((b: any) => b.asset_type === "native")?.balance ?? "0";
  }

  async mppInfo(): Promise<any> {
    if (!this.#mppInfo) {
      const res = await fetch(`${this.net.apiBaseUrl}/api/mpp`);
      const data: any = await res.json();
      if (!data.success) throw new Error(data.error || "provider does not offer MPP payments");
      this.#mppInfo = data;
    }
    return this.#mppInfo;
  }

  charge() {
    this.#charge ??= createChargePayer({
      net: this.net,
      signer: this.signer,
      onPayment: (p) => this.record("mpp-charge", `${fromStroops(p.amount)} XLM → ${p.recipient} for ${p.url}`, p.reference),
    });
    return this.#charge;
  }

  get session(): PaymentSession | undefined {
    return this.#session;
  }

  async openSession(depositXlm: string): Promise<PaymentSession> {
    if (this.#session && !this.#session.record.closeTxHash) return this.#session;
    const info = await this.mppInfo();
    if (!info.session?.channelFactory) throw new Error("provider has no channel factory configured");
    const net = { ...this.net, channelFactoryId: info.session.channelFactory };
    this.#session = await PaymentSession.open({
      net,
      signer: this.signer,
      recipient: info.recipient,
      deposit: toStroops(depositXlm),
      refundWaitingPeriod: info.session.minRefundWaitingPeriodLedgers,
      store: this.store,
    });
    this.record("mpp-session-open", `channel ${this.#session.channel} funded with ${depositXlm} XLM`, this.#session.record.openTxHash);
    return this.#session;
  }

  async resumeSession(channel: string): Promise<PaymentSession> {
    this.#session = await PaymentSession.resume({ net: this.net, signer: this.signer, channel, store: this.store });
    return this.#session;
  }
}
