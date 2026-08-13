import { useCallback, useEffect, useRef, useState } from "react";

export function useOperatorResource(
  load: () => Promise<void>,
  { enabled = true, intervalMs = 30_000 } = {},
) {
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const failures = useRef(0);

  const refresh = useCallback(() => {
    if (!enabled) return Promise.resolve();
    if (inFlight.current) return inFlight.current;
    const task = (async () => {
      setRefreshing(true);
      try {
        await load();
        failures.current = 0;
        setError(null);
        setLastUpdatedAt(Date.now());
      } catch (caught) {
        failures.current += 1;
        setError(asError(caught));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    })().finally(() => {
      if (inFlight.current === task) inFlight.current = null;
    });
    inFlight.current = task;
    return task;
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      await refresh();
      if (!active) return;
      const retryDelay = [5_000, 15_000, 30_000, 60_000][
        Math.min(Math.max(failures.current - 1, 0), 3)
      ];
      timer = setTimeout(poll, failures.current ? retryDelay : intervalMs);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    void poll();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", refresh);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", refresh);
    };
  }, [enabled, intervalMs, refresh]);

  return { loading, refreshing, error, lastUpdatedAt, refresh };
}

function asError(value: unknown) {
  return value instanceof Error
    ? value
    : new Error("Unknown operator API error");
}
