import { useEffect, useMemo, useState } from "react";
import { DeploymentSettingsLayout } from "@common/layouts/DeploymentSettingsLayout";
import { Button } from "@ui/Button";
import { Callout } from "@ui/Callout";
import { OperatorActionConfirmation } from "../../components/operator/OperatorActionConfirmation";
import {
  EvidenceCard,
  formatOperatorDate,
  OperatorError,
  OperatorField,
  OperatorLoading,
  operatorInputClasses,
} from "../../components/operator/OperatorPagePrimitives";
import { useOperatorState } from "../../components/operator/useOperatorState";
import {
  ExecutedOperatorAction,
  OperatorConfiguration,
  PreparedOperatorAction,
  operatorMutation,
} from "../../lib/operatorApi";

type AlertsForm = OperatorConfiguration["alerts"];

export default function AlertsPage() {
  const operator = useOperatorState();
  const [form, setForm] = useState<AlertsForm | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prepared, setPrepared] = useState<PreparedOperatorAction | null>(null);
  const [accepted, setAccepted] = useState<ExecutedOperatorAction | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);

  useEffect(() => {
    if (operator.configuration) setForm(operator.configuration.alerts);
  }, [operator.configuration]);

  const changed =
    form !== null &&
    operator.configuration !== null &&
    JSON.stringify(form) !== JSON.stringify(operator.configuration.alerts);
  const issues = useMemo(() => validateAlerts(form), [form]);

  async function save() {
    if (!form || issues.length > 0) return;
    setSaving(true);
    try {
      const result = await operator.patch({ alerts: form });
      setForm(result.current.alerts);
      setReviewing(false);
    } catch {
      // The shared hook renders the exact API error and refreshes conflicts.
    } finally {
      setSaving(false);
    }
  }

  async function prepareTest() {
    const configuration = operator.configuration;
    if (!configuration) return;
    try {
      setAccepted(null);
      setActionError(null);
      const next = await operatorMutation<PreparedOperatorAction>(
        "/v1/actions/prepare",
        "POST",
        {
          kind: "alert-test",
          instanceId: configuration.instance.id,
          baseRevision: configuration.revision,
          parameters: {},
        },
      );
      setPrepared(next);
    } catch (requestError) {
      setActionError(asError(requestError));
    }
  }

  const status = operator.status;
  const alertState = !status
    ? "Unavailable"
    : status.freshness.state === "stale"
      ? "Stale"
      : status.alerts.state;

  return (
    <DeploymentSettingsLayout page="alerts">
      <div className="flex flex-col gap-6">
        <header>
          <h3 className="font-semibold">Operational alerts</h3>
          <p className="mt-1 max-w-prose text-sm text-content-secondary">
            Configure per-instance thresholds and a server-side notifier alias.
            Beszel remains the host-level source; Convex alert evidence and test
            delivery are managed here without returning notifier secrets.
          </p>
        </header>

        {operator.loading && (
          <OperatorLoading detail="Waiting for alert policy and delivery evidence." />
        )}
        {operator.error && (
          <OperatorError error={operator.error} onRetry={operator.refresh} />
        )}
        {actionError && (
          <OperatorError
            error={actionError}
            onRetry={async () => {
              setActionError(null);
              await operator.refresh();
            }}
          />
        )}

        {operator.configuration &&
          operator.metadata &&
          form &&
          !operator.loading && (
            <>
              <section
                className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
                aria-label="Alert evidence"
              >
                <EvidenceCard
                  label="Alert state"
                  value={alertState}
                  detail={
                    status
                      ? `Evidence generated ${formatOperatorDate(status.generatedAt)}`
                      : "No validated status provider"
                  }
                  warning={alertState !== "ok" && alertState !== "disabled"}
                />
                <EvidenceCard
                  label="Last delivery"
                  value={formatOperatorDate(status?.alerts.lastDeliveryAt)}
                  detail={
                    status?.alerts.lastDeliveryAt
                      ? "Validated notifier evidence"
                      : "No delivery evidence"
                  }
                  warning={!status?.alerts.lastDeliveryAt && form.enabled}
                />
                <EvidenceCard
                  label="Destination"
                  value={form.destinationAlias ?? "Not configured"}
                  detail="Alias only; secret material remains on the operator host"
                  warning={form.enabled && !form.destinationAlias}
                />
                <EvidenceCard
                  label="Host CPU"
                  value={
                    status?.alerts.hostCpuPercent === null ||
                    status?.alerts.hostCpuPercent === undefined
                      ? "Unknown"
                      : `${status.alerts.hostCpuPercent.toFixed(1)}%`
                  }
                  detail={`Warning ${form.hostCpuWarningPercent}% · critical ${form.hostCpuCriticalPercent}%`}
                  warning={status?.alerts.hostCpuPercent === null || status?.alerts.hostCpuPercent === undefined}
                />
                <EvidenceCard
                  label="Host memory"
                  value={
                    status?.alerts.hostMemoryPercent === null ||
                    status?.alerts.hostMemoryPercent === undefined
                      ? "Unknown"
                      : `${status.alerts.hostMemoryPercent.toFixed(1)}%`
                  }
                  detail={`Warning ${form.hostMemoryWarningPercent}% · critical ${form.hostMemoryCriticalPercent}%`}
                  warning={status?.alerts.hostMemoryPercent === null || status?.alerts.hostMemoryPercent === undefined}
                />
              </section>

              {status?.alerts.lastError && (
                <Callout variant="error">{status.alerts.lastError}</Callout>
              )}

              {accepted && (
                <Callout variant="success">
                  Alert test action <code>{accepted.actionId}</code> was
                  accepted at {formatOperatorDate(accepted.acceptedAt)}.
                </Callout>
              )}

              <section
                className="rounded-lg border bg-background-secondary p-4"
                aria-labelledby="alert-policy-title"
              >
                <h4 id="alert-policy-title" className="font-semibold">
                  Alert policy
                </h4>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={form.enabled}
                      onChange={(event) =>
                        setForm({ ...form, enabled: event.target.checked })
                      }
                    />
                    Enable alert delivery for this instance
                  </label>
                  <OperatorField
                    label="Destination alias"
                    description="Named notifier configuration on the private operator host."
                  >
                    <input
                      className={operatorInputClasses}
                      value={form.destinationAlias ?? ""}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          destinationAlias: nullIfEmpty(event.target.value),
                        })
                      }
                      autoComplete="off"
                    />
                  </OperatorField>
                  <div />
                  <Threshold
                    label="Host memory warning"
                    value={form.hostMemoryWarningPercent}
                    onChange={(hostMemoryWarningPercent) =>
                      setForm({ ...form, hostMemoryWarningPercent })
                    }
                  />
                  <Threshold
                    label="Host memory critical"
                    value={form.hostMemoryCriticalPercent}
                    onChange={(hostMemoryCriticalPercent) =>
                      setForm({ ...form, hostMemoryCriticalPercent })
                    }
                  />
                  <Threshold
                    label="Host CPU warning"
                    value={form.hostCpuWarningPercent}
                    onChange={(hostCpuWarningPercent) =>
                      setForm({ ...form, hostCpuWarningPercent })
                    }
                  />
                  <Threshold
                    label="Host CPU critical"
                    value={form.hostCpuCriticalPercent}
                    onChange={(hostCpuCriticalPercent) =>
                      setForm({ ...form, hostCpuCriticalPercent })
                    }
                  />
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

                {reviewing && changed && (
                  <div className="mt-4 rounded-md border bg-background-primary p-3 text-sm">
                    <div className="font-medium">
                      Review alert policy revision
                    </div>
                    <p className="mt-1">
                      Target <code>{operator.configuration.instance.id}</code>,
                      base revision {operator.configuration.revision}. No alert
                      is sent by saving this policy.
                    </p>
                    <pre className="mt-3 scrollbar overflow-auto rounded-sm bg-background-tertiary p-3 text-xs">
                      {JSON.stringify(form, null, 2)}
                    </pre>
                    <div className="mt-3 flex gap-2">
                      <Button onClick={() => void save()} loading={saving}>
                        Apply reviewed policy
                      </Button>
                      <Button
                        variant="neutral"
                        onClick={() => setReviewing(false)}
                        disabled={saving}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    disabled={!changed || issues.length > 0}
                    onClick={() => setReviewing(true)}
                  >
                    Review policy change
                  </Button>
                  <Button
                    variant="neutral"
                    disabled={!changed}
                    onClick={() => {
                      setForm(operator.configuration!.alerts);
                      setReviewing(false);
                    }}
                  >
                    Reset
                  </Button>
                  <Button
                    variant="neutral"
                    disabled={
                      changed ||
                      !operator.metadata.capabilities.actions["alert-test"]
                        ?.enabled ||
                      !form.destinationAlias
                    }
                    onClick={() => void prepareTest()}
                  >
                    Prepare delivery test
                  </Button>
                </div>
              </section>

              {prepared && (
                <OperatorActionConfirmation
                  prepared={prepared}
                  onCancel={() => setPrepared(null)}
                  onAccepted={(result) => {
                    setPrepared(null);
                    setAccepted(result);
                  }}
                />
              )}
            </>
          )}
      </div>
    </DeploymentSettingsLayout>
  );
}

function Threshold({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <OperatorField
      label={label}
      description="Percent of the aggregate dedicated host; warning must remain below critical."
    >
      <input
        className={operatorInputClasses}
        type="number"
        min={1}
        max={100}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </OperatorField>
  );
}

function validateAlerts(form: AlertsForm | null) {
  if (!form) return [];
  const issues: string[] = [];
  if (form.enabled && !form.destinationAlias)
    issues.push("Enabled alerts require a destination alias.");
  const thresholds = [
    form.hostMemoryWarningPercent,
    form.hostMemoryCriticalPercent,
    form.hostCpuWarningPercent,
    form.hostCpuCriticalPercent,
  ];
  if (
    !thresholds.every(
      (value) => Number.isFinite(value) && value > 0 && value <= 100,
    )
  )
    issues.push(
      "Every threshold must be greater than 0 and at most 100 percent.",
    );
  if (form.hostMemoryWarningPercent >= form.hostMemoryCriticalPercent)
    issues.push("Memory warning must be below memory critical.");
  if (form.hostCpuWarningPercent >= form.hostCpuCriticalPercent)
    issues.push("CPU warning must be below CPU critical.");
  return issues;
}

function asError(value: unknown) {
  return value instanceof Error
    ? value
    : new Error("Unknown operator action error");
}

function nullIfEmpty(value: string) {
  return value.trim() === "" ? null : value;
}
