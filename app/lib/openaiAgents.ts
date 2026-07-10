/**
 * Server-side LLM provider — DeepSeek primary, OpenAI fallback.
 *
 * DeepSeek is OpenAI-compatible (`/chat/completions`, Bearer auth, json_object
 * response_format), so a single client powers every role: worker agents, the
 * three-judge panel, and the Agent Court. Keys are server-only.
 *
 * Back-compat: the historical `openaiChatCompletion` / `getOpenAiChatModel` /
 * `resolveOpenAiApiKey` exports are kept so existing routes keep working — they
 * now transparently use DeepSeek when `DEEPSEEK_API_KEY` is set.
 */

export type LlmProvider = "deepseek" | "openai";
export type LlmRole = "default" | "agent" | "judge" | "nexus" | "court";

const DEEPSEEK_BASE_URL = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");

export function resolveDeepseekApiKey(): string | null {
  const k = process.env.DEEPSEEK_API_KEY?.trim();
  return k && k.startsWith("sk-") ? k : null;
}

export function resolveOpenAiApiKey(): string | null {
  const k = process.env.OPENAI_API_KEY?.trim();
  return k && k.startsWith("sk-") ? k : null;
}

/** The provider that will actually be used (DeepSeek wins when both are set). */
export function activeProvider(): LlmProvider | null {
  if (resolveDeepseekApiKey()) return "deepseek";
  if (resolveOpenAiApiKey()) return "openai";
  return null;
}

/** True when any LLM backend is configured. */
export function llmAvailable(): boolean {
  return activeProvider() !== null;
}

function deepseekModel(role: LlmRole): string {
  switch (role) {
    case "judge":
      // Verdicts gate real USDC — default to the stronger model.
      return (process.env.DEEPSEEK_MODEL_JUDGE || "deepseek-v4-pro").trim();
    case "agent":
      return (process.env.DEEPSEEK_MODEL_WORKER || process.env.DEEPSEEK_MODEL || "deepseek-chat").trim();
    default:
      return (process.env.DEEPSEEK_MODEL || "deepseek-chat").trim();
  }
}

function openaiModel(role: LlmRole): string {
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

/** Model id for the active provider + role. */
export function getOpenAiChatModel(role: LlmRole = "default"): string {
  return activeProvider() === "deepseek" ? deepseekModel(role) : openaiModel(role);
}

export type ChatMessage = { role: string; content: string };

const REQUEST_TIMEOUT_MS = 45_000;
const RETRY_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

/**
 * Chat completion against the active provider (DeepSeek or OpenAI). Set
 * `role` to pick a role-specific model, or pass an explicit `model`.
 */
export async function openaiChatCompletion(payload: {
  messages: ChatMessage[];
  model?: string;
  role?: LlmRole;
  max_tokens?: number;
  temperature?: number;
  response_format?: { type: "json_object" };
  maxRetries?: number;
}): Promise<{ ok: true; text: string; provider: LlmProvider } | { ok: false; error: string }> {
  const provider = activeProvider();
  if (!provider) {
    return {
      ok: false,
      error: "The AI engine is not configured.",
    };
  }

  const key = provider === "deepseek" ? resolveDeepseekApiKey()! : resolveOpenAiApiKey()!;
  const url =
    provider === "deepseek"
      ? `${DEEPSEEK_BASE_URL}/chat/completions`
      : "https://api.openai.com/v1/chat/completions";
  const model = payload.model ?? getOpenAiChatModel(payload.role ?? "default");

  const maxRetries = payload.maxRetries ?? 2;
  let lastError = "Unknown error";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * attempt));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const body: Record<string, unknown> = {
        model,
        messages: payload.messages,
        max_tokens: payload.max_tokens ?? 900,
        temperature: payload.temperature ?? 0.75,
      };
      if (payload.response_format) body.response_format = payload.response_format;

      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const data = (await res.json().catch(() => ({}))) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };

      if (!res.ok) {
        lastError = data?.error?.message ?? `${provider} HTTP ${res.status}`;
        if (RETRY_STATUS_CODES.has(res.status)) continue;
        return { ok: false, error: lastError };
      }

      const text = data.choices?.[0]?.message?.content?.trim() ?? "";
      if (!text) {
        lastError = `${provider} returned an empty response.`;
        continue;
      }
      return { ok: true, text, provider };
    } catch (e) {
      clearTimeout(timer);
      lastError =
        e instanceof Error && e.name === "AbortError"
          ? `${provider} request timed out (${REQUEST_TIMEOUT_MS / 1000}s)`
          : e instanceof Error
            ? e.message
            : "Unknown connection error";
    }
  }

  return { ok: false, error: lastError };
}
