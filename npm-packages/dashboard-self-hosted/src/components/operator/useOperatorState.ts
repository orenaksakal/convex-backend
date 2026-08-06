import { useCallback, useEffect, useState } from "react";
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

export function useOperatorState() {
  const [configuration, setConfiguration] =
    useState<OperatorConfiguration | null>(null);
  const [metadata, setMetadata] = useState<OperatorMetadata | null>(null);
  const [status, setStatus] = useState<OperatorStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
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
          setError(asError(statusError));
        }
      } else {
        setStatus(null);
      }
    } catch (requestError) {
      setError(asError(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
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
    error,
    refresh,
    patch,
  };
}

function asError(value: unknown) {
  return value instanceof Error
    ? value
    : new Error("Unknown operator API error");
}
