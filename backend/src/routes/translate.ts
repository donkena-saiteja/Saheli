import { Router, Request, Response } from 'express';

const router = Router();
const translationCache = new Map<string, string>();

type SarvamPayloadPrimary = {
  input: string;
  source_language_code: string;
  target_language_code: string;
};

type SarvamPayloadFallback = {
  text: string;
  source_language: string;
  target_language: string;
};

type TranslateResult = {
  translatedText: string;
  provider: 'sarvam' | 'libre-fallback' | 'passthrough';
  warning?: string;
};

function toSarvamLanguageCode(code: string): string {
  const normalized = (code || '').trim();
  if (!normalized) {
    return 'en-IN';
  }

  if (normalized.includes('-')) {
    return normalized;
  }

  const map: Record<string, string> = {
    en: 'en-IN',
    hi: 'hi-IN',
    te: 'te-IN',
    ta: 'ta-IN',
    kn: 'kn-IN',
    ml: 'ml-IN',
    mr: 'mr-IN',
    gu: 'gu-IN',
    pa: 'pa-IN',
    bn: 'bn-IN',
    or: 'od-IN',
    as: 'as-IN',
    ur: 'ur-IN',
    sa: 'sa-IN',
    ne: 'ne-IN',
    sd: 'sd-IN',
    ks: 'ks-IN',
    mai: 'mai-IN',
    doi: 'doi-IN',
    mni: 'mni-IN',
    sat: 'sat-IN',
    brx: 'brx-IN',
  };

  return map[normalized] || normalized;
}

function toFallbackLanguageCode(code: string): string {
  const normalized = (code || '').trim().toLowerCase();
  if (!normalized) {
    return 'en';
  }

  if (!normalized.includes('-')) {
    return normalized;
  }

  const [base] = normalized.split('-');
  return base || 'en';
}

async function callLibreFallbackTranslate(text: string, sourceCode: string, targetCode: string): Promise<string | null> {
  const fallbackSource = toFallbackLanguageCode(sourceCode);
  const fallbackTarget = toFallbackLanguageCode(targetCode);

  const custom = process.env.FALLBACK_TRANSLATE_API_URL?.trim();
  const endpoints = [
    custom,
    'https://translate.astian.org/translate',
    'https://libretranslate.de/translate',
  ].filter(Boolean) as string[];

  for (const endpoint of endpoints) {
    const timeoutMs = Number(process.env.FALLBACK_TRANSLATE_TIMEOUT_MS || 7000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: text,
          source: fallbackSource,
          target: fallbackTarget,
          format: 'text',
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        continue;
      }

      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const translated = typeof json.translatedText === 'string' ? json.translatedText.trim() : '';
      if (translated) {
        return translated;
      }
    } catch {
      clearTimeout(timer);
      continue;
    }
  }

  return null;
}

function getSarvamConfig() {
  const apiKey = process.env.SARVAM_API_KEY?.trim();
  const apiUrl = (process.env.SARVAM_API_URL || 'https://api.sarvam.ai/translate').trim();
  const apiKeyHeader = (process.env.SARVAM_API_KEY_HEADER || 'api-subscription-key').trim();
  const appId = process.env.SARVAM_APP_ID?.trim();

  return { apiKey, apiUrl, apiKeyHeader, appId };
}

function parseTranslatedText(json: any): string | null {
  return (
    json?.translated_text ||
    json?.translation ||
    json?.output?.translated_text ||
    json?.data?.translated_text ||
    json?.data?.translation ||
    null
  );
}

async function callSarvamTranslate(text: string, sourceCode: string, targetCode: string): Promise<string> {
  const { apiKey, apiUrl, apiKeyHeader, appId } = getSarvamConfig();
  const sarvamSource = toSarvamLanguageCode(sourceCode);
  const sarvamTarget = toSarvamLanguageCode(targetCode);

  if (!apiKey) {
    throw new Error('SARVAM_API_KEY is not configured');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKeyHeader.toLowerCase() === 'authorization') {
    headers.Authorization = apiKey.toLowerCase().startsWith('bearer ') ? apiKey : `Bearer ${apiKey}`;
  } else {
    headers[apiKeyHeader] = apiKey;
  }

  if (appId) {
    headers['x-app-id'] = appId;
  }

  const payloads: Array<SarvamPayloadPrimary | SarvamPayloadFallback> = [
    {
      input: text,
      source_language_code: sarvamSource,
      target_language_code: sarvamTarget,
    },
    {
      text,
      source_language: sarvamSource,
      target_language: sarvamTarget,
    },
  ];

  let lastError = 'Sarvam translation request failed';
  for (const payload of payloads) {
    const timeoutMs = Number(process.env.SARVAM_TIMEOUT_MS || 8000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: globalThis.Response;
    try {
      res = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Sarvam request failed';
      lastError = msg;
      clearTimeout(timer);
      continue;
    }
    clearTimeout(timer);

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const translated = parseTranslatedText(json);
    if (res.ok && translated) {
      return translated;
    }

    const message = typeof json.message === 'string' ? json.message : undefined;
    const error = typeof json.error === 'string' ? json.error : undefined;
    lastError = message || error || `Sarvam request failed (${res.status})`;
  }

  throw new Error(lastError);
}

async function translateWithFallback(text: string, sourceCode: string, targetCode: string): Promise<TranslateResult> {
  const cacheKey = `${sourceCode}::${targetCode}::${text}`;
  const cached = translationCache.get(cacheKey);
  if (cached) {
    return { translatedText: cached, provider: 'sarvam' };
  }

  try {
    const translatedText = await callSarvamTranslate(text, sourceCode, targetCode);
    translationCache.set(cacheKey, translatedText);
    return { translatedText, provider: 'sarvam' };
  } catch (error) {
    const warning = error instanceof Error ? error.message : 'Translation provider failed';

    const fallbackTranslated = await callLibreFallbackTranslate(text, sourceCode, targetCode);
    if (fallbackTranslated) {
      translationCache.set(cacheKey, fallbackTranslated);
      return {
        translatedText: fallbackTranslated,
        provider: 'libre-fallback',
        warning,
      };
    }

    return {
      translatedText: text,
      provider: 'passthrough',
      warning,
    };
  }
}

router.post('/', async (req: Request, res: Response) => {
  const {
    text,
    sourceLanguageCode = 'en',
    targetLanguageCode,
  } = req.body || {};

  if (!text || typeof text !== 'string') {
    res.status(400).json({ success: false, error: 'text is required' });
    return;
  }

  if (!targetLanguageCode || typeof targetLanguageCode !== 'string') {
    res.status(400).json({ success: false, error: 'targetLanguageCode is required' });
    return;
  }

  try {
    const result = await translateWithFallback(text, sourceLanguageCode, targetLanguageCode);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Translation failed',
    });
  }
});

router.post('/batch', async (req: Request, res: Response) => {
  const {
    texts,
    sourceLanguageCode = 'en',
    targetLanguageCode,
  } = req.body || {};

  if (!Array.isArray(texts) || texts.some((t) => typeof t !== 'string')) {
    res.status(400).json({ success: false, error: 'texts must be an array of strings' });
    return;
  }

  if (!targetLanguageCode || typeof targetLanguageCode !== 'string') {
    res.status(400).json({ success: false, error: 'targetLanguageCode is required' });
    return;
  }

  try {
    const uniqueTexts = [...new Set(texts.map((t: string) => t.trim()).filter(Boolean))];
    const concurrency = Math.max(1, Number(process.env.TRANSLATE_BATCH_CONCURRENCY || 4));
    const translatedEntries: Array<{
      originalText: string;
      translatedText: string;
      provider: 'sarvam' | 'libre-fallback' | 'passthrough';
      warning?: string;
    }> = [];

    for (let i = 0; i < uniqueTexts.length; i += concurrency) {
      const chunk = uniqueTexts.slice(i, i + concurrency);
      const chunkResults = await Promise.all(
        chunk.map(async (originalText) => {
          const result = await translateWithFallback(originalText, sourceLanguageCode, targetLanguageCode);
          return {
            originalText,
            translatedText: result.translatedText,
            provider: result.provider,
            warning: result.warning,
          };
        }),
      );
      translatedEntries.push(...chunkResults);
    }

    res.json({ success: true, data: { translations: translatedEntries } });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Batch translation failed',
    });
  }
});

export default router;
