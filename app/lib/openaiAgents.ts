/** Sunucu tarafı OpenAI yardımcıları — tek kaynak doğrulanmış anahtar + chat çağrısı */

export function resolveOpenAiApiKey(): string | null {
  const k = process.env.OPENAI_API_KEY?.trim();
  if (!k || !k.startsWith("sk-")) return null;
  return k;
}

/** Tek env ile tüm uçları yönlendirmek için; alt modeller için _AGENT / _JUDGE / _NEXUS */
export function getOpenAiChatModel(role: "default" | "agent" | "judge" | "nexus" = "default"): string {
  const specific =
    role === "agent"
      ? process.env.OPENAI_CHAT_MODEL_AGENT
      : role === "judge"
        ? process.env.OPENAI_CHAT_MODEL_JUDGE
        : role === "nexus"
          ? process.env.OPENAI_CHAT_MODEL_NEXUS
          : undefined;
  return (specific ?? process.env.OPENAI_CHAT_MODEL ?? "gpt-4o").trim();
}

export type ChatMessage = { role: string; content: string };

const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

export async function openaiChatCompletion(payload: {
  messages: ChatMessage[];
  model?: string;
  max_tokens?: number;
  temperature?: number;
  response_format?: { type: "json_object" };
  maxRetries?: number;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const key = resolveOpenAiApiKey();
  if (!key) {
    return {
      ok: false,
      error: "OPENAI_API_KEY tanımlı değil veya sk- ile başlamıyor (.env.local / Vercel env)",
    };
  }

  const maxRetries = payload.maxRetries ?? 2;
  let lastError = "Bilinmeyen hata";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 1s, 2s
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const body: Record<string, unknown> = {
        model: payload.model ?? getOpenAiChatModel("default"),
        messages: payload.messages,
        max_tokens: payload.max_tokens ?? 900,
        temperature: payload.temperature ?? 0.75,
      };
      if (payload.response_format) body.response_format = payload.response_format;

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timer);

      const data = (await res.json().catch(() => ({}))) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };

      if (!res.ok) {
        lastError = data?.error?.message ?? `OpenAI HTTP ${res.status}`;
        // Retry on rate-limit or server errors
        if (RETRY_STATUS_CODES.has(res.status)) continue;
        return { ok: false, error: lastError };
      }

      const text = data.choices?.[0]?.message?.content?.trim() ?? "";
      if (!text) {
        lastError = "OpenAI boş yanıt döndü.";
        continue;
      }

      return { ok: true, text };
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof Error && e.name === "AbortError") {
        lastError = `OpenAI isteği zaman aşımına uğradı (${REQUEST_TIMEOUT_MS / 1000}s)`;
      } else {
        lastError = e instanceof Error ? e.message : "Bilinmeyen bağlantı hatası";
      }
      // Network errors are worth retrying
    }
  }

  return { ok: false, error: lastError };
}
