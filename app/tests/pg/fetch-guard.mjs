/**
 * Preload for every Postgres test run. Lets nothing leave this machine:
 *  - *.neon.test goes to the local Neon HTTP shim (NEON_SHIM_URL)
 *  - loopback passes
 *  - /chat/completions answers from STUB_JUDGE ("<score>" or "fail"), so no judge is ever called
 *  - everything else throws, and the host is recorded in globalThis.__blockedHosts
 */
const realFetch = globalThis.fetch;
globalThis.__blockedHosts = [];

globalThis.fetch = async function guardedFetch(input, init) {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname.endsWith(".neon.test")) {
    if (!process.env.NEON_SHIM_URL) throw new Error("NEON_SHIM_URL is not set");
    return realFetch(`${process.env.NEON_SHIM_URL}/sql`, init);
  }
  if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return realFetch(input, init);
  if (url.pathname.endsWith("/chat/completions") && process.env.STUB_JUDGE) {
    if (process.env.STUB_JUDGE === "fail") return new Response("stub failure", { status: 400 });
    const content = JSON.stringify({ score: Number(process.env.STUB_JUDGE), reasoning: "stub" });
    return Response.json({ choices: [{ message: { content } }] });
  }
  globalThis.__blockedHosts.push(url.hostname);
  throw new Error(`fetch-guard: blocked request to ${url.hostname}`);
};
