import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { DeploymentSettingsLayout } from "@common/layouts/DeploymentSettingsLayout";
import { PauseDeployment } from "@common/features/settings/components/PauseDeployment";
import { useScrollToHash } from "@common/lib/useScrollToHash";
import { Button } from "@ui/Button";
import { Callout } from "@ui/Callout";
import {
  EvidenceCard,
  formatOperatorDate,
  OperatorError,
  OperatorField,
  OperatorLoading,
  operatorInputClasses,
} from "../../components/operator/OperatorPagePrimitives";
import { useOperatorState } from "../../components/operator/useOperatorState";
import { OperatorConfiguration } from "../../lib/operatorApi";
import { SelfHostedSettingsContext } from "../../lib/selfHostedSettings";

type ProvidersForm = OperatorConfiguration["providers"];
type SafetyForm = {
  dashboardEditConfirmation: boolean;
  redactLogsToClient: boolean;
};

export default function Settings() {
  const pauseDeploymentRef = useRef<HTMLDivElement | null>(null);
  useScrollToHash("#pause-deployment", pauseDeploymentRef);
  const operator = useOperatorState();
  const selfHostedSettings = useContext(SelfHostedSettingsContext);
  const [form, setForm] = useState<ProvidersForm | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [safetyForm, setSafetyForm] = useState<SafetyForm | null>(null);
  const [safetyReviewing, setSafetyReviewing] = useState(false);
  const [safetySaving, setSafetySaving] = useState(false);
  const [safetyMessage, setSafetyMessage] = useState<string | null>(null);
  const [safetyRollback, setSafetyRollback] = useState<SafetyForm | null>(null);

  useEffect(() => {
    if (!operator.configuration) return;
    setForm(operator.configuration.providers);
    setSafetyForm(safetyFromConfiguration(operator.configuration));
  }, [operator.configuration]);

  const changed =
    form !== null &&
    operator.configuration !== null &&
    JSON.stringify(form) !== JSON.stringify(operator.configuration.providers);
  const issues = useMemo(() => validateProviders(form), [form]);
  const originalSafety = operator.configuration
    ? safetyFromConfiguration(operator.configuration)
    : null;
  const safetyChanged =
    safetyForm !== null &&
    originalSafety !== null &&
    JSON.stringify(safetyForm) !== JSON.stringify(originalSafety);

  async function save() {
    if (!form || issues.length > 0) return;
    setSaving(true);
    try {
      const result = await operator.patch({ providers: form });
      setForm(result.current.providers);
      setReviewing(false);
    } catch {
      // The shared hook renders the exact API error and refreshes conflicts.
    } finally {
      setSaving(false);
    }
  }

  async function saveSafety() {
    if (!safetyForm) return;
    setSafetySaving(true);
    setSafetyMessage(null);
    try {
      const result = await operator.patch({
        security: {
          dashboardEditConfirmation:
            safetyForm.dashboardEditConfirmation,
        },
        runtime: {
          knobs: { REDACT_LOGS_TO_CLIENT: safetyForm.redactLogsToClient },
        },
      });
      const current = safetyFromConfiguration(result.current);
      setSafetyForm(current);
      setSafetyRollback(safetyFromConfiguration(result.rollback));
      selfHostedSettings.setDashboardEditConfirmation(
        current.dashboardEditConfirmation,
      );
      setSafetyReviewing(false);
      setSafetyMessage(
        result.restartRequired
          ? "Safety preferences saved. Edit confirmation is effective now; a separately confirmed restart is required for client-log redaction."
          : "Safety preferences saved and effective.",
      );
    } catch {
      // The shared hook displays the exact API error and refreshes conflicts.
    } finally {
      setSafetySaving(false);
    }
  }

  const configuration = operator.configuration;
  const status = operator.status;

  return (
    <DeploymentSettingsLayout page="general">
      <div className="flex flex-col gap-6">
        <header>
          <h3 className="font-semibold">Deployment summary</h3>
          <p className="mt-1 max-w-prose text-sm text-content-secondary">
            Deployment-local identity, provider, revision, health, and release
            evidence. Docker placement, domains, TLS, and host routing remain in
            deployment manifests and are intentionally not editable here.
          </p>
        </header>

        {operator.loading && (
          <OperatorLoading detail="Waiting for deployment configuration and effective-state evidence." />
        )}
        {operator.error && (
          <OperatorError error={operator.error} onRetry={operator.refresh} />
        )}

        {configuration && form && !operator.loading && (
          <>
            <section
              className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
              aria-label="Deployment summary"
            >
              <EvidenceCard
                label="Instance"
                value={configuration.instance.displayName}
                detail={configuration.instance.id}
              />
              <EvidenceCard
                label="Deployment URL"
                value={hostLabel(configuration.instance.deploymentUrl)}
                detail={
                  configuration.instance.siteUrl
                    ? `Site ${configuration.instance.siteUrl}`
                    : "No site URL declared"
                }
              />
              <EvidenceCard
                label="Configuration"
                value={`Revision ${configuration.revision}`}
                detail={`Updated ${formatOperatorDate(configuration.updatedAt)}`}
              />
              <EvidenceCard
                label="Effective health"
                value={status?.health.state ?? "Unavailable"}
                detail={
                  status
                    ? `${status.freshness.state} evidence · ${formatOperatorDate(status.generatedAt)}`
                    : "No validated status provider"
                }
                warning={
                  !status ||
                  status.freshness.state !== "current" ||
                  status.health.state !== "healthy"
                }
              />
              <EvidenceCard
                label="Runtime profile"
                value={configuration.runtime.profile}
                detail={`${formatBytes(configuration.runtime.memoryMaxBytes)} memory.max · no CPU quota`}
              />
              <EvidenceCard
                label="Database"
                value={status?.providers.database.kind ?? form.database.kind}
                detail={providerDetail(
                  status?.providers.database.state,
                  status?.providers.database.checkedAt,
                )}
                warning={
                  status?.freshness.state !== "current" ||
                  status?.providers.database.state !== "healthy"
                }
              />
              <EvidenceCard
                label="Object storage"
                value={
                  status?.providers.objectStorage.kind ??
                  form.objectStorage.kind
                }
                detail={providerDetail(
                  status?.providers.objectStorage.state,
                  status?.providers.objectStorage.checkedAt,
                )}
                warning={
                  status?.freshness.state !== "current" ||
                  status?.providers.objectStorage.state !== "healthy"
                }
              />
              <EvidenceCard
                label="Backend image"
                value={shortDigest(status?.release.backendImageDigest)}
                detail={
                  status?.release.backendImageDigest ??
                  "Effective digest unknown"
                }
                warning={!status?.release.backendImageDigest}
              />
            </section>

            <section
              className="rounded-lg border bg-background-secondary p-4"
              aria-labelledby="provider-title"
            >
              <h4 id="provider-title" className="font-semibold">
                Persistence providers
              </h4>
              <p className="mt-1 text-sm text-content-secondary">
                Configure provider modes and named server-side references. Raw
                passwords, access keys, unrestricted endpoint URLs, buckets,
                DNS, and proxy configuration are never returned to the browser.
              </p>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <OperatorField
                  label="Database provider"
                  description="PostgreSQL is the reviewed persistence provider for this deployment profile."
                >
                  <select
                    className={operatorInputClasses}
                    value={form.database.kind}
                    disabled
                  >
                    <option value="postgres">PostgreSQL</option>
                  </select>
                </OperatorField>
                <OperatorField
                  label="Database credential reference"
                  description="Named secret reference on the operator host; not the credential itself."
                >
                  <input
                    className={operatorInputClasses}
                    value={form.database.credentialRef ?? ""}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        database: {
                          ...form.database,
                          credentialRef: nullIfEmpty(event.target.value),
                        },
                      })
                    }
                    autoComplete="off"
                  />
                </OperatorField>
                <OperatorField
                  label="Object-storage provider"
                  description="Select the compatible API behavior used by storage and snapshots."
                >
                  <select
                    className={operatorInputClasses}
                    value={form.objectStorage.kind}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        objectStorage: {
                          ...form.objectStorage,
                          kind: event.target.value,
                        },
                      })
                    }
                  >
                    <option value="cloudflare-r2">Cloudflare R2</option>
                    <option value="aws-s3">AWS S3</option>
                    <option value="s3-compatible">S3-compatible</option>
                  </select>
                </OperatorField>
                <OperatorField
                  label="Endpoint alias"
                  description="Reviewed host-side endpoint alias, not an unrestricted browser-supplied URL."
                >
                  <input
                    className={operatorInputClasses}
                    value={form.objectStorage.endpointAlias ?? ""}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        objectStorage: {
                          ...form.objectStorage,
                          endpointAlias: nullIfEmpty(event.target.value),
                        },
                      })
                    }
                    autoComplete="off"
                  />
                </OperatorField>
                <OperatorField
                  label="Object-storage credential reference"
                  description="Named secret reference; access and secret keys are write-only outside this API."
                >
                  <input
                    className={operatorInputClasses}
                    value={form.objectStorage.credentialRef ?? ""}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        objectStorage: {
                          ...form.objectStorage,
                          credentialRef: nullIfEmpty(event.target.value),
                        },
                      })
                    }
                    autoComplete="off"
                  />
                </OperatorField>
                <div />
                <NullableNumberField
                  label="Fixed multipart part size"
                  description="Bytes per non-final part for strict providers such as R2."
                  value={form.objectStorage.fixedMultipartPartSizeBytes}
                  onChange={(fixedMultipartPartSizeBytes) =>
                    setForm({
                      ...form,
                      objectStorage: {
                        ...form.objectStorage,
                        fixedMultipartPartSizeBytes,
                      },
                    })
                  }
                />
                <NullableNumberField
                  label="Maximum multipart object size"
                  description="Reject objects that would exceed the provider's 10,000-part limit."
                  value={form.objectStorage.maxMultipartObjectSizeBytes}
                  onChange={(maxMultipartObjectSizeBytes) =>
                    setForm({
                      ...form,
                      objectStorage: {
                        ...form.objectStorage,
                        maxMultipartObjectSizeBytes,
                      },
                    })
                  }
                />
              </div>

              {status?.providers.objectStorage
                .effectiveMultipartPartSizeBytes && (
                <p className="mt-3 text-sm text-content-secondary">
                  Effective probe:{" "}
                  {formatBytes(
                    status.providers.objectStorage
                      .effectiveMultipartPartSizeBytes,
                  )}{" "}
                  parts; maximum{" "}
                  {status.providers.objectStorage.maximumObjectSizeBytes
                    ? formatBytes(
                        status.providers.objectStorage.maximumObjectSizeBytes,
                      )
                    : "unknown"}
                  .
                </p>
              )}

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
                  <div className="font-medium">Review provider revision</div>
                  <p className="mt-1">
                    Target <code>{configuration.instance.id}</code>, base
                    revision {configuration.revision}. Saving changes does not
                    restart the backend or create external resources.
                  </p>
                  <pre className="mt-3 scrollbar overflow-auto rounded-sm bg-background-tertiary p-3 text-xs">
                    {JSON.stringify(form, null, 2)}
                  </pre>
                  <div className="mt-3 flex gap-2">
                    <Button onClick={() => void save()} loading={saving}>
                      Apply reviewed providers
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
                  Review provider change
                </Button>
                <Button
                  variant="neutral"
                  disabled={!changed}
                  onClick={() => {
                    setForm(configuration.providers);
                    setReviewing(false);
                  }}
                >
                  Reset
                </Button>
              </div>
            </section>

            <section
              className="rounded-lg border bg-background-secondary p-4"
              aria-labelledby="safety-preferences-title"
            >
              <h4 id="safety-preferences-title" className="font-semibold">
                Deployment safety preferences
              </h4>
              <p className="mt-1 max-w-prose text-sm text-content-secondary">
                These are deployment-local controls from the Cloud General
                page. The dedicated-instance preset enables both protections.
              </p>

              {safetyMessage && (
                <Callout variant="success">{safetyMessage}</Callout>
              )}

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div
                  className="flex items-start gap-3 rounded-md border bg-background-primary p-3 text-sm"
                >
                  <input
                    id="dashboard-edit-confirmation"
                    aria-labelledby="dashboard-edit-confirmation-label"
                    className="mt-0.5"
                    type="checkbox"
                    checked={safetyForm?.dashboardEditConfirmation ?? true}
                    onChange={(event) =>
                      setSafetyForm({
                        ...(safetyForm ?? {
                          dashboardEditConfirmation: true,
                          redactLogsToClient: true,
                        }),
                        dashboardEditConfirmation: event.target.checked,
                      })
                    }
                  />
                  <span>
                    <span
                      id="dashboard-edit-confirmation-label"
                      className="font-medium"
                    >
                      Require dashboard edit confirmation
                    </span>
                    <span className="mt-1 block text-content-secondary">
                      Require one explicit unlock per browser session before
                      editing data or invoking mutation-oriented dashboard
                      tools.
                    </span>
                  </span>
                </div>
                <div
                  className="flex items-start gap-3 rounded-md border bg-background-primary p-3 text-sm"
                >
                  <input
                    id="redact-logs-to-client"
                    aria-labelledby="redact-logs-to-client-label"
                    className="mt-0.5"
                    type="checkbox"
                    checked={safetyForm?.redactLogsToClient ?? true}
                    onChange={(event) =>
                      setSafetyForm({
                        ...(safetyForm ?? {
                          dashboardEditConfirmation: true,
                          redactLogsToClient: true,
                        }),
                        redactLogsToClient: event.target.checked,
                      })
                    }
                  />
                  <span>
                    <span
                      id="redact-logs-to-client-label"
                      className="font-medium"
                    >
                      Redact backend logs sent to clients
                    </span>
                    <span className="mt-1 block text-content-secondary">
                      Prevent server-side function logs and stack traces from
                      being forwarded to application clients.
                    </span>
                  </span>
                </div>
              </div>

              {safetyForm &&
                (!safetyForm.dashboardEditConfirmation ||
                  !safetyForm.redactLogsToClient) && (
                  <Callout variant="error">
                    One or more dedicated-instance protections are disabled.
                    This may expose sensitive logs or permit accidental edits.
                  </Callout>
                )}

              <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-content-secondary">Source</dt>
                <dd>Operator configuration revision {configuration.revision}</dd>
                <dt className="text-content-secondary">
                  Edit confirmation effective
                </dt>
                <dd>
                  {selfHostedSettings.dashboardEditConfirmation
                    ? "Required"
                    : "Not required"}
                </dd>
                <dt className="text-content-secondary">
                  Client-log redaction effective
                </dt>
                <dd>
                  {status?.runtime.effectiveKnobs?.REDACT_LOGS_TO_CLIENT === true
                    ? "Enabled"
                    : status?.runtime.effectiveKnobs
                          ?.REDACT_LOGS_TO_CLIENT === false
                      ? "Disabled"
                      : "Unknown"}
                </dd>
              </dl>

              {safetyRollback && (
                <div className="mt-4 rounded-md border bg-background-primary p-3 text-sm">
                  Rollback values: edit confirmation {safetyRollback.dashboardEditConfirmation ? "enabled" : "disabled"}; client-log redaction {safetyRollback.redactLogsToClient ? "enabled" : "disabled"}.
                </div>
              )}

              {safetyReviewing && safetyChanged && safetyForm && (
                <div className="mt-4 rounded-md border bg-background-primary p-3 text-sm">
                  <div className="font-medium">Review safety revision</div>
                  <p className="mt-1">
                    Target <code>{configuration.instance.id}</code>, base
                    revision {configuration.revision}. Edit confirmation takes
                    effect immediately; redaction requires a separately
                    confirmed backend restart.
                  </p>
                  <pre className="mt-3 scrollbar overflow-auto rounded-sm bg-background-tertiary p-3 text-xs">
                    {JSON.stringify(safetyForm, null, 2)}
                  </pre>
                  <div className="mt-3 flex gap-2">
                    <Button
                      onClick={() => void saveSafety()}
                      loading={safetySaving}
                    >
                      Apply safety preferences
                    </Button>
                    <Button
                      variant="neutral"
                      onClick={() => setSafetyReviewing(false)}
                      disabled={safetySaving}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              <div className="mt-4 flex gap-2">
                <Button
                  disabled={!safetyChanged}
                  onClick={() => setSafetyReviewing(true)}
                >
                  Review safety change
                </Button>
                <Button
                  variant="neutral"
                  disabled={!safetyChanged}
                  onClick={() => {
                    setSafetyForm(originalSafety);
                    setSafetyReviewing(false);
                  }}
                >
                  Reset
                </Button>
              </div>
            </section>

            <section ref={pauseDeploymentRef} id="pause-deployment">
              <PauseDeployment />
            </section>
          </>
        )}
      </div>
    </DeploymentSettingsLayout>
  );
}

function safetyFromConfiguration(
  configuration: OperatorConfiguration,
): SafetyForm {
  return {
    dashboardEditConfirmation:
      configuration.security.dashboardEditConfirmation ?? true,
    redactLogsToClient:
      configuration.runtime.knobs.REDACT_LOGS_TO_CLIENT === true,
  };
}

function NullableNumberField({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <OperatorField label={label} description={description}>
      <input
        className={operatorInputClasses}
        type="number"
        min={1}
        value={value ?? ""}
        onChange={(event) =>
          onChange(
            event.target.value === "" ? null : Number(event.target.value),
          )
        }
      />
    </OperatorField>
  );
}

function validateProviders(form: ProvidersForm | null) {
  if (!form) return [];
  const issues: string[] = [];
  if (form.database.kind !== "postgres")
    issues.push("Only PostgreSQL is supported by this profile.");
  if (
    !["aws-s3", "cloudflare-r2", "s3-compatible"].includes(
      form.objectStorage.kind,
    )
  )
    issues.push("Object-storage provider is unsupported.");
  const part = form.objectStorage.fixedMultipartPartSizeBytes;
  const maximum = form.objectStorage.maxMultipartObjectSizeBytes;
  if (
    [part, maximum].some(
      (value) => value !== null && (!Number.isSafeInteger(value) || value <= 0),
    )
  )
    issues.push("Multipart values must be positive whole byte counts.");
  if (part !== null && maximum !== null && Math.ceil(maximum / part) > 10_000)
    issues.push(
      "Multipart configuration would require more than 10,000 parts.",
    );
  return issues;
}

function providerDetail(
  state: string | undefined,
  checkedAt: string | undefined,
) {
  return state
    ? `${state} · checked ${formatOperatorDate(checkedAt)}`
    : "Connectivity evidence unavailable";
}

function hostLabel(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return "Invalid URL";
  }
}

function formatBytes(value: number) {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GiB`;
  return `${(value / 1024 ** 2).toFixed(1)} MiB`;
}

function shortDigest(value: string | null | undefined) {
  return value ? `${value.slice(0, 15)}…${value.slice(-8)}` : "Unknown";
}

function nullIfEmpty(value: string) {
  return value.trim() === "" ? null : value.trim();
}
