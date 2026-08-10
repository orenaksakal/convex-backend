import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DeploymentInfoContext } from "@common/lib/deploymentContext";
import { Button } from "@ui/Button";
import { Callout } from "@ui/Callout";
import {
  OperatorField,
  OperatorNumberPresetField,
  operatorInputClasses,
} from "../operator/OperatorPagePrimitives";
import { useOperatorState } from "../operator/useOperatorState";
import {
  analyzeInsightEvents,
  formatBytes,
  SelfHostedInsight,
} from "../../lib/selfHostedInsights";
import {
  operatorGet,
  OperatorConfiguration,
  OperatorInsightsHistory,
} from "../../lib/operatorApi";

type InsightsForm = OperatorConfiguration["insights"];

const LABELS: Record<SelfHostedInsight["kind"], string> = {
  documentsReadLimit: "Documents read limit exceeded",
  bytesReadLimit: "Bytes read limit exceeded",
  occFailedPermanently: "OCC failed permanently",
  documentsReadThreshold: "Documents read near limit",
  bytesReadThreshold: "Bytes read near limit",
  occRetried: "OCC retried",
};

export function SelfHostedInsights() {
  const deployment = useContext(DeploymentInfoContext);
  const operator = useOperatorState();
  const [events, setEvents] = useState<unknown[] | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<Error | null>(null);
  const [boundedProbeExpired, setBoundedProbeExpired] = useState(false);
  const [durableHistory, setDurableHistory] =
    useState<OperatorInsightsHistory | null>(null);
  const [form, setForm] = useState<InsightsForm | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (operator.configuration) setForm(operator.configuration.insights);
  }, [operator.configuration]);

  const refresh = useCallback(async () => {
    if (!deployment.ok) return;
    setFetching(true);
    setFetchError(null);
    setBoundedProbeExpired(false);
    setDurableHistory(null);
    if (form?.durableHistoryAlias) {
      try {
        const response = await operatorGet<{
          history: OperatorInsightsHistory;
        }>("/v1/insights-history");
        setDurableHistory(response.history);
        setEvents(response.history.events);
        setFetchedAt(Date.parse(response.history.readAt));
      } catch (error) {
        setFetchError(asError(error));
      } finally {
        setFetching(false);
      }
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(
        `${deployment.deploymentUrl.replace(/\/$/, "")}/api/stream_function_logs?cursor=0`,
        {
          signal: controller.signal,
          headers: {
            Authorization: `Convex ${deployment.adminKey}`,
            "Convex-Client": "dashboard-0.0.0",
          },
        },
      );
      if (!response.ok) {
        throw new Error(
          `Log-history request returned ${response.status} ${response.statusText}`,
        );
      }
      const payload = (await response.json()) as { entries?: unknown[] };
      if (!Array.isArray(payload.entries)) {
        throw new Error(
          "Log-history response did not contain an entries array",
        );
      }
      setEvents(payload.entries);
      setFetchedAt(Date.now());
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        // This endpoint is a long poll. Timing out without a response means no
        // retained completion was available at cursor zero during this bounded
        // probe; it is not evidence of a healthy 72-hour history window.
        setEvents([]);
        setFetchedAt(Date.now());
        setBoundedProbeExpired(true);
      } else {
        setFetchError(asError(error));
      }
    } finally {
      window.clearTimeout(timeout);
      setFetching(false);
    }
  }, [deployment, form?.durableHistoryAlias]);

  useEffect(() => {
    if (form && events === null && !fetching && !fetchError) void refresh();
  }, [events, fetchError, fetching, form, refresh]);

  const result = useMemo(
    () =>
      events && form
        ? analyzeInsightEvents(events, {
            now: fetchedAt ?? Date.now(),
            lookbackHours: form.lookbackHours,
            documentsReadLimit: form.documentsReadLimit,
            bytesReadLimit: form.bytesReadLimit,
            warningPercent: form.warningPercent,
          })
        : null,
    [events, fetchedAt, form],
  );
  const changed =
    form !== null &&
    operator.configuration !== null &&
    JSON.stringify(form) !== JSON.stringify(operator.configuration.insights);
  const issues = useMemo(() => validateForm(form), [form]);

  async function save() {
    if (!form || issues.length > 0) return;
    setSaving(true);
    try {
      const saved = await operator.patch({ insights: form });
      setForm(saved.current.insights);
      setReviewing(false);
      setEvents(null);
    } catch {
      // The shared hook retains the exact API error and refreshes conflicts.
    } finally {
      setSaving(false);
    }
  }

  const diagnostics = result?.diagnostics;
  const durableWindowCovered = Boolean(
    durableHistory &&
      !durableHistory.byteLimited &&
      !durableHistory.recordLimited &&
      durableHistory.malformedRecords === 0 &&
      durableHistory.recordsBeforeWindow > 0,
  );
  const coverageLabel = !diagnostics
    ? "Unavailable"
    : diagnostics.recordsInWindow === 0
      ? "No observed completions"
      : durableWindowCovered
        ? "Durable requested window"
        : durableHistory
          ? "Bounded durable history"
          : "Buffered partial history";
  const issueLabel = !result
    ? "Unknown"
    : result.insights.length === 0
      ? "No issues observed"
      : `${result.insights.length} issue${result.insights.length === 1 ? "" : "s"}`;

  return (
    <div className="flex flex-col gap-4 pb-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <InsightMetric
          label="Coverage"
          value={coverageLabel}
          detail={
            diagnostics?.firstTimestamp
              ? `${new Date(diagnostics.firstTimestamp).toLocaleString()} to ${new Date(diagnostics.lastTimestamp!).toLocaleString()}`
              : durableHistory
                ? `${durableHistory.bytesRead.toLocaleString()} of ${durableHistory.observedFileBytes.toLocaleString()} bytes read`
                : "No validated coverage interval"
          }
          warning={!durableWindowCovered}
        />
        <InsightMetric
          label="Records"
          value={
            diagnostics
              ? diagnostics.recordsInWindow.toLocaleString()
              : "Unknown"
          }
          detail={
            diagnostics
              ? boundedProbeExpired
                ? `0 retained completions returned during a 5-second bounded probe · requested ${form?.lookbackHours ?? "?"}h`
                : durableHistory
                  ? `${diagnostics.inputRecords.toLocaleString()} sanitized durable records · requested ${form?.lookbackHours ?? "?"}h`
                  : `${diagnostics.inputRecords.toLocaleString()} buffered inputs · requested ${form?.lookbackHours ?? "?"}h`
              : "Analysis unavailable"
          }
          warning={!diagnostics || diagnostics.recordsInWindow === 0}
        />
        <InsightMetric
          label="Observed result"
          value={issueLabel}
          detail="Absence of issues in a bounded buffer is not a health guarantee"
          warning={
            !result || result.insights.length > 0 || !form?.durableHistoryAlias
          }
        />
        <InsightMetric
          label="Durable history"
          value={form?.durableHistoryAlias ?? "Not configured"}
          detail={
            durableHistory
              ? `${durableHistory.byteLimited || durableHistory.recordLimited ? "Bounded" : "Complete file read"} · ${durableHistory.malformedRecords} malformed · ${durableHistory.recordsDroppedByLimit} record-limited`
              : "Named server-side log-history source; secret values are never returned"
          }
          warning={!form?.durableHistoryAlias}
        />
      </div>

      {(fetchError || operator.error) && (
        <Callout variant="error">
          <div>
            <div className="font-medium">Insights evidence is unavailable.</div>
            <div>{fetchError?.message ?? operator.error?.message}</div>
          </div>
        </Callout>
      )}

      {diagnostics && (
        <div className="grid gap-3 rounded-lg border bg-background-secondary p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="text-content-secondary">Peak documents</span>
            <div className="font-medium">
              {diagnostics.peakDocumentsRead.toLocaleString()}
            </div>
          </div>
          <div>
            <span className="text-content-secondary">Document warning</span>
            <div className="font-medium">
              {diagnostics.documentsWarningThreshold.toLocaleString()}
            </div>
          </div>
          <div>
            <span className="text-content-secondary">Peak bytes</span>
            <div className="font-medium">
              {formatBytes(diagnostics.peakBytesRead)}
            </div>
          </div>
          <div>
            <span className="text-content-secondary">Byte warning</span>
            <div className="font-medium">
              {formatBytes(diagnostics.bytesWarningThreshold)}
            </div>
          </div>
        </div>
      )}

      {result && result.insights.length > 0 && (
        <div className="overflow-hidden rounded-lg border bg-background-secondary">
          {result.insights.map((insight) => (
            <div
              key={`${insight.kind}:${insight.componentPath}:${insight.functionId}:${insight.tableName}`}
              className="border-b p-3 last:border-b-0"
            >
              <div className="text-sm">
                <span
                  className={
                    insight.severity === "error"
                      ? "font-semibold text-content-error"
                      : "font-semibold text-content-warning"
                  }
                >
                  {LABELS[insight.kind]}
                </span>{" "}
                <code>
                  {insight.componentPath ? `${insight.componentPath}:` : ""}
                  {insight.functionId}
                </code>{" "}
                <span className="text-content-secondary">
                  · {insight.count} occurrence{insight.count === 1 ? "" : "s"}
                  {insight.tableName ? ` · ${insight.tableName}` : ""}
                </span>
              </div>
              <ul className="mt-2 divide-y rounded-sm border text-xs">
                {insight.recentEvents.map((event) => (
                  <li
                    key={`${event.timestamp}:${event.requestId}`}
                    className="p-2"
                  >
                    <div>
                      {new Date(event.timestamp).toLocaleString()} ·{" "}
                      <code>{event.requestId}</code>
                    </div>
                    <div className="text-content-secondary">{event.detail}</div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="neutral"
          loading={fetching}
          onClick={() => void refresh()}
        >
          Refresh buffered evidence
        </Button>
        <Button
          variant="neutral"
          onClick={() => setReviewing((value) => !value)}
        >
          Configure analysis
        </Button>
      </div>

      {reviewing && form && operator.configuration && (
        <section
          className="rounded-lg border bg-background-secondary p-4"
          aria-labelledby="insights-config-title"
        >
          <h5 id="insights-config-title" className="font-semibold">
            Insights analysis policy
          </h5>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <NumberField
              label="Requested lookback hours"
              value={form.lookbackHours}
              onChange={(lookbackHours) => setForm({ ...form, lookbackHours })}
            />
            <NumberField
              label="Warning percent"
              value={form.warningPercent}
              onChange={(warningPercent) =>
                setForm({ ...form, warningPercent })
              }
            />
            <NumberField
              label="Document read limit"
              value={form.documentsReadLimit}
              onChange={(documentsReadLimit) =>
                setForm({ ...form, documentsReadLimit })
              }
            />
            <NumberField
              label="Byte read limit"
              value={form.bytesReadLimit}
              onChange={(bytesReadLimit) =>
                setForm({ ...form, bytesReadLimit })
              }
            />
            <OperatorField
              label="Durable history alias"
              description="Named operator-side JSONL/log sink source; does not expose credentials."
            >
              <input
                className={operatorInputClasses}
                value={form.durableHistoryAlias ?? ""}
                onChange={(event) =>
                  setForm({
                    ...form,
                    durableHistoryAlias: nullIfEmpty(event.target.value),
                  })
                }
                autoComplete="off"
              />
            </OperatorField>
          </div>
          {issues.length > 0 && (
            <Callout variant="error">
              <ul className="list-disc pl-5">
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </Callout>
          )}
          {changed && (
            <div className="mt-4 rounded-md border bg-background-primary p-3 text-sm">
              Target <code>{operator.configuration.instance.id}</code>, base
              revision {operator.configuration.revision}. This changes analysis
              policy only.
              <pre className="mt-3 scrollbar overflow-auto rounded-sm bg-background-tertiary p-3 text-xs">
                {JSON.stringify(form, null, 2)}
              </pre>
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <Button
              disabled={!changed || issues.length > 0}
              loading={saving}
              onClick={() => void save()}
            >
              Apply reviewed policy
            </Button>
            <Button
              variant="neutral"
              disabled={!changed}
              onClick={() => setForm(operator.configuration!.insights)}
            >
              Reset
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function InsightMetric({
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

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const presets = insightPresets(label);
  const max = label === "Warning percent" ? 99 : undefined;
  return (
    <OperatorNumberPresetField
      label={label}
      description={insightDescription(label)}
      value={value}
      presets={presets}
      min={1}
      max={max}
      onChange={(nextValue) => nextValue !== null && onChange(nextValue)}
      formatValue={label === "Byte read limit" ? formatBytes : undefined}
    />
  );
}

function insightPresets(label: string) {
  if (label === "Requested lookback hours")
    return [
      {
        label: "24 hours",
        value: 24,
        description: "Focus on the most recent day.",
      },
      {
        label: "72 hours (recommended)",
        value: 72,
        description: "Three days of evidence balances context and scan cost.",
      },
      {
        label: "7 days",
        value: 168,
        description: "Useful for weekly workload patterns.",
      },
      {
        label: "30 days",
        value: 720,
        description: "Broad historical review with more evidence to scan.",
      },
    ];
  if (label === "Warning percent")
    return [
      {
        label: "70% · early warning",
        value: 70,
        description: "More time to react, with more notifications.",
      },
      {
        label: "80% · balanced (recommended)",
        value: 80,
        description: "Warns before the hard limit without excessive noise.",
      },
      {
        label: "90% · late warning",
        value: 90,
        description: "Fewer warnings and less response time.",
      },
      {
        label: "95% · urgent only",
        value: 95,
        description: "Alerts only when execution is very close to the limit.",
      },
    ];
  if (label === "Document read limit")
    return [
      {
        label: "8,000 documents",
        value: 8_000,
        description: "Conservative threshold for lightweight queries.",
      },
      {
        label: "16,000 documents",
        value: 16_000,
        description: "Tracks the approximate single-function document ceiling.",
      },
      {
        label: "32,000 documents (recommended)",
        value: 32_000,
        description:
          "Matches the patched operator profile's aggregate evidence threshold.",
      },
      {
        label: "64,000 documents",
        value: 64_000,
        description: "For higher-volume aggregate analysis.",
      },
    ];
  return [
    {
      label: "8 MiB",
      value: 8 * 1024 ** 2,
      description: "Conservative byte-read threshold.",
    },
    {
      label: "16 MiB (recommended)",
      value: 16 * 1024 ** 2,
      description: "Matches the patched operator profile.",
    },
    {
      label: "32 MiB",
      value: 32 * 1024 ** 2,
      description: "Higher-volume query analysis.",
    },
    {
      label: "64 MiB",
      value: 64 * 1024 ** 2,
      description: "Broad threshold for large aggregate reads.",
    },
  ];
}

function insightDescription(label: string) {
  if (label === "Requested lookback hours")
    return "How far back the analysis scans for function-pressure evidence.";
  if (label === "Warning percent")
    return "Percentage of a configured read limit that produces a near-limit warning.";
  if (label === "Document read limit")
    return "Document count used to classify read-pressure evidence.";
  return "Total bytes read used to classify read-pressure evidence.";
}

function validateForm(form: InsightsForm | null) {
  if (!form) return [];
  const issues: string[] = [];
  if (
    ![form.lookbackHours, form.documentsReadLimit, form.bytesReadLimit].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    )
  )
    issues.push("Lookback and limits must be positive whole numbers.");
  if (
    !Number.isSafeInteger(form.warningPercent) ||
    form.warningPercent < 1 ||
    form.warningPercent > 99
  )
    issues.push("Warning percent must be a whole number from 1 through 99.");
  return issues;
}

function nullIfEmpty(value: string) {
  return value.trim() === "" ? null : value.trim();
}

function asError(value: unknown) {
  return value instanceof Error ? value : new Error("Unknown Insights error");
}
