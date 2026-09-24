import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pjoin } from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { join, addMcp, loadIdentity, verifySep53, MAINNET_PASSPHRASE } from "../../src/index.js";
import { installMcp, NPX_LAUNCH, MCP_PACKAGE, PACKAGE_VERSION } from "../../src/join.js";

function mockServer() {
  const calls = { register: 0 };
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    if (u.pathname === "/api/agents/challenge") {
      const pubkey = u.searchParams.get("pubkey")!;
      const message = ["Cogladius agent registration", `network: ${MAINNET_PASSPHRASE}`, `agent: ${pubkey}`, "nonce: n1"].join("\n");
      (calls as any).message = message;
      return new Response(JSON.stringify({ success: true, nonce: "n1", message }));
    }
    if (u.pathname === "/api/agents/register") {
      calls.register++;
      const body = JSON.parse(String(init!.body));
      const ok = verifySep53(body.pubkey, (calls as any).message, Buffer.from(body.signature, "base64"));
      return new Response(JSON.stringify(ok ? { success: true, apiKey: `claw_${calls.register}` } : { success: false }), { status: ok ? 200 : 401 });
    }
    if (u.pathname.startsWith("/accounts/")) return new Response("{}", { status: 404 });
    return new Response("{}", { status: 404 });
  };
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

let dir: string;
let file: string;
beforeEach(() => {
  delete process.env.CODEX_HOME; // the Codex tests write under their own temp home
  dir = mkdtempSync(pjoin(tmpdir(), "cogladius-join-"));
  file = pjoin(dir, "agent.json");
});

describe("cogladius join", () => {
  it("creates a key, registers it and stores both owner-only", async () => {
    const { calls, fetchImpl } = mockServer();
    const r = await join({ name: "tester" }, { fetch: fetchImpl, identityFile: file });
    expect(r.created).toBe(true);
    expect(r.apiKey).toBe("claw_1");
    expect(r.funded).toBe(false);
    expect(calls.register).toBe(1);
    const id = loadIdentity(file)!;
    expect(id.publicKey).toBe(r.publicKey);
    expect(id.apiKey).toBe("claw_1");
    expect(id.name).toBe("tester");
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("is idempotent: a second run keeps the key and does not re-register", async () => {
    const { calls, fetchImpl } = mockServer();
    const a = await join({}, { fetch: fetchImpl, identityFile: file });
    const b = await join({}, { fetch: fetchImpl, identityFile: file });
    expect(b.publicKey).toBe(a.publicKey);
    expect(b.created).toBe(false);
    expect(b.alreadyRegistered).toBe(true);
    expect(calls.register).toBe(1);
  });

  it("refuses to overwrite a stored key with a different secret", async () => {
    const { fetchImpl } = mockServer();
    const a = await join({}, { fetch: fetchImpl, identityFile: file });
    await expect(join({ secret: Keypair.random().secret() }, { fetch: fetchImpl, identityFile: file })).rejects.toThrow(/already holds agent/);
    expect(loadIdentity(file)!.publicKey).toBe(a.publicKey);
  });

  it("joins with a provided secret when none is stored", async () => {
    const { fetchImpl } = mockServer();
    const kp = Keypair.random();
    const r = await join({ secret: kp.secret() }, { fetch: fetchImpl, identityFile: file });
    expect(r.publicKey).toBe(kp.publicKey());
    expect(r.created).toBe(false);
  });

  it("drops the API key when the network changes", async () => {
    const { calls, fetchImpl } = mockServer();
    await join({}, { fetch: fetchImpl, identityFile: file });
    const id = loadIdentity(file)!;
    id.network = "testnet";
    writeFileSync(file, JSON.stringify(id));
    await expect(join({ network: "mainnet" }, { fetch: fetchImpl, identityFile: file })).resolves.toBeTruthy();
    expect(calls.register).toBe(2);
  });

  it("rejects a hand-edited file whose public key does not match the secret", () => {
    const kp = Keypair.random();
    writeFileSync(file, JSON.stringify({ version: 1, network: "mainnet", publicKey: Keypair.random().publicKey(), secret: kp.secret(), createdAt: "" }));
    expect(() => loadIdentity(file)).toThrow(/does not match/);
  });
});

describe("MCP wiring", () => {
  it("adds the server to Claude Code once, without any secret in the command", () => {
    const cmds: string[][] = [];
    let present = false;
    const run = (cmd: string, args: string[]) => {
      cmds.push([cmd, ...args]);
      if (args[0] === "--version") return 0;
      if (args[1] === "get") return present ? 0 : 1;
      if (args[1] === "add") { present = true; return 0; }
      return 1;
    };
    const output = () => `cogladius:\n  Command: npx\n  Args: -y ${MCP_PACKAGE}\n`;
    expect(addMcp("claude", { run, output }).status).toBe("added");
    expect(addMcp("claude", { run, output }).status).toBe("already-present");
    const add = cmds.find((c) => c[2] === "add")!;
    expect(add).toEqual(["claude", "mcp", "add", "--scope", "user", "cogladius", "--", "npx", "-y", MCP_PACKAGE]);
    expect(add.join(" ")).not.toMatch(/\bS[A-Z2-7]{55}\b/);
  });

  it("skips Claude Code when the CLI is missing", () => {
    expect(addMcp("claude", { run: () => null }).status).toBe("skipped");
  });

  it("merges into an existing Cursor config and keeps other servers", () => {
    mkdirSync(pjoin(dir, ".cursor"));
    writeFileSync(pjoin(dir, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    expect(addMcp("cursor", { home: dir }).status).toBe("added");
    expect(addMcp("cursor", { home: dir }).status).toBe("already-present");
    const cfg = JSON.parse(readFileSync(pjoin(dir, ".cursor", "mcp.json"), "utf8"));
    expect(cfg.mcpServers.other).toEqual({ command: "x" });
    expect(cfg.mcpServers.cogladius).toEqual({ command: "npx", args: ["-y", MCP_PACKAGE] });
  });

  it("appends a Codex block once and keeps the rest of config.toml", () => {
    mkdirSync(pjoin(dir, ".codex"));
    writeFileSync(pjoin(dir, ".codex", "config.toml"), 'model = "x"');
    expect(addMcp("codex", { home: dir }).status).toBe("added");
    expect(addMcp("codex", { home: dir }).status).toBe("already-present");
    const toml = readFileSync(pjoin(dir, ".codex", "config.toml"), "utf8");
    expect(toml.startsWith('model = "x"\n')).toBe(true);
    expect(toml.match(/\[mcp_servers\.cogladius\]/g)).toHaveLength(1);
  });
});

describe("MCP fast start", () => {
  // npx of a tarball URL reinstalls on every start (20 to 45 s), over Codex's 10 s
  // MCP startup timeout. join --client installs once and launches with node.
  const entryIn = (d: string) => pjoin(d, "node_modules", "cogladius-mcp", "dist", "index.js");

  it("installs the server once next to agent.json and launches it with node", () => {
    const cmds: string[][] = [];
    const launch = installMcp({ identityFile: file, run: (c, a) => (cmds.push([c, ...a]), 0), exists: () => true });
    const mcpDir = pjoin(dir, "mcp");
    expect(cmds).toEqual([["npm", "install", "--prefix", mcpDir, "--no-audit", "--no-fund", "--loglevel=error", MCP_PACKAGE]]);
    expect(launch).toEqual({ command: "node", args: [entryIn(mcpDir)], local: true });
  });

  it("falls back to npx, and says so, when the install fails", () => {
    const launch = installMcp({ identityFile: file, run: () => 1, exists: () => false });
    expect(launch.command).toBe(NPX_LAUNCH.command);
    expect(launch.args).toEqual(NPX_LAUNCH.args);
    expect(launch.local).toBe(false);
    expect(launch.detail).toMatch(/npm exited 1/);
  });

  it("join --client claude --client codex wires both to the local install, with no secret", async () => {
    const { fetchImpl } = mockServer();
    const cmds: string[][] = [];
    const run = (c: string, a: string[]) => {
      cmds.push([c, ...a]);
      if (c === "npm") return 0;
      if (a[0] === "--version") return 0;
      if (a[1] === "get") return 1;
      return 0;
    };
    const r = await join({ clients: ["claude", "codex"] }, { fetch: fetchImpl, identityFile: file, home: dir, run, exists: () => true, readText: () => null, cogladiusHome: "" });
    expect(r.mcp.map((m) => m.status)).toEqual(["added", "added"]);
    const entry = entryIn(pjoin(dir, "mcp"));
    expect(cmds.filter((c) => c[0] === "npm")).toHaveLength(1);
    const add = cmds.find((c) => c[0] === "claude" && c[2] === "add")!;
    expect(add).toEqual(["claude", "mcp", "add", "--scope", "user", "cogladius", "--", "node", entry]);
    const toml = readFileSync(pjoin(dir, ".codex", "config.toml"), "utf8");
    expect(toml).toContain(`command = "node"`);
    expect(toml).toContain(`args = ${JSON.stringify([entry])}`);
    expect(toml).toContain("startup_timeout_sec = 60");
    for (const text of [add.join(" "), toml]) expect(text).not.toMatch(/\bS[A-Z2-7]{55}\b/);
  });

  it("hands COGLADIUS_HOME to the server so it reads the same agent.json", () => {
    const run = (c: string, a: string[]) => (a[0] === "--version" ? 0 : a[1] === "get" ? 1 : 0);
    const cmds: string[][] = [];
    addMcp("claude", { run: (c, a) => (cmds.push([c, ...a]), run(c, a)), cogladiusHome: "/srv/agent" });
    expect(cmds.find((c) => c[2] === "add")).toContain("COGLADIUS_HOME=/srv/agent");
    addMcp("codex", { home: dir, cogladiusHome: "/srv/agent" });
    expect(readFileSync(pjoin(dir, ".codex", "config.toml"), "utf8")).toContain('[mcp_servers.cogladius.env]\nCOGLADIUS_HOME = "/srv/agent"');
  });

  it("skips the install when this version is already installed", () => {
    const cmds: string[][] = [];
    const launch = installMcp({
      identityFile: file,
      run: (c, a) => (cmds.push([c, ...a]), 0),
      exists: () => true,
      readText: () => JSON.stringify({ name: "cogladius-mcp", version: PACKAGE_VERSION }),
    });
    expect(cmds).toEqual([]);
    expect(launch.local).toBe(true);
  });

  it("reinstalls when an older version is installed", () => {
    const cmds: string[][] = [];
    installMcp({ identityFile: file, run: (c, a) => (cmds.push([c, ...a]), 0), exists: () => true, readText: () => '{"version":"0.2.1"}' });
    expect(cmds[0][0]).toBe("npm");
  });

  const local = (d: string) => ({ command: "node", args: [pjoin(d, "mcp", "node_modules", "cogladius-mcp", "dist", "index.js")], local: true });

  it("replaces an older Claude Code entry that an earlier join wrote", () => {
    const cmds: string[][] = [];
    const run = (c: string, a: string[]) => (cmds.push([c, ...a]), a[0] === "--version" || a[1] === "get" || a[1] === "remove" || a[1] === "add" ? 0 : 1);
    const output = () => "cogladius:\n  Scope: User config\n  Command: npx\n  Args: -y https://www.cogladius.xyz/mcp-0.2.1.tgz\n";
    const r = addMcp("claude", { run, output }, local(dir));
    expect(r.status).toBe("updated");
    const verbs = cmds.filter((c) => c[0] === "claude" && c[1] === "mcp").map((c) => c[2]);
    expect(verbs).toEqual(["get", "remove", "add"]);
    expect(cmds.find((c) => c[2] === "add")!.slice(-2)).toEqual(local(dir).args.length === 1 ? ["node", local(dir).args[0]] : []);
  });

  it("never touches someone else's server that happens to be called cogladius", () => {
    const cmds: string[][] = [];
    const run = (c: string, a: string[]) => (cmds.push([c, ...a]), 0);
    const r = addMcp("claude", { run, output: () => "cogladius:\n  Command: python\n  Args: my_server.py\n" }, local(dir));
    expect(r.status).toBe("already-present");
    expect(cmds.some((c) => c[2] === "remove" || c[2] === "add")).toBe(false);
  });

  it("rewrites an older Codex block in place and keeps everything around it", () => {
    mkdirSync(pjoin(dir, ".codex"));
    writeFileSync(
      pjoin(dir, ".codex", "config.toml"),
      'model = "x"\n\n[mcp_servers.cogladius]\ncommand = "npx"\nargs = ["-y","https://www.cogladius.xyz/mcp-0.2.1.tgz"]\n\n[mcp_servers.cogladius.env]\nA = "1"\n\n[mcp_servers.other]\ncommand = "y"\n'
    );
    expect(addMcp("codex", { home: dir }, local(dir)).status).toBe("updated");
    const toml = readFileSync(pjoin(dir, ".codex", "config.toml"), "utf8");
    expect(toml.match(/\[mcp_servers\.cogladius\]/g)).toHaveLength(1);
    expect(toml).not.toContain("mcp-0.2.1.tgz");
    expect(toml).not.toContain('A = "1"');
    expect(toml).toContain('command = "node"');
    expect(toml).toContain('model = "x"');
    expect(toml).toContain('[mcp_servers.other]\ncommand = "y"');
    expect(addMcp("codex", { home: dir }, local(dir)).status).toBe("already-present");
  });

  it("leaves a Codex block that is not ours alone", () => {
    mkdirSync(pjoin(dir, ".codex"));
    const mine = '[mcp_servers.cogladius]\ncommand = "python"\nargs = ["s.py"]\n';
    writeFileSync(pjoin(dir, ".codex", "config.toml"), mine);
    expect(addMcp("codex", { home: dir }, local(dir)).status).toBe("already-present");
    expect(readFileSync(pjoin(dir, ".codex", "config.toml"), "utf8")).toBe(mine);
  });

  it("updates an older Cursor entry", () => {
    mkdirSync(pjoin(dir, ".cursor"));
    writeFileSync(pjoin(dir, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { cogladius: { command: "npx", args: ["-y", "https://www.cogladius.xyz/mcp-0.2.1.tgz"] } } }));
    expect(addMcp("cursor", { home: dir }, local(dir)).status).toBe("updated");
    expect(JSON.parse(readFileSync(pjoin(dir, ".cursor", "mcp.json"), "utf8")).mcpServers.cogladius.command).toBe("node");
  });

  it("announces the install only when it actually installs", () => {
    const logs: string[] = [];
    const same = JSON.stringify({ version: PACKAGE_VERSION });
    installMcp({ identityFile: file, run: () => 0, exists: () => true, readText: () => same, log: (m) => logs.push(m) });
    expect(logs).toEqual([]);
    installMcp({ identityFile: file, run: () => 0, exists: () => true, readText: () => null, log: (m) => logs.push(m) });
    expect(logs).toHaveLength(1);
  });

  it("writes Codex config under CODEX_HOME when Codex uses one", () => {
    const codexHome = pjoin(dir, "custom-codex");
    expect(addMcp("codex", { home: dir, codexHome }).detail).toContain(pjoin(codexHome, "config.toml"));
    expect(readFileSync(pjoin(codexHome, "config.toml"), "utf8")).toContain("[mcp_servers.cogladius]");
  });

  it("gives the npx fallback a Codex startup timeout long enough to finish", () => {
    addMcp("codex", { home: dir }, NPX_LAUNCH);
    expect(readFileSync(pjoin(dir, ".codex", "config.toml"), "utf8")).toContain("startup_timeout_sec = 180");
  });
});

describe("release wiring", () => {
  it("PACKAGE_VERSION matches package.json (hosted tarball URLs are versioned)", async () => {
    const { PACKAGE_VERSION, CLI_PACKAGE } = await import("../../src/join.js");
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    expect(PACKAGE_VERSION).toBe(pkg.version);
    expect(CLI_PACKAGE).toContain(`cli-${pkg.version}.tgz`);
  });
});
