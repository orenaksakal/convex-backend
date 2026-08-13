import { OperatorConfiguration, OperatorStatus } from "../../lib/operatorApi";
import { effectiveHealthFindings } from "./EffectiveHealthSummary";

function configuration(): OperatorConfiguration {
  return {
    backup: { enabled: true },
    revision: 3,
  } as OperatorConfiguration;
}

function healthyStatus(): OperatorStatus {
  return {
    freshness: { state: "current", ageSeconds: 20, maxAgeSeconds: 180 },
    health: { state: "healthy" },
    runtime: { effectiveRevision: 3, restartPending: false },
    providers: {
      database: { state: "healthy" },
      objectStorage: { state: "healthy" },
    },
    backups: {
      lastSuccessful: { verified: true },
      restoreDrill: { state: "never" },
      scheduler: { state: "idle" },
    },
    release: { state: "idle" },
    security: {
      publicAdminReachable: null,
      metricsPubliclyReachable: null,
      credentials: [{ state: "due" }],
    },
    alerts: { state: "ok" },
  } as OperatorStatus;
}

test("routine unknown evidence and due credentials do not become production warnings", () => {
  expect(effectiveHealthFindings(configuration(), healthyStatus())).toEqual([]);
});

test("production failures remain actionable", () => {
  const status = healthyStatus();
  status.backups.scheduler = {
    ...status.backups.scheduler!,
    state: "failed",
    lastError: "archive upload failed",
  };
  status.security.publicAdminReachable = true;
  status.alerts.state = "delivery_failed";
  status.alerts.lastError = "Telegram rejected delivery";

  expect(
    effectiveHealthFindings(configuration(), status).map(
      finding => finding.title,
    ),
  ).toEqual([
    "Scheduled backups are failing",
    "admin endpoints publicly reachable",
    "Alert delivery failed",
  ]);
});
