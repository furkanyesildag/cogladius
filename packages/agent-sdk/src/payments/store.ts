/**
 * Durable stores for payment state.
 *
 * `JsonFileStore` implements the mppx AtomicStore contract for a single
 * process: every read-modify-write runs under an in-process mutex and the file
 * is replaced atomically (write to temp, rename), so a crash never leaves a
 * half-written file. It is what the SDK uses by default to remember the last
 * commitment it signed per channel and the session keys it opened.
 *
 * Multi-process deployments need a store whose `update()` is a real
 * compare-and-set (e.g. a Redis Lua script); see the provider module.
 */

import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

type Change<V, R> = { op: "noop"; result: R } | { op: "set"; value: V; result: R } | { op: "delete"; result: R };

export interface AtomicKV {
  get(key: string): Promise<any | null>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  update<R>(key: string, fn: (current: any | null) => Change<any, R>): Promise<R>;
}

export function defaultStateDir(): string {
  return process.env.COGLADIUS_STATE_DIR || join(homedir(), ".cogladius");
}

export class JsonFileStore implements AtomicKV {
  #path: string;
  #lock: Promise<unknown> = Promise.resolve();

  constructor(path = join(defaultStateDir(), "payments.json")) {
    this.#path = path;
  }

  get path(): string {
    return this.#path;
  }

  async get(key: string): Promise<any | null> {
    const data = await this.#read();
    return key in data ? structuredClone(data[key]) : null;
  }

  put(key: string, value: unknown): Promise<void> {
    return this.update(key, () => ({ op: "set", value, result: undefined }));
  }

  delete(key: string): Promise<void> {
    return this.update(key, () => ({ op: "delete", result: undefined }));
  }

  update<R>(key: string, fn: (current: any | null) => Change<any, R>): Promise<R> {
    const run = this.#lock.then(async () => {
      const data = await this.#read();
      const change = fn(key in data ? structuredClone(data[key]) : null);
      if (change.op === "set") data[key] = JSON.parse(JSON.stringify(change.value));
      if (change.op === "delete") delete data[key];
      if (change.op !== "noop") await this.#write(data);
      return change.result;
    });
    this.#lock = run.catch(() => undefined);
    return run;
  }

  async #read(): Promise<Record<string, any>> {
    try {
      return JSON.parse(await fs.readFile(this.#path, "utf8"));
    } catch (err: any) {
      if (err?.code === "ENOENT") return {};
      throw err;
    }
  }

  async #write(data: Record<string, any>): Promise<void> {
    await fs.mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
    const tmp = `${this.#path}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await fs.rename(tmp, this.#path);
  }
}

/** In-memory AtomicKV, for tests and short-lived processes. */
export class MemoryStore implements AtomicKV {
  #m = new Map<string, string>();
  async get(key: string) {
    const v = this.#m.get(key);
    return v === undefined ? null : JSON.parse(v);
  }
  async put(key: string, value: unknown) {
    this.#m.set(key, JSON.stringify(value));
  }
  async delete(key: string) {
    this.#m.delete(key);
  }
  async update<R>(key: string, fn: (current: any | null) => Change<any, R>): Promise<R> {
    const change = fn(await this.get(key));
    if (change.op === "set") this.#m.set(key, JSON.stringify(change.value));
    if (change.op === "delete") this.#m.delete(key);
    return change.result;
  }
}
