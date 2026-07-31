import { useState, useEffect, useCallback, useRef } from 'react';

type FetchState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

// ─── Generic fetch hook ───────────────────────────────────────────────────────
export function useApiFetch<T>(
  fetchFn: () => Promise<T>,
  deps: unknown[] = [],
): FetchState<T> & { refetch: () => Promise<void> } {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  // A slow response that resolves after a newer one must not overwrite it.
  const requestSeq = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetch = useCallback(
    async (options?: { silent?: boolean }) => {
      const seq = (requestSeq.current += 1);
      if (!options?.silent) {
        setState((s) => ({ ...s, loading: true, error: null }));
      }

      try {
        const data = await fetchFn();
        if (!mounted.current || seq !== requestSeq.current) return;
        setState({ data, loading: false, error: null });
      } catch (err) {
        if (!mounted.current || seq !== requestSeq.current) return;
        // Keep whatever we already had. Blanking `data` on a transient failure
        // is what used to make a whole approvals list disappear mid-session.
        setState((s) => ({ data: s.data, loading: false, error: (err as Error).message }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );

  useEffect(() => {
    void fetch();
  }, [fetch]);

  const refetch = useCallback(() => fetch(), [fetch]);

  return { ...state, refetch };
}

// ─── Polling hook (auto-refresh) ──────────────────────────────────────────────
/**
 * Background refresh on an interval.
 *
 * Polls are silent: they never flip `loading` back to true, so a list does not
 * flash skeletons every few seconds, and they never clear `data` on a blip.
 */
export function useApiPolling<T>(
  fetchFn: () => Promise<T>,
  intervalMs: number = 5000,
  deps: unknown[] = [],
): FetchState<T> & { refetch: () => Promise<void> } {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  const requestSeq = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (silent: boolean) => {
      const seq = (requestSeq.current += 1);
      if (!silent) setState((s) => ({ ...s, loading: true, error: null }));

      try {
        const data = await fetchFn();
        if (!mounted.current || seq !== requestSeq.current) return;
        setState({ data, loading: false, error: null });
      } catch (err) {
        if (!mounted.current || seq !== requestSeq.current) return;
        setState((s) => ({ data: s.data, loading: false, error: (err as Error).message }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );

  useEffect(() => {
    void run(false);
  }, [run]);

  useEffect(() => {
    const id = setInterval(() => {
      void run(true);
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, run]);

  const refetch = useCallback(() => run(true), [run]);

  return { ...state, refetch };
}

// ─── Mutation hook ────────────────────────────────────────────────────────────
export function useApiMutation<TInput, TOutput>(
  mutateFn: (input: TInput) => Promise<TOutput>,
): {
  mutate: (input: TInput) => Promise<TOutput>;
  loading: boolean;
  error: string | null;
} {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutate = async (input: TInput): Promise<TOutput> => {
    setLoading(true);
    setError(null);
    try {
      const result = await mutateFn(input);
      setLoading(false);
      return result;
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      setLoading(false);
      throw err;
    }
  };

  return { mutate, loading, error };
}
