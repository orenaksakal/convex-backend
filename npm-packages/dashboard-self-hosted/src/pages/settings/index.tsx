import { useContext, useEffect, useRef, useState } from "react";
import { DeploymentSettingsLayout } from "@common/layouts/DeploymentSettingsLayout";
import { PauseDeployment } from "@common/features/settings/components/PauseDeployment";
import { useScrollToHash } from "@common/lib/useScrollToHash";
import { Button } from "@ui/Button";
import { Callout } from "@ui/Callout";
import {
  EvidenceCard,
  formatOperatorDate,
  OperatorError,
  OperatorLoading,
} from "../../components/operator/OperatorPagePrimitives";
import { useOperatorState } from "../../components/operator/useOperatorState";
import { EffectiveHealthSummary } from "../../components/operator/EffectiveHealthSummary";
import { OperatorConfiguration } from "../../lib/operatorApi";
import { SelfHostedSettingsContext } from "../../lib/selfHostedSettings";

type SafetyForm = {
  dashboardEditConfirmation: boolean;
  redactLogsToClient: boolean;
};

export default function Settings() {
  const pauseDeploymentRef = useRef<HTMLDivElement | null>(null);
  useScrollToHash("#pause-deployment", pauseDeploymentRef);
  const operator = useOperatorState();
  const selfHostedSettings = useContext(SelfHostedSettingsContext);
  const [safetyForm, setSafetyForm] = useState<SafetyForm | null>(null);
  const [safetyReviewing, setSafetyReviewing] = useState(false);
  const [safetySaving, setSafetySaving] = useState(false);
  const [safetyMessage, setSafetyMessage] = useState<string | null>(null);
  const [safetyRollback, setSafetyRollback] = useState<SafetyForm | null>(null);

  useEffect(() => {
    if (!operator.configuration) return;
    setSafetyForm(safetyFromConfiguration(operator.configuration));
  }, [operator.configuration]);
  const originalSafety = operator.configuration
    ? safetyFromConfiguration(operator.configuration)
    : null;
  const safetyChanged =
    safetyForm !== null &&
    originalSafety !== null &&
    JSON.stringify(safetyForm) !== JSON.stringify(originalSafety);

  async function saveSafety() {
    if (!safetyForm) return;
    setSafetySaving(true);
    setSafetyMessage(null);
    try {
      const result = await operator.patch({
        security: {
          dashboardEditConfirmation: safetyForm.dashboardEditConfirmation,
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
            evidence. Docker placement, domains, Transport Layer Security (TLS),
            and host routing remain in deployment manifests and are
            intentionally not editable here.
          </p>
        </header>

        {operator.loading && (
          <OperatorLoading detail="Waiting for deployment configuration and effective-state evidence." />
        )}
        {operator.error && (
          <OperatorError error={operator.error} onRetry={operator.refresh} />
        )}

        {configuration && !operator.loading && (
          <>
            <section
              className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4"
              aria-label="Deployment summary"
            >
              <EvidenceCard
                label="Instance"
                value={configuration.instance.displayName}
                detail={hostLabel(configuration.instance.deploymentUrl)}
              />
              <EvidenceCard
                label="Serving"
                value={status?.health.state ?? "Unavailable"}
                detail={
                  status
                    ? `${
                        status.health.state === "healthy"
                          ? "Serving path is working"
                          : "Review serving-path health below"
                      } · ${status.freshness.state} evidence`
                    : "No validated status provider"
                }
                warning={
                  !status ||
                  status.freshness.state !== "current" ||
                  status.health.state !== "healthy"
                }
              />
              <EvidenceCard
                label="Recovery"
                value={
                  status?.backups.lastSuccessful?.verified
                    ? "Protected"
                    : configuration.backup.enabled
                      ? "Needs backup"
                      : "Not enabled"
                }
                detail={
                  status?.backups.lastSuccessful
                    ? `Last verified ${formatOperatorDate(status.backups.lastSuccessful.completedAt)}`
                    : "No verified recovery point"
                }
                warning={
                  configuration.backup.enabled &&
                  !status?.backups.lastSuccessful?.verified
                }
              />
              <EvidenceCard
                label="Alerts"
                value={status?.alerts.state ?? "Unknown"}
                detail={
                  status?.alerts.state === "firing"
                    ? `${status.alerts.reasons?.length ?? 0} active reasons`
                    : status?.alerts.lastDeliveryAt
                      ? `Last delivered ${formatOperatorDate(status.alerts.lastDeliveryAt)}`
                      : "No active production incident"
                }
                warning={
                  status?.alerts.state === "firing" ||
                  status?.alerts.state === "delivery_failed"
                }
              />
            </section>

            <EffectiveHealthSummary
              configuration={configuration}
              status={status}
            />

            <section
              className="rounded-lg border bg-background-secondary p-4"
              aria-labelledby="provider-title"
            >
              <h4 id="provider-title" className="font-semibold">
                Managed persistence
              </h4>
              <p className="mt-1 text-sm text-content-secondary">
                Every deployment uses an isolated PostgreSQL database and
                private Cloudflare R2 storage. The fleet provisioner creates,
                scopes, verifies, and rotates these resources automatically.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <ManagedProvider
                  name="PostgreSQL"
                  detail="One database and role scoped to this deployment"
                  state={status?.providers.database.state ?? "unknown"}
                />
                <ManagedProvider
                  name="Cloudflare R2"
                  detail="Private file, module, export, and backup storage"
                  state={status?.providers.objectStorage.state ?? "unknown"}
                />
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
                These are deployment-local controls from the Cloud General page.
                The dedicated-instance preset enables both protections.
              </p>

              {safetyMessage && (
                <Callout variant="success">{safetyMessage}</Callout>
              )}

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="flex items-start gap-3 rounded-md border bg-background-primary p-3 text-sm">
                  <input
                    id="dashboard-edit-confirmation"
                    aria-labelledby="dashboard-edit-confirmation-label"
                    className="mt-0.5"
                    type="checkbox"
                    checked={safetyForm?.dashboardEditConfirmation ?? true}
                    onChange={event =>
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
                <div className="flex items-start gap-3 rounded-md border bg-background-primary p-3 text-sm">
                  <input
                    id="redact-logs-to-client"
                    aria-labelledby="redact-logs-to-client-label"
                    className="mt-0.5"
                    type="checkbox"
                    checked={safetyForm?.redactLogsToClient ?? true}
                    onChange={event =>
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
                <dd>
                  Operator configuration revision {configuration.revision}
                </dd>
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
                  {status?.runtime.effectiveKnobs?.REDACT_LOGS_TO_CLIENT ===
                  true
                    ? "Enabled"
                    : status?.runtime.effectiveKnobs?.REDACT_LOGS_TO_CLIENT ===
                        false
                      ? "Disabled"
                      : "Not observed"}
                </dd>
              </dl>

              {safetyRollback && (
                <div className="mt-4 rounded-md border bg-background-primary p-3 text-sm">
                  Rollback values: edit confirmation{" "}
                  {safetyRollback.dashboardEditConfirmation
                    ? "enabled"
                    : "disabled"}
                  ; client-log redaction{" "}
                  {safetyRollback.redactLogsToClient ? "enabled" : "disabled"}.
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

function ManagedProvider({
  name,
  detail,
  state,
}: {
  name: string;
  detail: string;
  state: string;
}) {
  const healthy = state === "healthy";
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border bg-background-primary p-3">
      <div>
        <div className="font-medium">{name}</div>
        <div className="mt-1 text-sm text-content-secondary">{detail}</div>
      </div>
      <span
        className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium capitalize ${
          healthy
            ? "bg-background-success text-content-success"
            : "bg-background-warning text-content-warning"
        }`}
      >
        {state}
      </span>
    </div>
  );
}

function hostLabel(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return "Invalid URL";
  }
}
