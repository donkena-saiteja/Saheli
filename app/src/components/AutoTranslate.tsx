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

/**
 * What we know about one text node.
 *
 * `source` is the English original we translate from; `applied` is the exact
 * string this component last wrote into the DOM. Keeping both is what lets us
 * tell our own writes apart from React's — see `syncNodeState`.
 */
interface NodeState {
  source: string;
  applied: string;
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

  const textStateRef = useRef(new WeakMap<Text, NodeState>());
  const attrStateRef = useRef(new WeakMap<HTMLElement, Record<string, NodeState>>());
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
    // Declared up front so `applyTranslations` can drain the observer's queue of
    // its own writes before re-enabling it.
    let observer: MutationObserver | null = null;

    /**
     * Reconciles what we last wrote with what is in the DOM now.
     *
     * The previous implementation cached the first text it ever saw in a node
     * and unconditionally restored it, so any React re-render was silently
     * reverted — which is why the sign-in role badge stayed on "Member" no
     * matter which role you picked. If the current text differs from what we
     * applied, the application changed it and that new text becomes the source
     * of truth.
     */
    const syncNodeState = (current: string, state: NodeState | undefined): NodeState => {
      if (!state) {
        return { source: current, applied: current };
      }
      if (current !== state.applied) {
        state.source = current;
        state.applied = current;
      }
      return state;
    };

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

        const state = syncNodeState(node.textContent ?? '', textStateRef.current.get(node));
        textStateRef.current.set(node, state);

        if (shouldTranslateText(state.source)) {
          nodes.push(node);
        }
        current = walker.nextNode();
      }
      return nodes;
    };

    const collectAttrNodes = (): Array<{ el: HTMLElement; attr: string; state: NodeState }> => {
      const attrs = ['placeholder', 'title', 'aria-label'];
      const result: Array<{ el: HTMLElement; attr: string; state: NodeState }> = [];

      const all = Array.from(
        document.querySelectorAll<HTMLElement>('input, textarea, button, [title], [aria-label]'),
      );
      for (const el of all) {
        if (hasNoTranslateMarker(el)) continue;
        if (EXCLUDED_TAGS.has(el.tagName)) continue;

        let stateMap = attrStateRef.current.get(el);
        if (!stateMap) {
          stateMap = {};
          attrStateRef.current.set(el, stateMap);
        }

        for (const attr of attrs) {
          const current = el.getAttribute(attr);
          if (!current) continue;

          const state = syncNodeState(current, stateMap[attr]);
          stateMap[attr] = state;

          if (shouldTranslateText(state.source)) {
            result.push({ el, attr, state });
          }
        }
      }

      return result;
    };

    /** Writes text without letting the observer treat it as an app-side change. */
    const write = (apply: () => void) => {
      applyingRef.current = true;
      apply();
      // Discard the records our own writes just generated, otherwise the
      // observer re-fires immediately and we translate our own output.
      observer?.takeRecords();
      applyingRef.current = false;
    };

    const applyTranslations = async () => {
      const textNodes = collectTextNodes();
      const attrNodes = collectAttrNodes();

      if (language === 'English') {
        write(() => {
          for (const node of textNodes) {
            const state = textStateRef.current.get(node);
            if (state && node.textContent !== state.source) {
              node.textContent = state.source;
              state.applied = state.source;
            }
          }
          for (const { el, attr, state } of attrNodes) {
            if (el.getAttribute(attr) !== state.source) {
              el.setAttribute(attr, state.source);
              state.applied = state.source;
            }
          }
        });
        return;
      }

      const uniqueSources = new Set<string>();
      textNodes.forEach((node) => {
        const state = textStateRef.current.get(node);
        if (state?.source) uniqueSources.add(state.source);
      });
      attrNodes.forEach(({ state }) => uniqueSources.add(state.source));

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

      write(() => {
        for (const node of textNodes) {
          const state = textStateRef.current.get(node);
          if (!state?.source) continue;
          // Re-read: an async translation round-trip gives React time to render
          // something new into this node, and that must win over a stale result.
          if (node.textContent !== state.applied) continue;

          const translated = translatedBySource.get(state.source) || state.source;
          if (node.textContent !== translated) {
            node.textContent = translated;
            state.applied = translated;
          }
        }

        for (const { el, attr, state } of attrNodes) {
          if (el.getAttribute(attr) !== state.applied) continue;
          const translated = translatedBySource.get(state.source) || state.source;
          if (el.getAttribute(attr) !== translated) {
            el.setAttribute(attr, translated);
            state.applied = translated;
          }
        }
      });
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

    observer = new MutationObserver(() => {
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
      observer?.disconnect();
      observer = null;
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
