import { useState, useEffect, useCallback } from 'react';

type FetchState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

// ─── Generic fetch hook ───────────────────────────────────────────────────────
export function useApiFetch<T>(
  fetchFn: () => Promise<T>,
  deps: unknown[] = [],
): FetchState<T> & { refetch: () => void } {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  const fetch = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchFn();
      setState({ data, loading: false, error: null });
    } catch (err) {
      setState({ data: null, loading: false, error: (err as Error).message });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { ...state, refetch: fetch };
}

// ─── Polling hook (auto-refresh) ──────────────────────────────────────────────
export function useApiPolling<T>(
  fetchFn: () => Promise<T>,
  intervalMs: number = 5000,
): FetchState<T> & { refetch: () => void } {
  const result = useApiFetch<T>(fetchFn);

  useEffect(() => {
    const id = setInterval(() => {
      result.refetch();
    }, intervalMs);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs]);

  return result;
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
