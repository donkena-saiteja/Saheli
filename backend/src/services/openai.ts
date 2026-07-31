/**
 * Thin OpenAI client.
 *
 * Kept deliberately small and dependency-free: one JSON-mode chat call plus one
 * plain-text call, both with a hard timeout. Every caller must degrade
 * gracefully when the key is absent or the request fails — an unfunded or
 * rate-limited API key must never be able to break a live demo.
 */

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 20_000;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function isOpenAIConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.startsWith('sk-'));
}

export function getChatModel(): string {
  return process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
}

/** Reports which brain answered, so the UI can label the source honestly. */
export function getAgentProvider(): 'openai' | 'rules' {
  return isOpenAIConfigured() ? 'openai' : 'rules';
}

async function callOpenAI(
  messages: ChatMessage[],
  options: { json?: boolean; temperature?: number; maxTokens?: number } = {},
): Promise<string | null> {
  if (!isOpenAIConfigured()) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: getChatModel(),
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 1200,
        ...(options.json ? { response_format: { type: 'json_object' } } : {}),
        messages,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.warn(`[openai] ${res.status} ${res.statusText} ${detail.slice(0, 200)}`);
      return null;
    }

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.warn('[openai] request failed:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Free-form completion. Returns null when unavailable so callers can fall back. */
export async function chatCompletion(
  messages: ChatMessage[],
  options?: { temperature?: number; maxTokens?: number },
): Promise<string | null> {
  return callOpenAI(messages, options);
}

/**
 * JSON-mode completion. Returns null on any failure *including* malformed JSON,
 * which keeps every call site on a single "did the model help?" branch.
 */
export async function jsonCompletion<T>(
  messages: ChatMessage[],
  options?: { temperature?: number; maxTokens?: number },
): Promise<T | null> {
  const raw = await callOpenAI(messages, { ...options, json: true });
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.warn('[openai] response was not valid JSON');
    return null;
  }
}
