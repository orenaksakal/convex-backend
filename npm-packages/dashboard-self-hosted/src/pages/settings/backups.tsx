import { useCallback, useMemo, useRef, useState } from "react";
import { DeploymentSettingsLayout } from "@common/layouts/DeploymentSettingsLayout";
import { Button } from "@ui/Button";
import { Callout } from "@ui/Callout";
import { HealthSignal } from "../../components/operator/HealthSignal";
import { OperatorActionConfirmation } from "../../components/operator/OperatorActionConfirmation";
import { OperatorResourceFreshness } from "../../components/operator/OperatorResourceFreshness";
import { useOperatorResource } from "../../components/operator/useOperatorResource";
import {
  OperatorNumberPresetField,
  OperatorTextPresetField,
} from "../../components/operator/OperatorPagePrimitives";
import { backupSchedulePresentation } from "../../components/operator/TruthfulEvidence";
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
import { SnapshotTools } from "./snapshots";

type BackupForm = OperatorConfiguration["backup"];

export default function BackupsPage() {
  const [configuration, setConfiguration] =
    useState<OperatorConfiguration | null>(null);
  const [metadata, setMetadata] = useState<OperatorMetadata | null>(null);
  const [status, setStatus] = useState<OperatorStatus | null>(null);
  const [form, setForm] = useState<BackupForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [prepared, setPrepared] = useState<PreparedOperatorAction | null>(null);
  const [accepted, setAccepted] = useState<ExecutedOperatorAction | null>(null);
  const [targetInstanceId, setTargetInstanceId] = useState("");
  const [archiveId, setArchiveId] = useState("");
  const formDirtyRef = useRef(false);

  const load = useCallback(async () => {
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
    if (!formDirtyRef.current) {
      setForm(configurationResponse.configuration.backup);
    }
    setMetadata(nextMetadata);
    setStatus(nextStatus);
    setArchiveId((current) =>
      nextStatus?.backups.archives.some((archive) => archive.id === current)
        ? current
        : (nextStatus?.backups.archives[0]?.id ?? ""),
    );
  }, []);
  const resource = useOperatorResource(load);

  const changed =
    configuration !== null &&
    form !== null &&
    JSON.stringify(configuration.backup) !== JSON.stringify(form);
  formDirtyRef.current = changed;
  const issues = useMemo(() => validateForm(form), [form]);
  const selectedArchive = status?.backups.archives.find(
    (archive) => archive.id === archiveId,
  );
  const backupSchedule = configuration
    ? backupSchedulePresentation(configuration.backup, status)
    : null;

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
        changes: { backup: normalizeBackupPolicy(form) },
      });
      setConfiguration(result.current);
      setForm(result.current.backup);
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
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">Data protection</h3>
            <p className="mt-1 max-w-prose text-sm text-content-secondary">
              Configure automatic backups, retention, restores, imports, and
              exports from one page. Saved policy and current scheduler evidence
              are shown separately.
            </p>
          </div>
          <OperatorResourceFreshness
            label="Backup evidence"
            lastUpdatedAt={resource.lastUpdatedAt}
            refreshing={resource.refreshing}
            error={resource.error}
            onRefresh={resource.refresh}
          />
        </header>

        {resource.loading && (
          <Panel
            title="Loading backup evidence"
            detail="Waiting for configuration, archive, and restore-drill status."
          />
        )}
        {resource.error && (
          <ErrorCallout error={resource.error} onRetry={resource.refresh} />
        )}
        {error && <ErrorCallout error={error} onRetry={resource.refresh} />}
        {accepted && (
          <Callout variant="success">
            <div>
              <div className="font-medium">{actionResultTitle(accepted)}</div>
              <div>{actionResultDetail(accepted)}</div>
            </div>
          </Callout>
        )}

        {configuration && form && metadata && !resource.loading && (
          <>
            <BackupEvidence configuration={configuration} status={status} />

            <section
              className="rounded-lg border bg-background-secondary p-4"
              aria-labelledby="backup-policy-title"
            >
              <h4 id="backup-policy-title" className="font-semibold">
                Automatic backup policy
              </h4>
              <p className="mt-1 text-sm text-content-secondary">
                Fleet-managed deployments can receive a daily UTC default. This
                section reports the actual saved policy; provider and credential
                choices stay managed.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="flex items-center gap-3 rounded-md border bg-background-primary p-3 text-sm sm:col-span-2">
                  {backupSchedule && (
                    <>
                      <HealthSignal
                        level={backupSchedule.level}
                        label={backupSchedule.label}
                        compact
                      />
                      <span className="text-content-secondary">
                        {backupSchedule.detail}
                      </span>
                    </>
                  )}
                </div>
                <OperatorTextPresetField
                  label="Schedule"
                  description="Choose a common UTC schedule or enter a five-field cron expression."
                  value={form.schedule}
                  presets={BACKUP_SCHEDULE_PRESETS}
                  onChange={(schedule) =>
                    setForm({
                      ...form,
                      schedule,
                      rpoHours: backupIntervalHours(schedule) ?? form.rpoHours,
                    })
                  }
                  customLabel="Custom cron expression"
                  placeholder="0 2 * * *"
                />
                <Field
                  label="Backup destination"
                  description="Assigned automatically. Archives are isolated under this project and deployment's folder in the fleet backup bucket."
                >
                  <div className="rounded-md border bg-background-tertiary px-3 py-2 text-sm">
                    <div className="font-mono font-medium">
                      {form.destinationAlias ?? "Provisioning incomplete"}
                    </div>
                    <div className="mt-1 text-xs text-content-secondary">
                      Managed by the private fleet host · credentials hidden
                    </div>
                  </div>
                </Field>
                <OperatorNumberPresetField
                  label="Retention days"
                  description="Number of days successful backup archives are kept before the host scheduler removes them. This is retention, not backup frequency."
                  value={form.retentionDays}
                  presets={RETENTION_PRESETS}
                  min={1}
                  onChange={(retentionDays) =>
                    retentionDays !== null &&
                    setForm({ ...form, retentionDays })
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
                  <div className="font-medium">Review policy revision</div>
                  <div className="mt-1">
                    Target <code>{configuration.instance.id}</code>, base
                    revision {configuration.revision}. This updates scheduler
                    policy without running a backup or restore.
                  </div>
                  <dl className="mt-3 grid gap-3 rounded-sm bg-background-tertiary p-3 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-content-secondary">
                        Schedule
                      </dt>
                      <dd className="mt-1 font-mono">{form.schedule}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-content-secondary">
                        Retention
                      </dt>
                      <dd className="mt-1">{form.retentionDays} days</dd>
                    </div>
                  </dl>
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
                    Create a verified backup containing PostgreSQL data and R2
                    objects.
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
                  void load();
                }}
              />
            )}
          </>
        )}

        <SnapshotTools />
      </div>
    </DeploymentSettingsLayout>
  );
}

function actionResultTitle(action: ExecutedOperatorAction) {
  return action.kind === "manual-backup" && action.result?.accepted === true
    ? "Backup completed and verified."
    : `${action.kind} completed.`;
}

function actionResultDetail(action: ExecutedOperatorAction) {
  if (action.kind === "manual-backup" && action.result?.accepted === true) {
    const archiveId =
      typeof action.result?.archiveId === "string"
        ? action.result.archiveId
        : null;
    const sizeBytes =
      typeof action.result?.sizeBytes === "number"
        ? action.result.sizeBytes
        : null;
    return (
      <>
        Action <code>{action.actionId}</code>
        {archiveId ? (
          <>
            {" "}
            created archive <code>{archiveId}</code>
          </>
        ) : null}
        {sizeBytes === null ? null : <> ({formatBytes(sizeBytes)})</>}. Backup
        evidence was refreshed.
      </>
    );
  }
  return (
    <>
      Action <code>{action.actionId}</code> completed at{" "}
      {new Date(action.acceptedAt).toLocaleString()}.
    </>
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
        value={last?.verified ? last.id : "No verified backup"}
        detail={
          last
            ? `${new Date(last.completedAt).toLocaleString()} · ${formatBytes(
                last.sizeBytes,
              )}`
            : "No archive evidence"
        }
        warning={!last?.verified}
      />
      <Evidence
        label="Restore drill"
        value={status?.backups.restoreDrill.state ?? "Not reported"}
        detail={
          status?.backups.restoreDrill.completedAt
            ? new Date(status.backups.restoreDrill.completedAt).toLocaleString()
            : "No completed drill evidence"
        }
        warning={status?.backups.restoreDrill.state !== "passed"}
      />
      <Evidence
        label="Backup scheduler"
        value={
          scheduler?.state === "unknown"
            ? "Probe unavailable"
            : (scheduler?.state ?? "Unavailable")
        }
        detail={
          scheduler?.lastEvaluatedAt
            ? `Revision ${
                scheduler.configurationRevision ?? "not reported"
              } · checked ${new Date(
                scheduler.lastEvaluatedAt,
              ).toLocaleString()}${
                scheduler.lastError ? ` · ${scheduler.lastError}` : ""
              }`
            : "No scheduler evidence"
        }
        warning={
          configuration.backup.enabled
            ? !scheduler ||
              ["unknown", "failed", "disabled"].includes(scheduler.state)
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

function Panel({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border bg-background-secondary p-4">
      <div className="font-medium">{title}</div>
      <div className="text-sm text-content-secondary">{detail}</div>
    </div>
  );
}

const BACKUP_SCHEDULE_PRESETS = [
  {
    label: "Hourly · on the hour",
    value: "0 * * * *",
    description: "Runs at minute 0 of every hour in UTC.",
  },
  {
    label: "Daily · 02:00 UTC (recommended)",
    value: "0 2 * * *",
    description: "A balanced default that runs once per day at 02:00 UTC.",
  },
];

const RETENTION_PRESETS = [
  {
    label: "7 days",
    value: 7,
    description: "One week of backup archives with the lowest storage use.",
  },
  {
    label: "30 days (recommended)",
    value: 30,
    description: "A practical month-long recovery window.",
  },
  {
    label: "90 days",
    value: 90,
    description: "A quarter of recovery history for slower incident discovery.",
  },
  {
    label: "365 days",
    value: 365,
    description:
      "One year of archives; confirm storage cost and lifecycle policy.",
  },
];

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
  if (!Number.isSafeInteger(form.retentionDays) || form.retentionDays <= 0)
    issues.push("Retention days must be a positive whole number.");
  return issues;
}

function normalizeBackupPolicy(form: BackupForm): BackupForm {
  return {
    ...form,
    rpoHours: backupIntervalHours(form.schedule) ?? form.rpoHours,
  };
}

function backupIntervalHours(schedule: string | null): number | null {
  switch (schedule) {
    case "0 * * * *":
      return 1;
    case "0 */6 * * *":
      return 6;
    case "0 2 * * *":
      return 24;
    case "0 2 * * 0":
      return 168;
    default:
      return null;
  }
}

function formatBytes(value: number) {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} gibibytes`;
  return `${(value / 1024 ** 2).toFixed(1)} mebibytes`;
}

function asError(value: unknown) {
  return value instanceof Error
    ? value
    : new Error("Unknown operator API error");
}

const inputClasses =
  "min-h-9 w-full rounded-md border bg-background-primary px-3 text-content-primary";
