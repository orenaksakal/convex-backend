import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Button } from "@ui/Button";
import { Callout } from "@ui/Callout";
import { DeploymentSettingsLayout } from "@common/layouts/DeploymentSettingsLayout";
import { DeploymentInfoContext } from "@common/lib/deploymentContext";
import { OperatorActionConfirmation } from "../../components/operator/OperatorActionConfirmation";
import {
  ExecutedOperatorAction,
  KnobDefinition,
  OperatorApiError,
  OperatorConfiguration,
  OperatorMetadata,
  OperatorStatus,
  PreparedOperatorAction,
  operatorGet,
  operatorMutation,
} from "../../lib/operatorApi";

type RuntimeData = {
  configuration: OperatorConfiguration;
  metadata: OperatorMetadata;
  status: OperatorStatus | null;
};

type ProposedValues = Record<string, string | boolean>;

type RuntimeMetrics = {
  observedAtUnixMs: number;
  exposition: string;
  familyCount: number;
};

export default function RuntimeSettingsPage() {
  const deployment = useContext(DeploymentInfoContext);
  const [data, setData] = useState<RuntimeData | null>(null);
  const [proposed, setProposed] = useState<ProposedValues>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<OperatorApiError | Error | null>(null);
  const [saveResult, setSaveResult] = useState<{
    restartRequired: boolean;
    rollback: OperatorConfiguration;
  } | null>(null);
  const [preparedRestart, setPreparedRestart] =
    useState<PreparedOperatorAction | null>(null);
  const [acceptedRestart, setAcceptedRestart] =
    useState<ExecutedOperatorAction | null>(null);
  const [runtimeMetrics, setRuntimeMetrics] = useState<RuntimeMetrics | null>(
    null,
  );
  const [runtimeMetricsError, setRuntimeMetricsError] = useState<Error | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [configurationResponse, metadata] = await Promise.all([
        operatorGet<{ configuration: OperatorConfiguration }>(
          "/v1/configuration",
        ),
        operatorGet<OperatorMetadata>("/v1/metadata"),
      ]);
      const configuration = configurationResponse.configuration;
      setData({ configuration, metadata, status: null });
      setProposed(toProposed(configuration.runtime.knobs));
      setReviewing(false);
      if (metadata.capabilities.status.read) {
        try {
          const response = await operatorGet<{ status: OperatorStatus }>(
            "/v1/status",
          );
          setData({ configuration, metadata, status: response.status });
        } catch (statusError) {
          setError(asError(statusError));
        }
      }
    } catch (requestError) {
      setError(asError(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!deployment.ok) return;
    let cancelled = false;
    void fetchRuntimeMetrics(deployment)
      .then((metrics) => {
        if (!cancelled) {
          setRuntimeMetrics(metrics);
          setRuntimeMetricsError(null);
        }
      })
      .catch((metricsError: unknown) => {
        if (!cancelled) setRuntimeMetricsError(asError(metricsError));
      });
    return () => {
      cancelled = true;
    };
  }, [deployment]);

  const changes = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.configuration.runtime.knobs).flatMap(
      ([name, current]) => {
        const definition = data.metadata.knobDefinitions[name];
        const parsed = parseProposed(proposed[name], definition);
        return parsed !== current ? [{ name, current, proposed: parsed }] : [];
      },
    );
  }, [data, proposed]);

  const validationIssues = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.metadata.knobDefinitions).flatMap(
      ([name, definition]) =>
        validateProposed(name, proposed[name], definition),
    );
  }, [data, proposed]);

  async function applyChanges() {
    if (!data || changes.length === 0 || validationIssues.length > 0) return;
    setSaving(true);
    setError(null);
    try {
      const knobs = Object.fromEntries(
        changes.map((change) => [change.name, change.proposed]),
      );
      const result = await operatorMutation<{
        current: OperatorConfiguration;
        rollback: OperatorConfiguration;
        restartRequired: boolean;
      }>("/v1/configuration", "PATCH", {
        baseRevision: data.configuration.revision,
        changes: { runtime: { knobs } },
      });
      setSaveResult({
        restartRequired: result.restartRequired,
        rollback: result.rollback,
      });
      setData({ ...data, configuration: result.current });
      setProposed(toProposed(result.current.runtime.knobs));
      setReviewing(false);
    } catch (requestError) {
      const nextError = asError(requestError);
      setError(nextError);
      if (nextError instanceof OperatorApiError && nextError.status === 409) {
        await load();
      }
    } finally {
      setSaving(false);
    }
  }

  async function prepareRestart() {
    if (!data) return;
    setError(null);
    setAcceptedRestart(null);
    try {
      const prepared = await operatorMutation<PreparedOperatorAction>(
        "/v1/actions/prepare",
        "POST",
        {
          kind: "restart",
          instanceId: data.configuration.instance.id,
          baseRevision: data.configuration.revision,
          parameters: {},
        },
      );
      setPreparedRestart(prepared);
    } catch (requestError) {
      setError(asError(requestError));
    }
  }

  return (
    <DeploymentSettingsLayout page="runtime">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h3 className="font-semibold">Runtime capacity</h3>
          <p className="max-w-prose text-sm text-content-secondary">
            Review declared and effective values for this instance. Changes are
            revision-checked and do not restart the backend automatically.
          </p>
        </header>

        {loading && (
          <StatusPanel
            title="Loading operator state"
            detail="Waiting for configuration and effective-state evidence."
          />
        )}
        {error && <ErrorCallout error={error} onRetry={load} />}

        {data && !loading && (
          <>
            <RuntimeSummary data={data} />
            <RuntimeObservability
              metrics={runtimeMetrics}
              error={runtimeMetricsError}
            />
            {saveResult && (
              <Callout
                variant={
                  saveResult.restartRequired ? "instructions" : "success"
                }
              >
                <div>
                  <div className="font-medium">
                    Configuration revision {data.configuration.revision} saved.
                  </div>
                  <div>
                    {saveResult.restartRequired
                      ? "A separately confirmed restart is required before these values become effective."
                      : "No restart is required."}{" "}
                    Previous revision {saveResult.rollback.revision} is retained
                    as the displayed rollback value for this review.
                  </div>
                </div>
              </Callout>
            )}
            {acceptedRestart && (
              <Callout variant="success">
                Restart action <code>{acceptedRestart.actionId}</code> was
                accepted. Refresh after the backend converges to verify the
                effective revision.
              </Callout>
            )}
            <div className="overflow-hidden rounded-lg border bg-background-secondary">
              <div className="grid grid-cols-[minmax(15rem,2fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_minmax(11rem,1.2fr)] gap-3 border-b px-4 py-3 text-xs font-medium tracking-wide text-content-secondary uppercase max-lg:hidden">
                <div>Setting</div>
                <div>Declared</div>
                <div>Effective</div>
                <div>Proposed</div>
              </div>
              <div className="divide-y">
                {groupedKnobs(data.metadata.knobDefinitions).map(
                  ([group, knobs]) => (
                    <section key={group} aria-labelledby={`runtime-${group}`}>
                      <h4
                        id={`runtime-${group}`}
                        className="bg-background-tertiary px-4 py-2 text-sm font-medium"
                      >
                        {group}
                      </h4>
                      <div className="divide-y">
                        {knobs.map(([name, definition]) => (
                          <KnobRow
                            key={name}
                            name={name}
                            definition={definition}
                            current={data.configuration.runtime.knobs[name]}
                            effective={
                              data.status?.runtime.effectiveKnobs?.[name]
                            }
                            proposed={proposed[name]}
                            source={
                              data.configuration.runtime.knobs[name] ===
                              data.metadata.profileDefaults.knobs[name]
                                ? "profile default"
                                : "operator override"
                            }
                            onChange={(value) => {
                              setSaveResult(null);
                              setReviewing(false);
                              setProposed((previous) => ({
                                ...previous,
                                [name]: value,
                              }));
                            }}
                          />
                        ))}
                      </div>
                    </section>
                  ),
                )}
              </div>
            </div>

            {validationIssues.length > 0 && (
              <Callout variant="error">
                <div>
                  <div className="font-medium">
                    Fix proposed values before review.
                  </div>
                  <ul className="list-disc pl-5">
                    {validationIssues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </div>
              </Callout>
            )}

            {reviewing && changes.length > 0 && (
              <section
                className="rounded-lg border bg-background-secondary p-4"
                aria-labelledby="runtime-review-title"
              >
                <h4 id="runtime-review-title" className="font-semibold">
                  Review {changes.length} change
                  {changes.length === 1 ? "" : "s"}
                </h4>
                <p className="mt-1 text-sm text-content-secondary">
                  Target: <code>{data.configuration.instance.id}</code>. Base
                  revision: {data.configuration.revision}. Every setting below
                  requires a backend restart.
                </p>
                <ul className="mt-3 divide-y rounded-sm border">
                  {changes.map((change) => (
                    <li
                      key={change.name}
                      className="grid gap-1 px-3 py-2 text-sm sm:grid-cols-[1fr_auto]"
                    >
                      <code className="break-all">{change.name}</code>
                      <span>
                        <Value value={change.current} /> →{" "}
                        <Value value={change.proposed} />
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button onClick={() => void applyChanges()} loading={saving}>
                    Apply reviewed changes
                  </Button>
                  <Button
                    variant="neutral"
                    onClick={() => setReviewing(false)}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                </div>
              </section>
            )}

            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button
                onClick={() => setReviewing(true)}
                disabled={
                  changes.length === 0 || validationIssues.length > 0 || saving
                }
              >
                Review{" "}
                {changes.length === 0
                  ? "changes"
                  : `${changes.length} change${changes.length === 1 ? "" : "s"}`}
              </Button>
              <Button
                variant="neutral"
                onClick={() => {
                  setProposed(toProposed(data.configuration.runtime.knobs));
                  setReviewing(false);
                  setSaveResult(null);
                }}
                disabled={changes.length === 0 || saving}
              >
                Reset proposed values
              </Button>
              <Button
                variant="neutral"
                disabled={
                  changes.length > 0 ||
                  !data.metadata.capabilities.actions.restart?.enabled
                }
                onClick={() => void prepareRestart()}
              >
                Prepare restart
              </Button>
            </div>
            {preparedRestart && (
              <OperatorActionConfirmation
                prepared={preparedRestart}
                onCancel={() => setPreparedRestart(null)}
                onAccepted={(result) => {
                  setPreparedRestart(null);
                  setAcceptedRestart(result);
                }}
              />
            )}
          </>
        )}
      </div>
    </DeploymentSettingsLayout>
  );
}

function RuntimeSummary({ data }: { data: RuntimeData }) {
  const status = data.status;
  const effectiveRevision = status?.runtime.effectiveRevision;
  const state = !status
    ? "Unavailable"
    : status.freshness.state === "stale"
      ? "Stale"
      : effectiveRevision === data.configuration.revision
        ? "Effective"
        : "Pending restart";
  return (
    <section
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      aria-label="Runtime summary"
    >
      <SummaryItem
        label="Instance"
        value={data.configuration.instance.displayName}
        detail={data.configuration.instance.id}
      />
      <SummaryItem
        label="Profile"
        value={data.configuration.runtime.profile}
        detail={`${formatBytes(data.configuration.runtime.memoryMaxBytes)} memory.max · no CPU quota`}
      />
      <SummaryItem
        label="Configuration"
        value={`Revision ${data.configuration.revision}`}
        detail={`Updated ${formatDate(data.configuration.updatedAt)}`}
      />
      <SummaryItem
        label="Effective state"
        value={state}
        detail={
          status
            ? `Observed ${formatDate(status.runtime.observedAt)} · revision ${effectiveRevision ?? "unknown"}`
            : "No validated status provider"
        }
        warning={state !== "Effective"}
      />
    </section>
  );
}

function SummaryItem({
  label,
  value,
  detail,
  warning = false,
}: {
  label: string;
  value: string;
  detail: string;
  warning?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-background-secondary p-4">
      <div className="text-xs font-medium tracking-wide text-content-secondary uppercase">
        {label}
      </div>
      <div
        className={
          warning
            ? "mt-1 font-semibold text-content-warning"
            : "mt-1 font-semibold"
        }
      >
        {value}
      </div>
      <div className="mt-1 text-xs text-content-secondary">{detail}</div>
    </div>
  );
}

function KnobRow({
  name,
  definition,
  current,
  effective,
  proposed,
  source,
  onChange,
}: {
  name: string;
  definition: KnobDefinition;
  current: string | number | boolean;
  effective: string | number | boolean | null | undefined;
  proposed: string | boolean;
  source: string;
  onChange: (value: string | boolean) => void;
}) {
  const changed = parseProposed(proposed, definition) !== current;
  return (
    <div
      className={
        changed
          ? "grid gap-3 bg-util-accent/5 px-4 py-3 lg:grid-cols-[minmax(15rem,2fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_minmax(11rem,1.2fr)]"
          : "grid gap-3 px-4 py-3 lg:grid-cols-[minmax(15rem,2fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_minmax(11rem,1.2fr)]"
      }
    >
      <div className="min-w-0">
        <code className="text-xs font-medium break-all">{name}</code>
        <div className="mt-1 text-xs text-content-secondary">
          {source} · restart required
        </div>
      </div>
      <LabeledValue label="Declared" value={current} />
      <LabeledValue
        label="Effective"
        value={effective}
        unknown={effective === undefined || effective === null}
      />
      <label className="flex min-w-0 flex-col gap-1 text-xs text-content-secondary">
        <span className="lg:sr-only">Proposed</span>
        {definition.type === "boolean" ? (
          <span className="flex min-h-9 items-center gap-2 rounded-md border bg-background-primary px-3 text-sm text-content-primary">
            <input
              type="checkbox"
              checked={proposed === true}
              onChange={(event) => onChange(event.target.checked)}
            />
            {proposed === true ? "Enabled" : "Disabled"}
          </span>
        ) : (
          <input
            className="min-h-9 w-full rounded-md border bg-background-primary px-3 font-mono text-sm text-content-primary"
            type="number"
            value={typeof proposed === "string" ? proposed : String(proposed)}
            min={definition.min}
            max={definition.max}
            onChange={(event) => onChange(event.target.value)}
            aria-label={`Proposed value for ${name}`}
          />
        )}
      </label>
    </div>
  );
}

function LabeledValue({
  label,
  value,
  unknown = false,
}: {
  label: string;
  value: unknown;
  unknown?: boolean;
}) {
  return (
    <div className="min-w-0 text-sm">
      <div className="mb-1 text-xs text-content-secondary lg:sr-only">
        {label}
      </div>
      {unknown ? (
        <span className="text-content-secondary">Unknown</span>
      ) : (
        <Value value={value} />
      )}
    </div>
  );
}

function Value({ value }: { value: unknown }) {
  return (
    <code className="text-xs break-all">
      {typeof value === "boolean" ? (value ? "true" : "false") : String(value)}
    </code>
  );
}

function StatusPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border bg-background-secondary p-4">
      <div className="font-medium">{title}</div>
      <div className="text-sm text-content-secondary">{detail}</div>
    </div>
  );
}

function ErrorCallout({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => Promise<void>;
}) {
  const operatorError = error instanceof OperatorApiError ? error : null;
  return (
    <Callout variant="error">
      <div className="flex flex-col gap-2">
        <div>
          <div className="font-medium">Operator state is unavailable.</div>
          <div>{error.message}</div>
        </div>
        {operatorError?.issues.length ? (
          <ul className="list-disc pl-5">
            {operatorError.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        ) : null}
        <Button variant="neutral" size="xs" onClick={() => void onRetry()}>
          Retry
        </Button>
      </div>
    </Callout>
  );
}

function groupedKnobs(definitions: Record<string, KnobDefinition>) {
  const groups = new Map<string, [string, KnobDefinition][]>();
  for (const entry of Object.entries(definitions).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const group = knobGroup(entry[0]);
    groups.set(group, [...(groups.get(group) ?? []), entry]);
  }
  return [...groups.entries()];
}

function knobGroup(name: string) {
  if (name.startsWith("APPLICATION_")) return "Application admission";
  if (name.startsWith("HTTP_")) return "HTTP admission";
  if (
    name.startsWith("ISOLATE_") ||
    name.startsWith("MAX_ISOLATE") ||
    name.startsWith("FUNRUN_")
  )
    return "Isolates and queues";
  if (name.startsWith("LOCAL_NODE_")) return "Local Node executor";
  if (name.startsWith("LOCAL_BACKEND_")) return "Memory protection";
  if (name.startsWith("POSTGRES_")) return "Postgres";
  if (name.startsWith("REUSE_") || name.includes("CONTEXT_CACHE"))
    return "Context reuse";
  if (name.startsWith("EXPORT_")) return "Snapshot export";
  return "Runtime and privacy";
}

function RuntimeObservability({
  metrics,
  error,
}: {
  metrics: RuntimeMetrics | null;
  error: Error | null;
}) {
  const samples = metrics ? parsePrometheusSamples(metrics.exposition) : [];
  return (
    <section
      className="rounded-lg border bg-background-secondary p-4"
      aria-labelledby="runtime-observability-title"
    >
      <h4 id="runtime-observability-title" className="font-semibold">
        Context reuse and backpressure evidence
      </h4>
      <p className="mt-1 max-w-prose text-sm text-content-secondary">
        Authenticated, bounded backend counters for reusable contexts,
        degradable-query pressure, and database cancellation. Missing series
        means no matching activity was recorded; it is not treated as healthy.
      </p>
      {error ? (
        <Callout variant="error" className="mt-3">
          Runtime metric evidence is unavailable: {error.message}
        </Callout>
      ) : metrics ? (
        <div className="mt-3">
          <div className="text-xs text-content-secondary">
            Observed {new Date(metrics.observedAtUnixMs).toLocaleString()} · {metrics.familyCount}{" "}
            metric families · {samples.length} samples
          </div>
          {samples.length === 0 ? (
            <div className="mt-3 rounded-md border bg-background-primary p-3 text-sm">
              No matching runtime activity has been recorded in this process.
            </div>
          ) : (
            <div className="mt-3 max-h-80 overflow-auto rounded-md border bg-background-primary">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-background-tertiary">
                  <tr>
                    <th className="px-3 py-2 font-medium">Metric series</th>
                    <th className="px-3 py-2 text-right font-medium">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {samples.map((sample) => (
                    <tr key={sample.series}>
                      <td className="px-3 py-2 font-mono break-all">
                        {sample.series}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {sample.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 text-sm text-content-secondary">
          Loading authenticated runtime evidence…
        </div>
      )}
    </section>
  );
}

function parsePrometheusSamples(exposition: string) {
  return exposition
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("#"))
    .flatMap((line) => {
      const match = /^(\S+)\s+([^\s]+)(?:\s+\d+)?$/.exec(line);
      return match ? [{ series: match[1], value: match[2] }] : [];
    });
}

async function fetchRuntimeMetrics(
  deployment: Extract<
    React.ContextType<typeof DeploymentInfoContext>,
    { ok: true }
  >,
): Promise<RuntimeMetrics> {
  const response = await fetch(
    `${deployment.deploymentUrl.replace(/\/$/, "")}/api/self_hosted_runtime_metrics`,
    {
      headers: {
        Authorization: `Convex ${deployment.adminKey}`,
        "Convex-Client": "dashboard-self-hosted-runtime",
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Backend returned ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as RuntimeMetrics;
}

function toProposed(
  knobs: OperatorConfiguration["runtime"]["knobs"],
): ProposedValues {
  return Object.fromEntries(
    Object.entries(knobs).map(([name, value]) => [
      name,
      typeof value === "boolean" ? value : String(value),
    ]),
  );
}

function parseProposed(
  value: string | boolean | undefined,
  definition: KnobDefinition | undefined,
) {
  if (definition?.type === "boolean") return value === true;
  if (typeof value !== "string" || value.trim() === "") return Number.NaN;
  return Number(value);
}

function validateProposed(
  name: string,
  value: string | boolean | undefined,
  definition: KnobDefinition,
) {
  if (definition.type === "boolean")
    return typeof value === "boolean"
      ? []
      : [`${name} must be enabled or disabled.`];
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed)) return [`${name} must be an integer.`];
  if (definition.min !== undefined && parsed < definition.min)
    return [`${name} must be at least ${definition.min}.`];
  if (definition.max !== undefined && parsed > definition.max)
    return [`${name} must be at most ${definition.max}.`];
  return [];
}

function formatBytes(value: number) {
  return `${(value / 1024 ** 3).toFixed(0)} GiB`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "unknown";
}

function asError(value: unknown): OperatorApiError | Error {
  return value instanceof Error
    ? value
    : new Error("Unknown operator API error");
}
