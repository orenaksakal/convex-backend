import { cn } from "@ui/cn";
import { OperatorConfiguration, OperatorStatus } from "../../lib/operatorApi";
import { HealthSignal, SignalLevel, signalForState } from "./HealthSignal";
import { formatOperatorDate } from "./OperatorPagePrimitives";

type HealthFinding = {
  level: Exclude<SignalLevel, "healthy" | "unknown">;
  affectsHealth: boolean;
  title: string;
  impact: string;
  action: string;
};

export function EffectiveHealthSummary({
  configuration,
  status,
}: {
  configuration: OperatorConfiguration;
  status: OperatorStatus | null;
}) {
  const findings = effectiveHealthFindings(configuration, status);
  const level = signalForState(status?.health.state);
  const state = status?.health.state ?? "unknown";
  const healthHeadline =
    state === "healthy"
      ? "The instance serving path is healthy"
      : state === "degraded"
      ? "The instance serving path is degraded"
      : state === "unavailable"
      ? "The instance serving path is unavailable"
      : "Instance health is unknown";
  const actionCount = findings.length;

  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border bg-background-secondary",
        level === "critical"
          ? "border-content-error"
          : level === "attention"
          ? "border-content-warning"
          : level === "healthy"
          ? "border-content-success"
          : "border-border-transparent"
      )}
      aria-labelledby="effective-health-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 p-4 sm:p-5">
        <div className="max-w-2xl">
          <div className="flex flex-wrap items-center gap-2">
            <h4 id="effective-health-title" className="font-semibold">
              Instance health
            </h4>
            <HealthSignal level={level} label={state} compact />
          </div>
          <p className="mt-1 text-sm font-medium">{healthHeadline}</p>
          <p className="mt-1 text-sm text-content-secondary">
            Production checks focus on serving, persistence, verified backups,
            private admin access, and alert delivery. Routine tuning and
            unproven optional checks stay out of the warning list.
          </p>
          {actionCount > 0 ? (
            <p className="mt-2 text-xs text-content-secondary">
              {actionCount} production {actionCount === 1 ? "item" : "items"}{" "}
              need attention.
            </p>
          ) : null}
        </div>
        <div className="rounded-lg border bg-background-primary px-3 py-2 text-right text-xs text-content-secondary">
          <div className="font-medium text-content-primary">
            {status?.freshness.state === "current"
              ? "Evidence is current"
              : "Evidence needs refreshing"}
          </div>
          <div>{formatOperatorDate(status?.generatedAt)}</div>
        </div>
      </div>

      {findings.length > 0 ? (
        <ol className="divide-y border-t bg-background-primary/40">
          {findings.map((finding, index) => (
            <li
              key={`${finding.title}-${index}`}
              className="grid gap-3 p-4 sm:grid-cols-[auto_1fr] sm:px-5"
            >
              <div
                className={cn(
                  "grid size-7 place-items-center rounded-full text-xs font-semibold",
                  finding.level === "critical"
                    ? "bg-background-error text-content-error"
                    : "bg-background-warning text-content-warning"
                )}
                aria-hidden="true"
              >
                {index + 1}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{finding.title}</span>
                  <HealthSignal
                    level={finding.level}
                    label={
                      finding.affectsHealth
                        ? "Health degradation"
                        : finding.level === "critical"
                        ? "Operational warning"
                        : "Recommendation"
                    }
                    compact
                  />
                </div>
                <p className="mt-1 text-sm text-content-secondary">
                  {finding.impact}
                </p>
                <p className="mt-1 text-sm">
                  <span className="font-medium">Next action:</span>{" "}
                  {finding.action}
                </p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="border-t bg-background-success px-4 py-3 text-sm text-content-success sm:px-5">
          No production-critical action is needed.
        </div>
      )}
    </section>
  );
}

export function effectiveHealthFindings(
  configuration: OperatorConfiguration,
  status: OperatorStatus | null
): HealthFinding[] {
  if (!status) {
    return [
      {
        level: "critical",
        affectsHealth: true,
        title: "No validated health report",
        impact: "The dashboard cannot prove whether this instance is healthy.",
        action:
          "Refresh once. If this remains, inspect the instance status timer and operator logs.",
      },
    ];
  }

  const findings: HealthFinding[] = [];
  if (
    status.freshness.state !== "current" &&
    status.freshness.ageSeconds > status.freshness.maxAgeSeconds * 2
  ) {
    findings.push({
      level: "attention",
      affectsHealth: false,
      title: "Health evidence is stale",
      impact: `The last report is ${status.freshness.ageSeconds}s old; the accepted maximum is ${status.freshness.maxAgeSeconds}s.`,
      action:
        "Refresh once. If the timestamp does not advance, inspect the instance status timer.",
    });
  }
  if (status.runtime.effectiveRevision === null) {
    findings.push({
      level: "critical",
      affectsHealth: true,
      title: "Runtime state is not verified",
      impact:
        "The operator has no active runtime revision to compare with configuration.",
      action: "Open Runtime and verify or restart the deployment.",
    });
  }

  providerFinding(findings, "PostgreSQL", status.providers.database.state);
  providerFinding(
    findings,
    "Object storage",
    status.providers.objectStorage.state
  );

  const scheduler = status.backups.scheduler;
  if (configuration.backup.enabled && scheduler?.state === "failed") {
    findings.push({
      level: "critical",
      affectsHealth: false,
      title: "Scheduled backups are failing",
      impact:
        scheduler.lastError ??
        "The last scheduler evaluation did not complete successfully.",
      action:
        "Open Backups, resolve the reported failure, then run a manual backup.",
    });
  } else if (
    configuration.backup.enabled &&
    !status.backups.lastSuccessful?.verified
  ) {
    findings.push({
      level: "attention",
      affectsHealth: false,
      title: "No verified backup is recorded",
      impact: "Recovery cannot yet be proven for this deployment.",
      action:
        "Open Backups and run a manual backup, then confirm it is verified.",
    });
  }
  if (status.backups.restoreDrill.state === "failed") {
    findings.push({
      level: "critical",
      affectsHealth: false,
      title: "The restore drill failed",
      impact: "A backup exists, but the tested recovery path did not complete.",
      action:
        "Open Backups, inspect the failed drill, and retry into a new instance.",
    });
  }
  if (status.release.state === "failed") {
    findings.push({
      level: "critical",
      affectsHealth: false,
      title: "Release verification failed",
      impact: "The active backend release could not be verified.",
      action:
        "Open Release, inspect the failed action, then retry or roll back.",
    });
  }

  exposureFindings(findings, status);

  const overdue = status.security.credentials.filter(
    (credential) => credential.state === "overdue"
  );
  if (overdue.length > 0) {
    findings.push({
      level: "critical",
      affectsHealth: false,
      title: `${overdue.length} credential ${
        overdue.length === 1 ? "is" : "are"
      } overdue`,
      impact: "Credential rotation is outside the configured safety window.",
      action: "Open Security and rotate the listed credentials.",
    });
  }

  if (status.alerts.state === "firing") {
    findings.push({
      level: "critical",
      affectsHealth: false,
      title: "An operational alert is firing",
      impact:
        status.alerts.reasons?.join(", ") ||
        "A configured alert threshold was crossed.",
      action:
        "Open Alerts and investigate the active reason before acknowledging it.",
    });
  } else if (status.alerts.state === "delivery_failed") {
    findings.push({
      level: "critical",
      affectsHealth: false,
      title: "Alert delivery failed",
      impact:
        status.alerts.lastError ??
        "Operators may not receive incident notifications.",
      action:
        "Open Alerts, repair the destination, and send a test notification.",
    });
  }

  if (findings.length === 0 && status.health.state !== "healthy") {
    findings.push({
      level: status.health.state === "unavailable" ? "critical" : "attention",
      affectsHealth: true,
      title: "A health check needs review",
      impact:
        "The aggregate state is not healthy, but no browser-safe detail identified the contributor.",
      action:
        "Refresh once, then inspect the operator status journal if the state remains.",
    });
  }
  return findings;
}

function providerFinding(
  findings: HealthFinding[],
  label: string,
  state: OperatorStatus["providers"]["database"]["state"]
) {
  if (state === "healthy") return;
  findings.push({
    level:
      state === "unavailable" || state === "unknown" ? "critical" : "attention",
    affectsHealth: true,
    title: `${label} is ${state === "unknown" ? "not verified" : state}`,
    impact: `${label} cannot currently be counted as healthy.`,
    action: `Open General → Persistence providers and verify the ${label.toLowerCase()} connection and credentials.`,
  });
}

function exposureFindings(findings: HealthFinding[], status: OperatorStatus) {
  const { publicAdminReachable, metricsPubliclyReachable } = status.security;
  if (publicAdminReachable === true || metricsPubliclyReachable === true) {
    const exposed = [
      publicAdminReachable === true ? "admin endpoints" : null,
      metricsPubliclyReachable === true ? "metrics" : null,
    ].filter(Boolean);
    findings.push({
      level: "critical",
      affectsHealth: false,
      title: `${exposed.join(" and ")} publicly reachable`,
      impact:
        "Private operational surfaces are exposed outside the Tailscale boundary.",
      action:
        "Open Security, remove public access, then rerun the off-host exposure check.",
    });
  }
}
