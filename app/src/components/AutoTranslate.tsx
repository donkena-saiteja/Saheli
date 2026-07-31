import { useEffect, useRef } from 'react';
import { languageMeta, useLanguage } from '../contexts/LanguageContext';

const EXCLUDED_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'CODE',
  'PRE',
  'KBD',
  'SAMP',
  'TEXTAREA',
  'SVG',
]);

function shouldTranslateText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.length < 2) return false;
  // Only auto-translate content that looks like natural language text.
  return /[A-Za-z]/.test(trimmed);
}

function hasNoTranslateMarker(el: HTMLElement | null): boolean {
  let current: HTMLElement | null = el;
  while (current) {
    if (current.dataset?.noAutoTranslate === 'true') {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

async function sarvamBatchTranslate(texts: string[], targetCode: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!texts.length) {
    return result;
  }

  try {
    const res = await fetch('/api/translate/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        texts,
        sourceLanguageCode: 'en',
        targetLanguageCode: targetCode,
      }),
    });

    if (!res.ok) {
      return result;
    }

    const json = (await res.json()) as {
      data?: {
        translations?: Array<{ originalText: string; translatedText: string }>;
      };
    };

    for (const item of json?.data?.translations || []) {
      if (item.originalText && item.translatedText) {
        result.set(item.originalText, item.translatedText);
      }
    }
  } catch {
    return result;
  }

  return result;
}

export default function AutoTranslate() {
  const { language } = useLanguage();
  const targetCode = languageMeta[language].code;

  const textOriginalRef = useRef(new WeakMap<Text, string>());
  const attrOriginalRef = useRef(new WeakMap<HTMLElement, Record<string, string>>());
  const cacheRef = useRef<Map<string, string>>(new Map());
  const pendingKeysRef = useRef<Set<string>>(new Set());
  const applyingRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  const chunkArray = (items: string[], chunkSize: number): string[][] => {
    const chunks: string[][] = [];
    for (let i = 0; i < items.length; i += chunkSize) {
      chunks.push(items.slice(i, i + chunkSize));
    }
    return chunks;
  };

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    let cancelled = false;

    const collectTextNodes = (): Text[] => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      let current: Node | null = walker.nextNode();
      while (current) {
        const node = current as Text;
        const parent = node.parentElement;
        if (!parent) {
          current = walker.nextNode();
          continue;
        }
        if (EXCLUDED_TAGS.has(parent.tagName) || hasNoTranslateMarker(parent)) {
          current = walker.nextNode();
          continue;
        }

        const source = textOriginalRef.current.get(node) ?? node.textContent ?? '';
        if (!textOriginalRef.current.has(node)) {
          textOriginalRef.current.set(node, source);
        }

        if (shouldTranslateText(source)) {
          nodes.push(node);
        }
        current = walker.nextNode();
      }
      return nodes;
    };

    const collectAttrNodes = (): Array<{ el: HTMLElement; attr: string; source: string }> => {
      const attrs = ['placeholder', 'title', 'aria-label'];
      const result: Array<{ el: HTMLElement; attr: string; source: string }> = [];

      const all = Array.from(document.querySelectorAll<HTMLElement>('input, textarea, button, [title], [aria-label]'));
      for (const el of all) {
        if (hasNoTranslateMarker(el)) continue;
        if (EXCLUDED_TAGS.has(el.tagName)) continue;

        let originalMap = attrOriginalRef.current.get(el);
        if (!originalMap) {
          originalMap = {};
          attrOriginalRef.current.set(el, originalMap);
        }

        for (const attr of attrs) {
          const current = el.getAttribute(attr);
          if (!current) continue;
          if (!(attr in originalMap)) {
            originalMap[attr] = current;
          }
          const source = originalMap[attr];
          if (shouldTranslateText(source)) {
            result.push({ el, attr, source });
          }
        }
      }

      return result;
    };

    const applyTranslations = async () => {
      const textNodes = collectTextNodes();
      const attrNodes = collectAttrNodes();

      if (language === 'English') {
        for (const node of textNodes) {
          const source = textOriginalRef.current.get(node);
          if (typeof source === 'string' && node.textContent !== source) {
            node.textContent = source;
          }
        }
        for (const { el, attr } of attrNodes) {
          const original = attrOriginalRef.current.get(el)?.[attr];
          if (original && el.getAttribute(attr) !== original) {
            el.setAttribute(attr, original);
          }
        }
        return;
      }

      const uniqueSources = new Set<string>();
      textNodes.forEach((node) => {
        const source = textOriginalRef.current.get(node);
        if (source) uniqueSources.add(source);
      });
      attrNodes.forEach(({ source }) => uniqueSources.add(source));

      const translatedBySource = new Map<string, string>();
      const uncached = [...uniqueSources].filter((source) => {
        const key = `${targetCode}::${source}`;
        return !cacheRef.current.has(key) && !pendingKeysRef.current.has(key);
      });
      if (uncached.length) {
        const chunks = chunkArray(uncached, 25);
        for (const chunk of chunks) {
          chunk.forEach((source) => pendingKeysRef.current.add(`${targetCode}::${source}`));
          const batched = await sarvamBatchTranslate(chunk, targetCode);
          for (const source of chunk) {
            const cacheKey = `${targetCode}::${source}`;
            const translated = batched.get(source) || source;
            cacheRef.current.set(cacheKey, translated);
            pendingKeysRef.current.delete(cacheKey);
          }
        }
      }

      for (const source of uniqueSources) {
        const translated = cacheRef.current.get(`${targetCode}::${source}`) || source;
        translatedBySource.set(source, translated);
      }

      if (cancelled) return;

      applyingRef.current = true;
      for (const node of textNodes) {
        const source = textOriginalRef.current.get(node);
        if (!source) continue;
        const translated = translatedBySource.get(source) || source;
        if (node.textContent !== translated) {
          node.textContent = translated;
        }
      }

      for (const { el, attr, source } of attrNodes) {
        const translated = translatedBySource.get(source) || source;
        if (el.getAttribute(attr) !== translated) {
          el.setAttribute(attr, translated);
        }
      }
      applyingRef.current = false;
    };

    const scheduleApply = () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        if (applyingRef.current) {
          return;
        }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(() => {
        void applyTranslations();
      });
      }, 120);
    };

    scheduleApply();

    const observer = new MutationObserver(() => {
      if (applyingRef.current) {
        return;
      }
      scheduleApply();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['placeholder', 'title', 'aria-label'],
    });

    return () => {
      cancelled = true;
      observer.disconnect();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [language, targetCode]);

  return null;
}
