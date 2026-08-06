import { useCallback, useEffect, useMemo, useState } from "react";
import { DeploymentSettingsLayout } from "@common/layouts/DeploymentSettingsLayout";
import { Button } from "@ui/Button";
import { Callout } from "@ui/Callout";
import { OperatorActionConfirmation } from "../../components/operator/OperatorActionConfirmation";
import {
  ExecutedOperatorAction,
  OperatorApiError,
  OperatorConfiguration,
  OperatorMetadata,
  OperatorStatus,
  PreparedOperatorAction,
  operatorGet,
  operatorMutation,
} from "../../lib/operatorApi";

type BackupForm = OperatorConfiguration["backup"];

export default function BackupsPage() {
  const [configuration, setConfiguration] =
    useState<OperatorConfiguration | null>(null);
  const [metadata, setMetadata] = useState<OperatorMetadata | null>(null);
  const [status, setStatus] = useState<OperatorStatus | null>(null);
  const [form, setForm] = useState<BackupForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [prepared, setPrepared] = useState<PreparedOperatorAction | null>(null);
  const [accepted, setAccepted] = useState<ExecutedOperatorAction | null>(null);
  const [targetInstanceId, setTargetInstanceId] = useState("");
  const [archiveId, setArchiveId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [configurationResponse, nextMetadata] = await Promise.all([
        operatorGet<{ configuration: OperatorConfiguration }>(
          "/v1/configuration",
        ),
        operatorGet<OperatorMetadata>("/v1/metadata"),
      ]);
      const nextStatus = nextMetadata.capabilities.status.read
        ? await operatorGet<{ status: OperatorStatus }>("/v1/status").then(
            (response) => response.status,
          )
        : null;
      setConfiguration(configurationResponse.configuration);
      setForm(configurationResponse.configuration.backup);
      setMetadata(nextMetadata);
      setStatus(nextStatus);
      setArchiveId(nextStatus?.backups.archives[0]?.id ?? "");
    } catch (requestError) {
      setError(asError(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changed =
    configuration !== null &&
    form !== null &&
    JSON.stringify(configuration.backup) !== JSON.stringify(form);
  const issues = useMemo(() => validateForm(form), [form]);
  const selectedArchive = status?.backups.archives.find(
    (archive) => archive.id === archiveId,
  );

  async function save() {
    if (!configuration || !form || issues.length > 0) return;
    setSaving(true);
    setError(null);
    try {
      const result = await operatorMutation<{
        current: OperatorConfiguration;
        rollback: OperatorConfiguration;
        restartRequired: boolean;
      }>("/v1/configuration", "PATCH", {
        baseRevision: configuration.revision,
        changes: { backup: form },
      });
      setConfiguration(result.current);
      setForm(result.current.backup);
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

  async function prepareAction(
    kind: "manual-backup" | "restore-to-new",
    parameters: Record<string, unknown>,
  ) {
    if (!configuration) return;
    setError(null);
    setAccepted(null);
    try {
      const result = await operatorMutation<PreparedOperatorAction>(
        "/v1/actions/prepare",
        "POST",
        {
          kind,
          instanceId: configuration.instance.id,
          baseRevision: configuration.revision,
          parameters,
        },
      );
      setPrepared(result);
    } catch (requestError) {
      setError(asError(requestError));
    }
  }

  return (
    <DeploymentSettingsLayout page="backups">
      <div className="flex flex-col gap-6">
        <header>
          <h3 className="font-semibold">Backup and restore</h3>
          <p className="mt-1 max-w-prose text-sm text-content-secondary">
            Configure storage-inclusive logical backups and restore only into a
            new private deployment. Existing deployments are never overwritten
            from this page.
          </p>
        </header>

        {loading && (
          <Panel
            title="Loading backup evidence"
            detail="Waiting for configuration, archive, and restore-drill status."
          />
        )}
        {error && <ErrorCallout error={error} onRetry={load} />}
        {accepted && (
          <Callout variant="success">
            <div>
              <div className="font-medium">{accepted.kind} accepted.</div>
              <div>
                Action <code>{accepted.actionId}</code> was accepted at{" "}
                {new Date(accepted.acceptedAt).toLocaleString()}. Refresh status
                to observe completion.
              </div>
            </div>
          </Callout>
        )}

        {configuration && form && metadata && !loading && (
          <>
            <BackupEvidence configuration={configuration} status={status} />

            <section
              className="rounded-lg border bg-background-secondary p-4"
              aria-labelledby="backup-policy-title"
            >
              <h4 id="backup-policy-title" className="font-semibold">
                Backup policy
              </h4>
              <p className="mt-1 text-sm text-content-secondary">
                Destination values are aliases to server-side
                secret/configuration entries; credentials are never returned
                here.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(event) =>
                      setForm({ ...form, enabled: event.target.checked })
                    }
                  />
                  Schedule automatic backups
                </label>
                <Field
                  label="Schedule"
                  description="Five-field cron in UTC, evaluated by the reviewed host scheduler."
                >
                  <input
                    className={inputClasses}
                    value={form.schedule ?? ""}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        schedule: nullIfEmpty(event.target.value),
                      })
                    }
                    placeholder="0 2 * * *"
                  />
                </Field>
                <Field
                  label="Destination alias"
                  description="A non-secret alias configured on the operator host."
                >
                  <input
                    className={inputClasses}
                    value={form.destinationAlias ?? ""}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        destinationAlias: nullIfEmpty(event.target.value),
                      })
                    }
                    autoComplete="off"
                  />
                </Field>
                <NumberField
                  label="Retention days"
                  value={form.retentionDays}
                  onChange={(retentionDays) =>
                    setForm({ ...form, retentionDays })
                  }
                />
                <NumberField
                  label="RPO hours"
                  value={form.rpoHours}
                  onChange={(rpoHours) => setForm({ ...form, rpoHours })}
                />
                <NumberField
                  label="RTO hours"
                  value={form.rtoHours}
                  onChange={(rtoHours) => setForm({ ...form, rtoHours })}
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
                  <div className="font-medium">Review policy revision</div>
                  <div className="mt-1">
                    Target <code>{configuration.instance.id}</code>, base
                    revision {configuration.revision}. This updates scheduler
                    policy without running a backup or restore.
                  </div>
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
              <div className="mt-4 flex gap-2">
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
                    setForm(configuration.backup);
                    setReviewing(false);
                  }}
                >
                  Reset
                </Button>
              </div>
            </section>

            <section
              className="rounded-lg border bg-background-secondary p-4"
              aria-labelledby="backup-actions-title"
            >
              <h4 id="backup-actions-title" className="font-semibold">
                Operator actions
              </h4>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div className="rounded-md border bg-background-primary p-3">
                  <div className="font-medium">Create backup now</div>
                  <p className="mt-1 text-sm text-content-secondary">
                    Create a storage-inclusive recovery point using the
                    configured destination alias.
                  </p>
                  <Button
                    className="mt-3"
                    variant="neutral"
                    disabled={
                      !metadata.capabilities.actions["manual-backup"]
                        ?.enabled || changed
                    }
                    tip={
                      changed
                        ? "Save or reset the pending policy change first."
                        : undefined
                    }
                    onClick={() => void prepareAction("manual-backup", {})}
                  >
                    Prepare manual backup
                  </Button>
                </div>
                <div className="rounded-md border bg-background-primary p-3">
                  <div className="font-medium">Restore to a new deployment</div>
                  <p className="mt-1 text-sm text-content-secondary">
                    The source stays online. The new target remains private
                    until reconciliation succeeds.
                  </p>
                  <label className="mt-3 flex flex-col gap-1 text-sm">
                    Archive
                    <select
                      className={inputClasses}
                      value={archiveId}
                      onChange={(event) => setArchiveId(event.target.value)}
                    >
                      <option value="">Select a verified archive</option>
                      {(status?.backups.archives ?? []).map((archive) => (
                        <option
                          key={archive.id}
                          value={archive.id}
                          disabled={!archive.verified}
                        >
                          {archive.id} · {formatBytes(archive.sizeBytes)}
                          {archive.verified ? "" : " · unverified"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="mt-3 flex flex-col gap-1 text-sm">
                    New target instance ID
                    <input
                      className={inputClasses}
                      value={targetInstanceId}
                      onChange={(event) =>
                        setTargetInstanceId(event.target.value)
                      }
                      autoComplete="off"
                    />
                  </label>
                  <Button
                    className="mt-3"
                    variant="neutral"
                    disabled={
                      !metadata.capabilities.actions["restore-to-new"]
                        ?.enabled ||
                      !selectedArchive?.verified ||
                      targetInstanceId.trim() === "" ||
                      targetInstanceId === configuration.instance.id ||
                      changed
                    }
                    onClick={() =>
                      selectedArchive &&
                      void prepareAction("restore-to-new", {
                        targetInstanceId,
                        archiveId: selectedArchive.id,
                        archiveSha256: selectedArchive.sha256,
                      })
                    }
                  >
                    Prepare isolated restore
                  </Button>
                </div>
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

function BackupEvidence({
  configuration,
  status,
}: {
  configuration: OperatorConfiguration;
  status: OperatorStatus | null;
}) {
  const last = status?.backups.lastSuccessful;
  const freshness = !status
    ? "Unavailable"
    : status.freshness.state === "stale"
      ? "Stale"
      : "Current";
  const rpoState =
    last &&
    Date.now() - Date.parse(last.completedAt) <=
      configuration.backup.rpoHours * 3600_000
      ? "Within RPO"
      : "Outside or unknown";
  const scheduler = status?.backups.scheduler;
  return (
    <section
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      aria-label="Backup evidence"
    >
      <Evidence
        label="Status evidence"
        value={freshness}
        detail={
          status
            ? `Generated ${new Date(status.generatedAt).toLocaleString()}`
            : "No validated status provider"
        }
        warning={freshness !== "Current"}
      />
      <Evidence
        label="Last verified backup"
        value={last?.verified ? last.id : "Unknown"}
        detail={
          last
            ? `${new Date(last.completedAt).toLocaleString()} · ${formatBytes(last.sizeBytes)}`
            : "No archive evidence"
        }
        warning={!last?.verified}
      />
      <Evidence
        label="Recovery point"
        value={rpoState}
        detail={`Declared RPO ${configuration.backup.rpoHours} hours`}
        warning={rpoState !== "Within RPO"}
      />
      <Evidence
        label="Restore drill"
        value={status?.backups.restoreDrill.state ?? "Unknown"}
        detail={
          status?.backups.restoreDrill.completedAt
            ? new Date(status.backups.restoreDrill.completedAt).toLocaleString()
            : "No completed drill evidence"
        }
        warning={status?.backups.restoreDrill.state !== "passed"}
      />
      <Evidence
        label="Backup scheduler"
        value={scheduler?.state ?? "Unknown"}
        detail={
          scheduler?.lastEvaluatedAt
            ? `Revision ${scheduler.configurationRevision ?? "unknown"} · checked ${new Date(scheduler.lastEvaluatedAt).toLocaleString()}${scheduler.lastError ? ` · ${scheduler.lastError}` : ""}`
            : "No scheduler evidence"
        }
        warning={
          configuration.backup.enabled
            ? !scheduler || ["unknown", "failed", "disabled"].includes(scheduler.state)
            : scheduler?.state !== "disabled"
        }
      />
    </section>
  );
}

function Evidence({
  label,
  value,
  detail,
  warning,
}: {
  label: string;
  value: string;
  detail: string;
  warning: boolean;
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

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      <span className="text-xs text-content-secondary">{description}</span>
    </label>
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
  return (
    <Field label={label} description="Positive whole number.">
      <input
        className={inputClasses}
        type="number"
        min={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  );
}

function Panel({ title, detail }: { title: string; detail: string }) {
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
  return (
    <Callout variant="error">
      <div className="flex flex-col gap-2">
        <div>
          <div className="font-medium">Backup controls are unavailable.</div>
          <div>{error.message}</div>
        </div>
        {error instanceof OperatorApiError && error.issues.length > 0 && (
          <ul className="list-disc pl-5">
            {error.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
        <Button variant="neutral" size="xs" onClick={() => void onRetry()}>
          Retry
        </Button>
      </div>
    </Callout>
  );
}

function validateForm(form: BackupForm | null) {
  if (!form) return [];
  const issues = [];
  if (form.enabled && !form.schedule)
    issues.push("Enabled backups require a schedule.");
  if (form.enabled && !form.destinationAlias)
    issues.push("Enabled backups require a destination alias.");
  if (
    ![form.retentionDays, form.rpoHours, form.rtoHours].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    )
  )
    issues.push("Retention, RPO, and RTO must be positive whole numbers.");
  return issues;
}

function nullIfEmpty(value: string) {
  return value.trim() === "" ? null : value;
}

function formatBytes(value: number) {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GiB`;
  return `${(value / 1024 ** 2).toFixed(1)} MiB`;
}

function asError(value: unknown) {
  return value instanceof Error
    ? value
    : new Error("Unknown operator API error");
}

const inputClasses =
  "min-h-9 w-full rounded-md border bg-background-primary px-3 text-content-primary";
