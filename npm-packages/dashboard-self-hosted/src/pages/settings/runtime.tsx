import { useCallback, useContext, useMemo, useRef, useState } from "react";
import { Button } from "@ui/Button";
import { Callout } from "@ui/Callout";
import { DeploymentSettingsLayout } from "@common/layouts/DeploymentSettingsLayout";
import { DeploymentInfoContext } from "@common/lib/deploymentContext";
import { OperatorActionConfirmation } from "../../components/operator/OperatorActionConfirmation";
import { OperatorResourceFreshness } from "../../components/operator/OperatorResourceFreshness";
import { useOperatorResource } from "../../components/operator/useOperatorResource";
import {
  HealthSignal,
  SignalLevel,
  TrafficLightLegend,
} from "../../components/operator/HealthSignal";
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
  const proposedDirtyRef = useRef(false);

  const load = useCallback(async () => {
    const [configurationResponse, metadata] = await Promise.all([
      operatorGet<{ configuration: OperatorConfiguration }>(
        "/v1/configuration",
      ),
      operatorGet<OperatorMetadata>("/v1/metadata"),
    ]);
    const configuration = configurationResponse.configuration;
    const status = metadata.capabilities.status.read
      ? await operatorGet<{ status: OperatorStatus }>("/v1/status").then(
          (response) => response.status,
        )
      : null;
    setData({ configuration, metadata, status });
    if (!proposedDirtyRef.current) {
      setProposed(toProposed(configuration.runtime.knobs));
    }
  }, []);
  const resource = useOperatorResource(load);
  const loadMetrics = useCallback(async () => {
    if (!deployment.ok) return;
    setRuntimeMetrics(await fetchRuntimeMetrics(deployment));
  }, [deployment]);
  const metricsResource = useOperatorResource(loadMetrics, {
    enabled: deployment.ok,
  });

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
  proposedDirtyRef.current = changes.length > 0;

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
        await resource.refresh();
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
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">Runtime limits</h3>
            <p className="max-w-prose text-sm text-content-secondary">
              See the limits the backend is using. Editing a value does nothing
              until you save it, and saved runtime changes require a separately
              confirmed restart.
            </p>
          </div>
          <OperatorResourceFreshness
            label="Runtime evidence"
            lastUpdatedAt={resource.lastUpdatedAt}
            refreshing={resource.refreshing}
            error={resource.error}
            onRefresh={async () => {
              await Promise.all([
                resource.refresh(),
                metricsResource.refresh(),
              ]);
            }}
          />
        </header>

        {resource.loading && (
          <StatusPanel
            title="Loading operator state"
            detail="Waiting for configuration and effective-state evidence."
          />
        )}
        {resource.error && (
          <ErrorCallout error={resource.error} onRetry={resource.refresh} />
        )}
        {error && <ErrorCallout error={error} onRetry={resource.refresh} />}

        {data && !resource.loading && (
          <>
            <RuntimeSummary data={data} />
            <RuntimeObservability
              metrics={runtimeMetrics}
              error={metricsResource.error}
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
                            recommended={
                              data.metadata.profileDefaults.knobs[name]
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
  const state = !status
    ? "Not verified"
    : status.freshness.state === "stale"
      ? "Status out of date"
      : status.runtime.restartPending
        ? "Restart required"
        : "In use";
  return (
    <section
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      aria-label="Runtime summary"
    >
      <SummaryItem
        label="Deployment"
        value={data.configuration.instance.displayName}
        detail={data.configuration.instance.id}
      />
      <SummaryItem
        label="Server limits"
        value={data.configuration.runtime.profile}
        detail={`${formatBytes(data.configuration.runtime.memoryMaxBytes)} memory limit · no CPU limit set`}
      />
      <SummaryItem
        label="Saved settings"
        value={`Version ${data.configuration.revision}`}
        detail={`Last changed ${formatDate(data.configuration.updatedAt)}`}
      />
      <SummaryItem
        label="Running settings"
        value={state}
        detail={
          status
            ? runtimeStatusDetail(data)
            : "Could not confirm which settings the backend is using"
        }
        warning={state !== "In use"}
      />
    </section>
  );
}

function runtimeStatusDetail(data: RuntimeData) {
  const { status } = data;
  if (!status) return "Could not confirm which settings the backend is using";
  const checked = `checked ${formatDate(status.generatedAt)}`;
  if (!status.runtime.restartPending)
    return `The backend is using the saved limits · ${checked}`;

  const effective = status.runtime.effectiveKnobs;
  if (!effective)
    return `The backend did not report its running limits · ${checked}`;
  const differences = Object.entries(data.configuration.runtime.knobs).filter(
    ([name, saved]) => !Object.is(saved, effective[name]),
  );
  if (differences.length === 1) {
    const [name, saved] = differences[0];
    return `${knobTitle(name)} is saved as ${String(saved)} but running as ${String(effective[name])} · ${checked}`;
  }
  return `${differences.length} saved limits differ from the running backend · review the highlighted rows below · ${checked}`;
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
  recommended,
  proposed,
  source,
  onChange,
}: {
  name: string;
  definition: KnobDefinition;
  current: string | number | boolean;
  effective: string | number | boolean | null | undefined;
  recommended: string | number | boolean;
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
        <div className="text-sm font-medium">{knobTitle(name)}</div>
        <code className="mt-1 block text-xs break-all text-content-secondary">
          {name}
        </code>
        <p className="mt-2 max-w-prose text-xs/5 text-content-secondary">
          {definition.description}
        </p>
        <div className="mt-2 text-xs text-content-secondary">
          Source: {source} · backend restart required
          {definition.type === "integer" &&
          definition.min !== undefined &&
          definition.max !== undefined
            ? ` · allowed range ${definition.min.toLocaleString()}–${definition.max.toLocaleString()}`
            : ""}
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
          <div className="overflow-hidden rounded-md border bg-background-primary focus-within:border-border-selected">
            <select
              className="min-h-9 w-full border-0 bg-transparent px-3 text-sm text-content-primary focus:ring-0"
              value={runtimeQuickChoiceValue(
                proposed,
                name,
                recommended,
                current,
                definition,
              )}
              onChange={(event) => {
                if (event.target.value !== "__custom__")
                  onChange(event.target.value);
              }}
              aria-label={`Quick choice for ${name}`}
            >
              {runtimeQuickChoices(name, recommended, current, definition).map(
                (choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ),
              )}
              <option value="__custom__">Custom value</option>
            </select>
            <input
              className="min-h-9 w-full border-0 border-t bg-transparent px-3 font-mono text-sm text-content-primary focus:ring-0"
              type="number"
              value={typeof proposed === "string" ? proposed : String(proposed)}
              min={definition.min}
              max={definition.max}
              onChange={(event) => onChange(event.target.value)}
              aria-label={`Exact proposed value for ${name}`}
            />
          </div>
        )}
      </label>
    </div>
  );
}

function runtimeQuickChoiceValue(
  proposed: string | boolean,
  name: string,
  recommended: string | number | boolean,
  current: string | number | boolean,
  definition: KnobDefinition,
) {
  const value = String(proposed);
  return runtimeQuickChoices(name, recommended, current, definition).some(
    (choice) => choice.value === value,
  )
    ? value
    : "__custom__";
}

function runtimeQuickChoices(
  name: string,
  recommended: string | number | boolean,
  current: string | number | boolean,
  definition: KnobDefinition,
) {
  if (definition.type !== "integer" || typeof recommended !== "number")
    return [];
  const values = new Map<number, string>([[recommended, "Profile default"]]);
  if (typeof current === "number" && current !== recommended)
    values.set(current, "Current override");
  for (const value of commonRuntimeValues(name)) {
    if (
      (definition.min === undefined || value >= definition.min) &&
      (definition.max === undefined || value <= definition.max) &&
      !values.has(value)
    )
      values.set(value, "Common choice");
  }
  return [...values].map(([value, source]) => ({
    value: String(value),
    label: `${source} · ${formatRuntimeValue(name, value)}`,
  }));
}

function commonRuntimeValues(name: string) {
  if (name === "POSTGRES_MAX_CONNECTIONS") return [24, 64, 128];
  if (name === "POSTGRES_MAX_CACHED_STATEMENTS") return [0, 64, 128, 256, 512];
  if (name.endsWith("_MILLIS")) return [100, 250, 1000, 5000, 30_000];
  if (name.endsWith("_SECS") || name.endsWith("_SECONDS"))
    return [30, 60, 300, 1800, 3600, 21_600];
  if (name.endsWith("_MIB")) return [1024, 2048, 4096, 8192];
  if (name.includes("THREAD")) return [0, 4, 8, 12, 16, 24];
  if (name.endsWith("_BYTES"))
    return [4, 8, 12, 16, 24, 32].map((gib) => gib * 1024 ** 3);
  if (name.includes("CONCURRENC") || name.includes("WORKERS"))
    return [4, 8, 16, 32, 64, 128];
  if (name.includes("QUEUE") || name.includes("PACKAGES"))
    return [100, 500, 1000, 2000, 5000];
  if (name.includes("PAGE_SIZE")) return [50, 100, 250, 500, 1000];
  if (name.includes("RESIDENTS")) return [2, 5, 8, 16, 64, 512, 1800];
  return [];
}

function formatRuntimeValue(name: string, value: number) {
  if (name.endsWith("_MILLIS")) return `${value.toLocaleString()} ms`;
  if (name.endsWith("_SECS") || name.endsWith("_SECONDS"))
    return value >= 3600 && value % 3600 === 0
      ? `${value / 3600} h`
      : `${value.toLocaleString()} s`;
  if (name.endsWith("_MIB")) return `${value.toLocaleString()} MiB`;
  if (name.endsWith("_BYTES") && value >= 1024 ** 3)
    return `${value / 1024 ** 3} GiB`;
  return value.toLocaleString();
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
        <span className="text-content-secondary">Not reported</span>
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

function knobTitle(name: string) {
  const expandedWords: Record<string, string> = {
    RSS: "resident memory (RSS)",
    V8: "V8 JavaScript",
    HTTP: "HTTP web request",
    POSTGRES: "PostgreSQL",
    MIB: "MiB",
    MILLIS: "milliseconds",
    SECS: "seconds",
  };
  return name
    .split("_")
    .map((word) => expandedWords[word] ?? word.toLowerCase())
    .join(" ")
    .replace(/^./, (first) => first.toUpperCase());
}

function RuntimeObservability({
  metrics,
  error,
}: {
  metrics: RuntimeMetrics | null;
  error: Error | null;
}) {
  const samples = metrics ? parsePrometheusSamples(metrics.exposition) : [];
  const summary = summarizeRuntimeEvidence(samples);
  const [showTechnical, setShowTechnical] = useState(false);
  return (
    <section
      className="rounded-lg border bg-background-secondary p-4"
      aria-labelledby="runtime-observability-title"
    >
      <h4 id="runtime-observability-title" className="font-semibold">
        Runtime efficiency and capacity protection
      </h4>
      <p className="mt-1 max-w-prose text-sm text-content-secondary">
        A human-readable view of whether warm JavaScript contexts are saving
        startup work and whether the server is delaying lower-priority queries
        to protect normal traffic. Missing evidence is gray, never green.
      </p>
      <TrafficLightLegend className="mt-3" />
      {error ? (
        <Callout variant="error" className="mt-3">
          Runtime metric evidence is unavailable: {error.message}
        </Callout>
      ) : metrics ? (
        <div className="mt-3">
          <div className="text-xs text-content-secondary">
            Observed {new Date(metrics.observedAtUnixMs).toLocaleString()} ·{" "}
            {metrics.familyCount} metric families · {samples.length} samples
          </div>
          {samples.length === 0 ? (
            <div className="mt-3 rounded-md border bg-background-primary p-3 text-sm">
              <HealthSignal level="unknown" label="No runtime activity yet" />
              <p className="mt-2 text-content-secondary">
                Run normal application traffic, then refresh. No samples does
                not mean the feature is healthy or unhealthy.
              </p>
            </div>
          ) : (
            <>
              <div className="mt-3 overflow-hidden rounded-lg border bg-background-primary">
                {summary.map((item) => (
                  <div
                    key={item.title}
                    className="grid min-w-0 gap-3 border-b p-4 last:border-b-0 md:grid-cols-[minmax(11rem,0.7fr)_minmax(0,1.3fr)] md:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-semibold">{item.title}</div>
                        <HealthSignal
                          level={item.level}
                          label={item.status}
                          compact
                        />
                      </div>
                      <h5 className="mt-1 font-semibold tabular-nums">
                        {item.value}
                      </h5>
                    </div>
                    <div className="min-w-0">
                      {item.visualPercent !== null ? (
                        <div className="mb-2 h-2 overflow-hidden rounded-full bg-background-tertiary">
                          <div
                            className={
                              item.level === "critical"
                                ? "h-full rounded-full bg-util-error"
                                : item.level === "attention"
                                  ? "h-full rounded-full bg-util-warning"
                                  : "h-full rounded-full bg-util-success"
                            }
                            style={{
                              width: `${Math.max(0, Math.min(100, item.visualPercent))}%`,
                            }}
                            role="img"
                            aria-label={`${item.title}: ${item.value}`}
                          />
                        </div>
                      ) : null}
                      <p className="text-xs/relaxed wrap-break-word text-content-secondary">
                        {item.explanation}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-md border bg-background-primary">
                <Button
                  variant="unstyled"
                  className="w-full justify-start px-3 py-2 text-xs font-medium text-content-secondary"
                  onClick={() => setShowTechnical((value) => !value)}
                  aria-expanded={showTechnical}
                >
                  Technical metric details ({samples.length} samples)
                </Button>
                {showTechnical ? (
                  <div className="max-h-80 overflow-auto border-t">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-background-tertiary">
                        <tr>
                          <th className="px-3 py-2 font-medium">
                            Metric series
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            Value
                          </th>
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
                ) : null}
              </div>
            </>
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
      if (!match) return [];
      const name = match[1].split("{", 1)[0];
      const labels = Object.fromEntries(
        [...match[1].matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="([^"]*)"/g)].map(
          (label) => [label[1], label[2]],
        ),
      );
      return [
        {
          series: match[1],
          name,
          labels,
          value: match[2],
          numericValue: Number(match[2]),
        },
      ];
    });
}

type RuntimeSample = ReturnType<typeof parsePrometheusSamples>[number];

function summarizeRuntimeEvidence(samples: RuntimeSample[]) {
  const sum = (family: string, label?: [string, string]) =>
    samples
      .filter(
        (sample) =>
          sample.name.endsWith(family) &&
          (!label || sample.labels[label[0]] === label[1]) &&
          Number.isFinite(sample.numericValue),
      )
      .reduce((total, sample) => total + sample.numericValue, 0);

  const hits = sum("database_udf_context_reuse_lookup_total", [
    "outcome",
    "hit",
  ]);
  const misses = ["not_found", "validation_failed", "validation_error"].reduce(
    (total, outcome) =>
      total +
      sum("database_udf_context_reuse_lookup_total", ["outcome", outcome]),
    0,
  );
  const lookups = hits + misses;
  const reuseRate = lookups ? hits / lookups : null;
  const validationErrors = sum("database_udf_context_reuse_lookup_total", [
    "outcome",
    "validation_error",
  ]);
  const pressureActive = sum("sync_degradable_query_pressure_lifecycle_total", [
    "state",
    "active",
  ]);
  const pressureCleared = sum(
    "sync_degradable_query_pressure_lifecycle_total",
    ["state", "cleared"],
  );
  const pressureNow = Math.max(0, pressureActive - pressureCleared);
  const deferrals = sum("sync_degradable_query_deferrals_total");
  const cancellations = sum("postgres_cancellation_requested_total");
  const cancellationFailures = sum("postgres_cancellation_terminal_total", [
    "outcome",
    "failed",
  ]);

  const reuseLevel: SignalLevel = validationErrors
    ? "critical"
    : reuseRate === null
      ? "unknown"
      : reuseRate >= 0.6
        ? "healthy"
        : reuseRate >= 0.25
          ? "attention"
          : "unknown";
  const pressureLevel: SignalLevel = pressureNow > 0 ? "attention" : "healthy";
  const cancellationLevel: SignalLevel = cancellationFailures
    ? "critical"
    : cancellations
      ? "healthy"
      : "unknown";

  return [
    {
      title: "Warm-context reuse",
      value:
        reuseRate === null ? "No traffic" : `${Math.round(reuseRate * 100)}%`,
      level: reuseLevel,
      status: validationErrors
        ? "Validation errors"
        : reuseRate === null
          ? "No evidence"
          : reuseRate >= 0.6
            ? "Efficient"
            : "Review efficiency",
      explanation:
        "Share of eligible queries and mutations that reused an already-initialized JavaScript context. Higher is faster; a miss is safe and simply performs a normal initialization.",
      visualPercent: reuseRate === null ? null : reuseRate * 100,
    },
    {
      title: "Capacity protection",
      value: pressureNow ? `${pressureNow} active` : "Clear",
      level: pressureLevel,
      status: pressureNow ? "Attention" : "Healthy",
      explanation: pressureNow
        ? `${deferrals.toLocaleString()} lower-priority query deferrals have protected normal traffic. Active pressure means users may temporarily see stale data.`
        : `${deferrals.toLocaleString()} historical deferrals. No capacity-pressure episode is active now.`,
      visualPercent: null,
    },
    {
      title: "Cancelled database work",
      value: cancellations.toLocaleString(),
      level: cancellationLevel,
      status: cancellationFailures
        ? "Cancellation failures"
        : cancellations
          ? "Working"
          : "No evidence",
      explanation:
        "Requests abandoned by clients should cancel their PostgreSQL work. Zero is normal when no requests were cancelled; failures require immediate investigation.",
      visualPercent: null,
    },
  ];
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
    throw new Error(
      `Backend returned ${response.status} ${response.statusText}`,
    );
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
  return Number.isFinite(date.getTime())
    ? date.toLocaleString()
    : "Invalid timestamp";
}

function asError(value: unknown): OperatorApiError | Error {
  return value instanceof Error
    ? value
    : new Error("Unknown operator API error");
}
