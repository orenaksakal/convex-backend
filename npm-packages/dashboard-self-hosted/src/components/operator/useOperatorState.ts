import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  OperatorApiError,
  OperatorConfiguration,
  OperatorMetadata,
  OperatorStatus,
  operatorGet,
  operatorMutation,
} from "../../lib/operatorApi";

export type OperatorConfigurationResult = {
  current: OperatorConfiguration;
  rollback: OperatorConfiguration;
  restartRequired: boolean;
};

type DeepPartial<T> = {
  [Key in keyof T]?: T[Key] extends Record<string, unknown>
    ? DeepPartial<T[Key]>
    : T[Key];
};

type OperatorStateValue = ReturnType<typeof useOperatorStateValue>;

const OperatorStateContext = createContext<OperatorStateValue | null>(null);

export function OperatorStateProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const value = useOperatorStateValue();
  return createElement(OperatorStateContext.Provider, { value }, children);
}

export function useOperatorState() {
  const value = useContext(OperatorStateContext);
  if (!value) {
    throw new Error(
      "useOperatorState must be used inside OperatorStateProvider",
    );
  }
  return value;
}

function useOperatorStateValue() {
  const [configuration, setConfiguration] =
    useState<OperatorConfiguration | null>(null);
  const [metadata, setMetadata] = useState<OperatorMetadata | null>(null);
  const [status, setStatus] = useState<OperatorStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const failures = useRef(0);
  const refreshInFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(() => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const task = (async () => {
      setRefreshing(true);
      setError(null);
      try {
        const [configurationResponse, nextMetadata] = await Promise.all([
          operatorGet<{ configuration: OperatorConfiguration }>(
            "/v1/configuration",
          ),
          operatorGet<OperatorMetadata>("/v1/metadata"),
        ]);
        setConfiguration(configurationResponse.configuration);
        setMetadata(nextMetadata);
        if (nextMetadata.capabilities.status.read) {
          try {
            const nextStatus = await operatorGet<{ status: OperatorStatus }>(
              "/v1/status",
            );
            setStatus(nextStatus.status);
          } catch (statusError) {
            setStatus(null);
            throw statusError;
          }
        } else {
          setStatus(null);
        }
        failures.current = 0;
        setLastUpdatedAt(Date.now());
      } catch (requestError) {
        failures.current += 1;
        setError(asError(requestError));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    })().finally(() => {
      if (refreshInFlight.current === task) refreshInFlight.current = null;
    });
    refreshInFlight.current = task;
    return task;
  }, []);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      await refresh();
      if (!active) return;
      const retryDelay = [5_000, 15_000, 30_000, 60_000][
        Math.min(Math.max(failures.current - 1, 0), 3)
      ];
      timer = setTimeout(poll, failures.current ? retryDelay : 30_000);
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
  }, [refresh]);

  const patch = useCallback(
    async (
      changes: DeepPartial<OperatorConfiguration>,
    ): Promise<OperatorConfigurationResult> => {
      if (!configuration)
        throw new Error("Operator configuration is unavailable");
      try {
        const result = await operatorMutation<OperatorConfigurationResult>(
          "/v1/configuration",
          "PATCH",
          { baseRevision: configuration.revision, changes },
        );
        setConfiguration(result.current);
        setError(null);
        return result;
      } catch (requestError) {
        const nextError = asError(requestError);
        setError(nextError);
        if (nextError instanceof OperatorApiError && nextError.status === 409) {
          await refresh();
        }
        throw nextError;
      }
    },
    [configuration, refresh],
  );

  return {
    configuration,
    metadata,
    status,
    loading,
    refreshing,
    error,
    lastUpdatedAt,
    refresh,
    patch,
  };
}

function asError(value: unknown) {
  return value instanceof Error
    ? value
    : new Error("Unknown operator API error");
}
