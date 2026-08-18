import type {
  AlertDestinations,
  OperatorConfiguration,
  OperatorStatus,
} from "../../lib/operatorApi";
import { signalForState } from "./HealthSignal";
import {
  alertPolicyPresentation,
  backupSchedulePresentation,
  exposureProbePresentation,
} from "./TruthfulEvidence";

describe("truthful operator evidence", () => {
  test("maps missing and explicit unknown states to the neutral level", () => {
    for (const state of [
      null,
      undefined,
      "",
      " ",
      "unknown",
      "missing",
      "not reported",
      "evidence unavailable",
    ]) {
      expect(signalForState(state)).toBe("unknown");
    }
    expect(signalForState("unavailable")).toBe("critical");
    expect(signalForState("unreviewed-new-state")).toBe("critical");
  });

  test("reports the configured alert policy without assuming delivery", () => {
    expect(
      alertPolicyPresentation({ enabled: false, destinationAlias: null }, null),
    ).toMatchObject({
      level: "unknown",
      label: "Alert policy is off",
    });
    expect(
      alertPolicyPresentation(
        { enabled: true, destinationAlias: "email-telegram" },
        null,
      ),
    ).toMatchObject({
      level: "attention",
      label: "Alert policy is on; delivery setup is incomplete",
    });
    expect(
      alertPolicyPresentation(
        { enabled: true, destinationAlias: "email-telegram" },
        configuredDestinations(),
      ),
    ).toEqual({
      level: "healthy",
      label: "Alert policy is on",
      detail:
        "Telegram sends sustained incidents immediately. Email groups routine transitions into daily and weekly fleet digests.",
    });
    expect(
      alertPolicyPresentation(
        { enabled: true, destinationAlias: "email-telegram" },
        {
          ...configuredDestinations(),
          email: { enabled: false, passwordConfigured: false },
        },
      ),
    ).toMatchObject({
      level: "attention",
      label: "Email digests are unavailable",
    });
  });

  test("separates a saved backup schedule from runtime confirmation", () => {
    expect(
      backupSchedulePresentation(backupPolicy({ enabled: false }), null),
    ).toMatchObject({
      level: "unknown",
      label: "Automatic backups are off",
    });
    expect(
      backupSchedulePresentation(
        backupPolicy({ enabled: true, schedule: null }),
        currentStatus("idle"),
      ),
    ).toMatchObject({
      level: "attention",
      label: "No automatic backup schedule is configured",
    });
    expect(
      backupSchedulePresentation(backupPolicy({ enabled: true }), null),
    ).toMatchObject({
      level: "unknown",
      label: "Daily schedule configured",
    });
    expect(
      backupSchedulePresentation(
        backupPolicy({ enabled: true }),
        currentStatus("idle"),
      ),
    ).toEqual({
      level: "healthy",
      label: "Daily schedule configured",
      detail: "Current runtime evidence reports the scheduler as idle.",
    });
    expect(
      backupSchedulePresentation(
        backupPolicy({ enabled: true }),
        currentStatus("failed", "archive upload failed"),
      ),
    ).toMatchObject({
      level: "critical",
      detail:
        "Current runtime evidence reports a scheduler failure: archive upload failed",
    });
  });

  test("reports public, private, and unknown exposure without false reassurance", () => {
    expect(
      exposureProbePresentation(true, false, "Administrative endpoints"),
    ).toMatchObject({ level: "critical", label: "Confirmed public" });
    expect(
      exposureProbePresentation(false, true, "Administrative endpoints"),
    ).toMatchObject({ level: "healthy", label: "Confirmed private" });
    expect(
      exposureProbePresentation(false, false, "Administrative endpoints"),
    ).toMatchObject({ level: "unknown", label: "Unknown" });
    expect(
      exposureProbePresentation(null, true, "Administrative endpoints"),
    ).toMatchObject({ level: "unknown", label: "Unknown" });
  });
});

function configuredDestinations(): AlertDestinations {
  return {
    schemaVersion: 1,
    instanceId: "app-one",
    configured: true,
    email: { enabled: true, passwordConfigured: true },
    telegram: { enabled: true, shoutrrUrlConfigured: true },
  };
}

function backupPolicy(
  changes: Partial<OperatorConfiguration["backup"]>,
): OperatorConfiguration["backup"] {
  return {
    enabled: true,
    schedule: "0 2 * * *",
    destinationAlias: "fleet-r2",
    retentionDays: 30,
    rpoHours: 24,
    rtoHours: 4,
    ...changes,
  };
}

function currentStatus(
  state: NonNullable<OperatorStatus["backups"]["scheduler"]>["state"],
  lastError: string | null = null,
): OperatorStatus {
  return {
    freshness: { state: "current" },
    backups: { scheduler: { state, lastError } },
  } as OperatorStatus;
}
