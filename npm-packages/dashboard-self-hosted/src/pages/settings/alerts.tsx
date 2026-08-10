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
  OperatorNumberPresetField,
  operatorInputClasses,
} from "../../components/operator/OperatorPagePrimitives";
import { useOperatorState } from "../../components/operator/useOperatorState";
import {
  AlertDestinations,
  ExecutedOperatorAction,
  OperatorConfiguration,
  PreparedOperatorAction,
  operatorGet,
  operatorMutation,
} from "../../lib/operatorApi";

type AlertsForm = OperatorConfiguration["alerts"];
type DestinationForm = {
  email: {
    enabled: boolean;
    host: string;
    port: number;
    secure: boolean;
    username: string;
    password: string;
    from: string;
    to: string;
  };
  telegram: { enabled: boolean; shoutrrUrl: string };
};

export default function AlertsPage() {
  const operator = useOperatorState();
  const [form, setForm] = useState<AlertsForm | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prepared, setPrepared] = useState<PreparedOperatorAction | null>(null);
  const [accepted, setAccepted] = useState<ExecutedOperatorAction | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);
  const [destinations, setDestinations] = useState<AlertDestinations | null>(
    null,
  );
  const [destinationForm, setDestinationForm] =
    useState<DestinationForm | null>(null);
  const [savingDestinations, setSavingDestinations] = useState(false);

  useEffect(() => {
    if (operator.configuration) setForm(operator.configuration.alerts);
  }, [operator.configuration]);

  useEffect(() => {
    if (!operator.metadata?.capabilities.alertDestinations.read) return;
    void operatorGet<{ destinations: AlertDestinations }>(
      "/v1/alert-destinations",
    )
      .then(({ destinations: next }) => {
        setDestinations(next);
        setDestinationForm({
          email: {
            enabled: next.email.enabled,
            host: next.email.host ?? "",
            port: next.email.port ?? 587,
            secure: next.email.secure ?? false,
            username: next.email.username ?? "",
            password: "",
            from: next.email.from ?? "",
            to: next.email.to ?? "",
          },
          telegram: { enabled: next.telegram.enabled, shoutrrUrl: "" },
        });
      })
      .catch((error) => setActionError(asError(error)));
  }, [operator.metadata]);

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

  async function saveDestinations() {
    if (!destinationForm) return;
    setSavingDestinations(true);
    setActionError(null);
    try {
      const result = await operatorMutation<{
        destinations: AlertDestinations;
      }>("/v1/alert-destinations", "PUT", destinationForm);
      setDestinations(result.destinations);
      setDestinationForm({
        ...destinationForm,
        email: { ...destinationForm.email, password: "" },
        telegram: { ...destinationForm.telegram, shoutrrUrl: "" },
      });
      if (form && form.destinationAlias !== "email-telegram")
        setForm({ ...form, destinationAlias: "email-telegram" });
    } catch (error) {
      setActionError(asError(error));
    } finally {
      setSavingDestinations(false);
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
            Configure LaunchNicely container health and Convex execution,
            provider, and backup alerts. Host-level monitoring remains in
            Beszel. Simple Mail Transfer Protocol (SMTP) passwords and Telegram
            Shoutrr URLs are write-only.
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
                className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"
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
                  value={
                    destinations?.configured
                      ? "Email + Telegram"
                      : "Not configured"
                  }
                  detail="Secrets remain on the private operator host"
                  warning={form.enabled && !destinations?.configured}
                />
                <EvidenceCard
                  label="Container"
                  value={
                    status?.alerts.metrics
                      ? `${status.alerts.metrics.container.status}/${status.alerts.metrics.container.health}`
                      : "Evidence unavailable"
                  }
                  detail={
                    status?.alerts.metrics
                      ? `${status.alerts.metrics.container.restartCount} restarts · out of memory (OOM) ${status.alerts.metrics.container.oomKilled ? "yes" : "no"}`
                      : "No container evidence"
                  }
                  warning={
                    !status?.alerts.metrics ||
                    status.alerts.metrics.container.health === "unhealthy"
                  }
                />
                <EvidenceCard
                  label="Function failures"
                  value={
                    status?.alerts.metrics
                      ? String(status.alerts.metrics.convex.functionFailures)
                      : "Evidence unavailable"
                  }
                  detail={`${form.lookbackMinutes} minute lookback · warning ${form.functionFailureWarningCount} · critical ${form.functionFailureCriticalCount}`}
                  warning={
                    (status?.alerts.metrics?.convex.functionFailures ?? 0) >=
                    form.functionFailureWarningCount
                  }
                />
                <EvidenceCard
                  label="Convex pressure"
                  value={
                    status?.alerts.metrics
                      ? String(
                          status.alerts.metrics.convex.permanentOccFailures +
                            status.alerts.metrics.convex.resourceLimitFailures,
                        )
                      : "Evidence unavailable"
                  }
                  detail={
                    status?.alerts.metrics
                      ? `${status.alerts.metrics.convex.permanentOccFailures} permanent optimistic concurrency control (OCC) · ${status.alerts.metrics.convex.resourceLimitFailures} read-limit failures`
                      : "No execution evidence"
                  }
                  warning={
                    (status?.alerts.metrics?.convex.permanentOccFailures ?? 0) >
                      0 ||
                    (status?.alerts.metrics?.convex.resourceLimitFailures ??
                      0) > 0
                  }
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

              {destinationForm && (
                <section
                  className="rounded-lg border bg-background-secondary p-4"
                  aria-labelledby="alert-destinations-title"
                >
                  <h4 id="alert-destinations-title" className="font-semibold">
                    Email and Telegram delivery
                  </h4>
                  <p className="mt-1 text-sm text-content-secondary">
                    Saving replaces supplied secrets; blank password or URL
                    fields preserve an existing secret. Secret values are never
                    returned to this page.
                  </p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className="flex items-center gap-2 text-sm sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={destinationForm.email.enabled}
                        onChange={(event) =>
                          setDestinationForm({
                            ...destinationForm,
                            email: {
                              ...destinationForm.email,
                              enabled: event.target.checked,
                            },
                          })
                        }
                      />
                      Enable email delivery
                    </label>
                    <OperatorField
                      label="SMTP mail-server host"
                      description="Hostname of the server that sends alert email using Simple Mail Transfer Protocol (SMTP)."
                    >
                      <input
                        className={operatorInputClasses}
                        value={destinationForm.email.host}
                        onChange={(event) =>
                          setDestinationForm({
                            ...destinationForm,
                            email: {
                              ...destinationForm.email,
                              host: event.target.value,
                            },
                          })
                        }
                      />
                    </OperatorField>
                    <OperatorNumberPresetField
                      label="SMTP mail-server port"
                      description="Choose the transport expected by your mail provider. The secure toggle must match."
                      value={destinationForm.email.port}
                      presets={SMTP_PORT_PRESETS}
                      min={1}
                      max={65535}
                      onChange={(port) =>
                        port !== null &&
                        setDestinationForm({
                          ...destinationForm,
                          email: { ...destinationForm.email, port },
                        })
                      }
                    />
                    <OperatorField
                      label="SMTP username"
                      description="Account identity used to authenticate to the outgoing mail server."
                    >
                      <input
                        className={operatorInputClasses}
                        autoComplete="username"
                        value={destinationForm.email.username}
                        onChange={(event) =>
                          setDestinationForm({
                            ...destinationForm,
                            email: {
                              ...destinationForm.email,
                              username: event.target.value,
                            },
                          })
                        }
                      />
                    </OperatorField>
                    <OperatorField
                      label="SMTP password"
                      description={
                        destinations?.email.passwordConfigured
                          ? "A password is configured. Leave this write-only field blank to keep the existing password."
                          : "Write-only password used to authenticate to the outgoing mail server."
                      }
                    >
                      <input
                        className={operatorInputClasses}
                        type="password"
                        autoComplete="new-password"
                        value={destinationForm.email.password}
                        onChange={(event) =>
                          setDestinationForm({
                            ...destinationForm,
                            email: {
                              ...destinationForm.email,
                              password: event.target.value,
                            },
                          })
                        }
                      />
                    </OperatorField>
                    <OperatorField
                      label="From address"
                      description="Envelope and message sender"
                    >
                      <input
                        className={operatorInputClasses}
                        type="email"
                        value={destinationForm.email.from}
                        onChange={(event) =>
                          setDestinationForm({
                            ...destinationForm,
                            email: {
                              ...destinationForm.email,
                              from: event.target.value,
                            },
                          })
                        }
                      />
                    </OperatorField>
                    <OperatorField
                      label="Recipient address"
                      description="Operator alert recipient"
                    >
                      <input
                        className={operatorInputClasses}
                        type="email"
                        value={destinationForm.email.to}
                        onChange={(event) =>
                          setDestinationForm({
                            ...destinationForm,
                            email: {
                              ...destinationForm.email,
                              to: event.target.value,
                            },
                          })
                        }
                      />
                    </OperatorField>
                    <label className="flex items-center gap-2 text-sm sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={destinationForm.email.secure}
                        onChange={(event) =>
                          setDestinationForm({
                            ...destinationForm,
                            email: {
                              ...destinationForm.email,
                              secure: event.target.checked,
                            },
                          })
                        }
                      />
                      Start with Transport Layer Security (TLS) encryption
                      immediately—normally port 465. Leave off for STARTTLS,
                      which upgrades a port 587 connection after it starts.
                    </label>
                    <label className="flex items-center gap-2 text-sm sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={destinationForm.telegram.enabled}
                        onChange={(event) =>
                          setDestinationForm({
                            ...destinationForm,
                            telegram: {
                              ...destinationForm.telegram,
                              enabled: event.target.checked,
                            },
                          })
                        }
                      />
                      Enable Telegram delivery
                    </label>
                    <OperatorField
                      label="Telegram Shoutrr URL"
                      description={
                        destinations?.telegram.shoutrrUrlConfigured
                          ? "A destination is configured. Leave this write-only field blank to keep it."
                          : "A Shoutrr connection URL containing the Telegram bot token and target chat, for example telegram://token@telegram?chats=…. It is stored only on the operator host."
                      }
                    >
                      <input
                        className={operatorInputClasses}
                        type="password"
                        autoComplete="off"
                        value={destinationForm.telegram.shoutrrUrl}
                        onChange={(event) =>
                          setDestinationForm({
                            ...destinationForm,
                            telegram: {
                              ...destinationForm.telegram,
                              shoutrrUrl: event.target.value,
                            },
                          })
                        }
                      />
                    </OperatorField>
                  </div>
                  <div className="mt-4">
                    <Button
                      loading={savingDestinations}
                      disabled={
                        !operator.metadata.capabilities.alertDestinations.write
                      }
                      onClick={() => void saveDestinations()}
                    >
                      Save destinations
                    </Button>
                  </div>
                </section>
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
                        setForm({
                          ...form,
                          enabled: event.target.checked,
                          destinationAlias: "email-telegram",
                        })
                      }
                    />
                    Enable alert delivery for this instance
                  </label>
                  <Threshold
                    label="Measurement window, minutes"
                    description="Each alert evaluation counts matching events from this many recent minutes. A longer window is less sensitive to brief spikes but takes longer to clear."
                    value={form.lookbackMinutes}
                    onChange={(lookbackMinutes) =>
                      setForm({ ...form, lookbackMinutes })
                    }
                    min={5}
                    max={1440}
                  />
                  <Threshold
                    label="Function failures warning"
                    description="Number of failed Convex function executions within the measurement window that produces a warning alert."
                    value={form.functionFailureWarningCount}
                    onChange={(functionFailureWarningCount) =>
                      setForm({ ...form, functionFailureWarningCount })
                    }
                  />
                  <Threshold
                    label="Function failures critical"
                    description="Number of failed Convex function executions within the measurement window that produces a critical alert."
                    value={form.functionFailureCriticalCount}
                    onChange={(functionFailureCriticalCount) =>
                      setForm({ ...form, functionFailureCriticalCount })
                    }
                  />
                  <Threshold
                    label="Permanent optimistic concurrency failures warning"
                    description="Number of mutations that still fail after all optimistic concurrency control (OCC) retries within the measurement window."
                    value={form.permanentOccWarningCount}
                    onChange={(permanentOccWarningCount) =>
                      setForm({ ...form, permanentOccWarningCount })
                    }
                  />
                  <Threshold
                    label="Permanent optimistic concurrency failures critical"
                    description="Critical threshold for mutations that still fail after all optimistic concurrency control (OCC) retries within the measurement window."
                    value={form.permanentOccCriticalCount}
                    onChange={(permanentOccCriticalCount) =>
                      setForm({ ...form, permanentOccCriticalCount })
                    }
                  />
                  <Threshold
                    label="Read-limit failures warning"
                    description="Number of function executions that exceed Convex document-read or byte-read limits within the measurement window."
                    value={form.resourceLimitWarningCount}
                    onChange={(resourceLimitWarningCount) =>
                      setForm({ ...form, resourceLimitWarningCount })
                    }
                  />
                  <Threshold
                    label="Read-limit failures critical"
                    description="Critical threshold for function executions that exceed Convex document-read or byte-read limits within the measurement window."
                    value={form.resourceLimitCriticalCount}
                    onChange={(resourceLimitCriticalCount) =>
                      setForm({ ...form, resourceLimitCriticalCount })
                    }
                  />
                  <Threshold
                    label="Container restarts warning"
                    description="Number of backend-container restarts observed within the measurement window that produces a warning alert."
                    value={form.containerRestartWarningCount}
                    onChange={(containerRestartWarningCount) =>
                      setForm({ ...form, containerRestartWarningCount })
                    }
                  />
                  <Threshold
                    label="Container restarts critical"
                    description="Number of backend-container restarts observed within the measurement window that produces a critical alert."
                    value={form.containerRestartCriticalCount}
                    onChange={(containerRestartCriticalCount) =>
                      setForm({ ...form, containerRestartCriticalCount })
                    }
                  />
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.alertOnContainerUnhealthy}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          alertOnContainerUnhealthy: event.target.checked,
                        })
                      }
                    />
                    Container unhealthy, stopped, or terminated because it ran
                    out of memory (OOM)
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.alertOnProviderUnavailable}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          alertOnProviderUnavailable: event.target.checked,
                        })
                      }
                    />
                    PostgreSQL database or Cloudflare R2 object storage
                    degraded/unavailable
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.alertOnBackupFailure}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          alertOnBackupFailure: event.target.checked,
                        })
                      }
                    />
                    Backup scheduler failure
                  </label>
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
  description,
  value,
  onChange,
  min = 0,
  max = 1_000_000,
}: {
  label: string;
  description: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  const presets = label.startsWith("Measurement window")
    ? ALERT_WINDOW_PRESETS
    : ALERT_THRESHOLD_PRESETS;
  return (
    <OperatorNumberPresetField
      label={label}
      description={description}
      value={value}
      presets={presets.filter(
        (preset) =>
          typeof preset.value === "number" &&
          preset.value >= min &&
          preset.value <= max,
      )}
      min={min}
      max={max}
      onChange={(nextValue) => nextValue !== null && onChange(nextValue)}
    />
  );
}

const SMTP_PORT_PRESETS = [
  {
    label: "587 · STARTTLS (recommended)",
    value: 587,
    description:
      "The standard authenticated submission port; keep implicit TLS off.",
  },
  {
    label: "465 · implicit TLS",
    value: 465,
    description: "TLS starts immediately; enable the secure transport toggle.",
  },
  {
    label: "2525 · alternate submission",
    value: 2525,
    description: "Common provider fallback when port 587 is unavailable.",
  },
];

const ALERT_WINDOW_PRESETS = [
  {
    label: "5 minutes · fast",
    value: 5,
    description: "Fastest response, with more sensitivity to brief spikes.",
  },
  {
    label: "15 minutes · balanced (recommended)",
    value: 15,
    description: "Balances detection speed and transient noise.",
  },
  {
    label: "30 minutes · steady",
    value: 30,
    description: "Smooths short-lived bursts before escalating.",
  },
  {
    label: "1 hour · low noise",
    value: 60,
    description: "Favors persistent trends over immediate detection.",
  },
  {
    label: "4 hours · broad trend",
    value: 240,
    description: "Useful for low-volume development instances.",
  },
];

const ALERT_THRESHOLD_PRESETS = [
  {
    label: "1 event · alert immediately",
    value: 1,
    description:
      "Triggers on the first matching event in the measurement window.",
  },
  {
    label: "3 events",
    value: 3,
    description: "Allows two isolated events before triggering.",
  },
  {
    label: "5 events · balanced",
    value: 5,
    description: "A practical threshold for recurring failures.",
  },
  {
    label: "10 events",
    value: 10,
    description: "Reduces noise for busier workloads.",
  },
  {
    label: "20 events",
    value: 20,
    description:
      "High threshold intended for critical escalation or high traffic.",
  },
];

function validateAlerts(form: AlertsForm | null) {
  if (!form) return [];
  const issues: string[] = [];
  if (form.enabled && !form.destinationAlias)
    issues.push("Enabled alerts require a destination alias.");
  const thresholds = [
    form.functionFailureWarningCount,
    form.functionFailureCriticalCount,
    form.permanentOccWarningCount,
    form.permanentOccCriticalCount,
    form.resourceLimitWarningCount,
    form.resourceLimitCriticalCount,
    form.containerRestartWarningCount,
    form.containerRestartCriticalCount,
  ];
  if (!thresholds.every((value) => Number.isSafeInteger(value) && value >= 0))
    issues.push("Every alert threshold must be a nonnegative integer.");
  for (const [warning, critical, label] of [
    [
      form.functionFailureWarningCount,
      form.functionFailureCriticalCount,
      "Function failures",
    ],
    [
      form.permanentOccWarningCount,
      form.permanentOccCriticalCount,
      "Permanent optimistic concurrency control failures",
    ],
    [
      form.resourceLimitWarningCount,
      form.resourceLimitCriticalCount,
      "Read-limit failures",
    ],
    [
      form.containerRestartWarningCount,
      form.containerRestartCriticalCount,
      "Container restarts",
    ],
  ] as const)
    if (warning >= critical)
      issues.push(`${label} warning must be below critical.`);
  if (
    !Number.isSafeInteger(form.lookbackMinutes) ||
    form.lookbackMinutes < 5 ||
    form.lookbackMinutes > 1440
  )
    issues.push("Lookback must be from 5 through 1440 minutes.");
  return issues;
}

function asError(value: unknown) {
  return value instanceof Error
    ? value
    : new Error("Unknown operator action error");
}
