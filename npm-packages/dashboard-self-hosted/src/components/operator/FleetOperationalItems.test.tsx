import { FleetDeployment, FleetDeploymentHealth } from "../../lib/fleetApi";
import { OperatorStatus } from "../../lib/operatorApi";
import {
  deploymentOperationalItems,
  fleetHealthSummary,
} from "../../pages/fleet";

function deployment(): FleetDeployment {
  return {
    id: "dep_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    state: "ready",
    desiredPolicy: {
      backupRequired: false,
      alertsEnabled: false,
    },
  } as FleetDeployment;
}

function healthyEvidence(): FleetDeploymentHealth {
  return {
    deploymentId: "dep_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    error: null,
    status: {
      freshness: { state: "current", ageSeconds: 5, maxAgeSeconds: 180 },
      backups: {
        scheduler: { state: "idle" },
        lastSuccessful: null,
        restoreDrill: { state: "passed" },
      },
      release: { state: "idle" },
      security: {
        publicAdminReachable: null,
        metricsPubliclyReachable: null,
        credentials: [
          {
            kind: "dashboard-signing",
            state: "due",
            lastRotatedAt: null,
            rotationDueAt: null,
          },
        ],
      },
      alerts: { state: "ok" },
    } as OperatorStatus,
  };
}

test("routine unverified exposure and first-rotation states do not require manual work", () => {
  expect(deploymentOperationalItems(deployment(), healthyEvidence())).toEqual(
    []
  );
});

test("an empty fleet is unknown rather than healthy", () => {
  expect(fleetHealthSummary([], {})).toMatchObject({
    overall: "unknown",
    overallLabel: "No deployments to check",
    healthy: 0,
  });
});

test("confirmed public exposure and overdue credentials remain actionable", () => {
  const evidence = healthyEvidence();
  evidence.status!.security.publicAdminReachable = true;
  evidence.status!.security.credentials[0].state = "overdue";

  expect(
    deploymentOperationalItems(deployment(), evidence).map((item) => item.title)
  ).toEqual([
    "Admin tools are open to the public internet",
    "Credential rotation policy is overdue",
  ]);
});
