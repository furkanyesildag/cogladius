/**
 * Signers. The SDK never reads a secret key from the environment: every call
 * that needs a signature takes an `AgentSigner`. Wrap a signer in
 * `ScopedSigner` to give an agent permission to act within limits (which
 * contracts it may authorize, how much it may spend) without handing it an
 * unrestricted account.
 */

import { createHash } from "node:crypto";
import { Keypair, StrKey, xdr, Address, scValToNative } from "@stellar/stellar-sdk";

const SEP53_PREFIX = "Stellar Signed Message:\n";

/** SEP-53 digest: sha256("Stellar Signed Message:\n" || message). */
export function sep53Digest(message: string | Uint8Array): Buffer {
  const body = typeof message === "string" ? Buffer.from(message, "utf8") : Buffer.from(message);
  return createHash("sha256").update(Buffer.concat([Buffer.from(SEP53_PREFIX, "utf8"), body])).digest();
}

export function verifySep53(publicKey: string, message: string | Uint8Array, signature: Uint8Array): boolean {
  try {
    return Keypair.fromPublicKey(publicKey).verify(sep53Digest(message), Buffer.from(signature));
  } catch {
    return false;
  }
}

/** What a Soroban authorization entry is about to authorize (root call only). */
export interface AuthContext {
  contractId: string;
  functionName: string;
  args: unknown[];
}

/** Details of a payment the SDK is about to make, used for spend policy. */
export interface SpendRequest {
  /** Amount in stroops of `asset`. */
  amount: bigint;
  asset: string;
  recipient: string;
  purpose: "mpp-charge" | "mpp-session-deposit" | "mpp-session-commitment" | "escrow-post" | "fee";
}

export interface AgentSigner {
  readonly publicKey: string;
  /** SEP-53 message signature (64 bytes). */
  signMessage(message: string | Uint8Array): Promise<Uint8Array>;
  /** Sign the sha256 of a HashIdPreimage (a Soroban auth entry payload). */
  signAuthEntry(preimage: xdr.HashIdPreimage, ctx: AuthContext): Promise<Uint8Array>;
  /** Sign a transaction hash (envelope signature). */
  signTransactionHash(hash: Buffer): Promise<Uint8Array>;
  /**
   * Called before the SDK makes a payment. Throw to refuse. The default
   * `KeypairSigner` allows everything; `ScopedSigner` enforces a policy.
   */
  authorizeSpend(req: SpendRequest): Promise<void>;
  /**
   * The raw keypair, for libraries that only accept a Keypair (the MPP charge
   * client). Returns undefined for signers that cannot export one (hardware,
   * remote); features that need it will say so.
   */
  exportKeypair?(): Keypair | undefined;
}

/** A signer backed by an in-process ed25519 keypair. */
export class KeypairSigner implements AgentSigner {
  readonly publicKey: string;
  #kp: Keypair;

  constructor(keypair: Keypair) {
    this.#kp = keypair;
    this.publicKey = keypair.publicKey();
  }

  static fromSecret(secret: string): KeypairSigner {
    return new KeypairSigner(Keypair.fromSecret(secret));
  }

  static random(): KeypairSigner {
    return new KeypairSigner(Keypair.random());
  }

  async signMessage(message: string | Uint8Array): Promise<Uint8Array> {
    return this.#kp.sign(sep53Digest(message));
  }

  async signAuthEntry(preimage: xdr.HashIdPreimage): Promise<Uint8Array> {
    return this.#kp.sign(createHash("sha256").update(preimage.toXDR()).digest());
  }

  async signTransactionHash(hash: Buffer): Promise<Uint8Array> {
    return this.#kp.sign(hash);
  }

  async authorizeSpend(): Promise<void> {}

  exportKeypair(): Keypair {
    return this.#kp;
  }
}

export interface SpendPolicy {
  /** Largest single payment, in stroops. */
  maxPerPayment?: bigint;
  /** Largest total across the signer's lifetime (or until `resetSpend`), in stroops. */
  maxTotal?: bigint;
  /** Largest single MPP session deposit, in stroops. */
  maxSessionDeposit?: bigint;
  /** Contracts the signer may authorize calls to. Unset = any. */
  allowedContracts?: string[];
  /** `contract:function` pairs the signer may authorize. Unset = any function of an allowed contract. */
  allowedFunctions?: string[];
  /** Payment recipients allowed. Unset = any. */
  allowedRecipients?: string[];
}

export class SpendLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpendLimitError";
  }
}

/**
 * Wraps a signer with a policy. Anything outside the policy is refused before
 * a signature is produced, so a compromised or confused agent loop can spend
 * at most `maxTotal` and only touch the listed contracts.
 */
export class ScopedSigner implements AgentSigner {
  readonly publicKey: string;
  #inner: AgentSigner;
  #policy: SpendPolicy;
  #spent = 0n;

  constructor(inner: AgentSigner, policy: SpendPolicy) {
    this.#inner = inner;
    this.#policy = policy;
    this.publicKey = inner.publicKey;
  }

  get spent(): bigint {
    return this.#spent;
  }

  get policy(): Readonly<SpendPolicy> {
    return this.#policy;
  }

  resetSpend(): void {
    this.#spent = 0n;
  }

  signMessage(message: string | Uint8Array): Promise<Uint8Array> {
    return this.#inner.signMessage(message);
  }

  async signAuthEntry(preimage: xdr.HashIdPreimage, ctx: AuthContext): Promise<Uint8Array> {
    const { allowedContracts, allowedFunctions } = this.#policy;
    if (allowedContracts && !allowedContracts.includes(ctx.contractId)) {
      throw new SpendLimitError(`policy: contract ${ctx.contractId} is not allowed`);
    }
    if (allowedFunctions && !allowedFunctions.includes(`${ctx.contractId}:${ctx.functionName}`)) {
      throw new SpendLimitError(`policy: ${ctx.functionName} on ${ctx.contractId} is not allowed`);
    }
    return this.#inner.signAuthEntry(preimage, ctx);
  }

  signTransactionHash(hash: Buffer): Promise<Uint8Array> {
    return this.#inner.signTransactionHash(hash);
  }

  async authorizeSpend(req: SpendRequest): Promise<void> {
    const p = this.#policy;
    if (req.amount < 0n) throw new SpendLimitError("policy: negative amount");
    if (p.allowedRecipients && !p.allowedRecipients.includes(req.recipient)) {
      throw new SpendLimitError(`policy: recipient ${req.recipient} is not allowed`);
    }
    if (req.purpose === "mpp-session-deposit" && p.maxSessionDeposit !== undefined && req.amount > p.maxSessionDeposit) {
      throw new SpendLimitError(`policy: session deposit ${req.amount} exceeds ${p.maxSessionDeposit} stroops`);
    }
    // A commitment is cumulative within an already-funded (and already counted)
    // session deposit, so it does not count again toward the lifetime total.
    if (req.purpose === "mpp-session-commitment") return this.#inner.authorizeSpend(req);
    if (p.maxPerPayment !== undefined && req.amount > p.maxPerPayment && req.purpose !== "mpp-session-deposit") {
      throw new SpendLimitError(`policy: payment ${req.amount} exceeds ${p.maxPerPayment} stroops`);
    }
    if (p.maxTotal !== undefined && this.#spent + req.amount > p.maxTotal) {
      throw new SpendLimitError(`policy: total spend would reach ${this.#spent + req.amount} > ${p.maxTotal} stroops`);
    }
    await this.#inner.authorizeSpend(req);
    this.#spent += req.amount;
  }

  exportKeypair(): Keypair | undefined {
    return this.#inner.exportKeypair?.();
  }
}

/** Describe the root invocation of an auth entry for policy checks. */
export function authContextOf(entry: xdr.SorobanAuthorizationEntry): AuthContext {
  const fn = entry.rootInvocation().function();
  if (fn.switch().name !== "sorobanAuthorizedFunctionTypeContractFn") {
    return { contractId: "(create-contract)", functionName: "__constructor", args: [] };
  }
  const c = fn.contractFn();
  return {
    contractId: Address.fromScAddress(c.contractAddress()).toString(),
    functionName: c.functionName().toString(),
    args: c.args().map((a) => {
      try {
        return scValToNative(a);
      } catch {
        return a.toXDR("base64");
      }
    }),
  };
}

export function isValidPublicKey(pk: string): boolean {
  try {
    return StrKey.isValidEd25519PublicKey(pk);
  } catch {
    return false;
  }
}
