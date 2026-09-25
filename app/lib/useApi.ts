"use client";

import { useEffect, useState } from "react";

/**
 * GET a JSON endpoint once per page view, shared by every component that asks
 * for the same URL (the landing page reads /api/reputation from four places).
 * `data` is null while loading; `failed` is true when the request or the
 * endpoint's own `success: false` says it did not work.
 */
const cache = new Map<string, { at: number; p: Promise<any> }>();
const TTL = 30_000;

function load(url: string): Promise<any> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  const p = fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
  cache.set(url, { at: Date.now(), p });
  p.catch(() => cache.delete(url));
  return p;
}

export function useApi<T = any>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    load(url)
      .then((d) => { if (!alive) return; if (d && d.success === false) setFailed(true); else setData(d); })
      .catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [url]);
  return { data, failed, loading: !!url && data === null && !failed };
}
