import type {
  AlertDestinations,
  OperatorConfiguration,
  OperatorStatus,
} from "../../lib/operatorApi";
import type { SignalLevel } from "./HealthSignal";

export type EvidencePresentation = {
  level: SignalLevel;
  label: string;
  detail: string;
};

export function alertPolicyPresentation(
  policy: Pick<OperatorConfiguration["alerts"], "enabled" | "destinationAlias">,
  destinations: AlertDestinations | null,
): EvidencePresentation {
  if (!policy.enabled) {
    return {
      level: "unknown",
      label: "Alert policy is off",
      detail: "No alert evaluations or incident deliveries are expected.",
    };
  }
  if (!policy.destinationAlias) {
    return {
      level: "attention",
      label: "Alert policy is on; no destination is selected",
      detail:
        "Select and save a delivery destination before relying on alerts.",
    };
  }
  if (!destinations?.configured) {
    return {
      level: "attention",
      label: "Alert policy is on; delivery setup is incomplete",
      detail:
        "The selected destination does not have a complete email or Telegram configuration.",
    };
  }
  if (!destinations.telegram.enabled) {
    return {
      level: "attention",
      label: "Immediate Telegram alerts are unavailable",
      detail:
        "Email digests are configured, but critical incidents must fall back to immediate email until Telegram is enabled.",
    };
  }
  if (!destinations.email.enabled) {
    return {
      level: "attention",
      label: "Email digests are unavailable",
      detail:
        "Telegram alerts are configured, but daily and weekly email digests require an enabled email destination.",
    };
  }
  return {
    level: "healthy",
    label: "Alert policy is on",
    detail:
      "Telegram sends sustained incidents immediately. Email groups routine transitions into daily and weekly fleet digests.",
  };
}

export function backupSchedulePresentation(
  policy: OperatorConfiguration["backup"],
  status: OperatorStatus | null,
): EvidencePresentation {
  const scheduler = status?.backups.scheduler;
  if (!policy.enabled) {
    return {
      level: "unknown",
      label: "Automatic backups are off",
      detail: "The saved policy does not schedule backups.",
    };
  }
  if (!policy.schedule) {
    return {
      level: "attention",
      label: "No automatic backup schedule is configured",
      detail: "Automatic backups cannot run until a schedule is saved.",
    };
  }

  const label = `${scheduleLabel(policy.schedule)} schedule configured`;
  if (!status || status.freshness.state !== "current") {
    return {
      level: "unknown",
      label,
      detail:
        "The saved policy has a schedule, but current scheduler evidence is unavailable.",
    };
  }
  if (!scheduler || scheduler.state === "unknown") {
    return {
      level: "unknown",
      label,
      detail:
        "The saved policy has a schedule, but the runtime scheduler has not been confirmed.",
    };
  }
  if (scheduler.state === "disabled") {
    return {
      level: "attention",
      label,
      detail:
        "Current runtime evidence reports that the backup scheduler is disabled.",
    };
  }
  if (scheduler.state === "failed") {
    return {
      level: "critical",
      label,
      detail: scheduler.lastError
        ? `Current runtime evidence reports a scheduler failure: ${scheduler.lastError}`
        : "Current runtime evidence reports a scheduler failure.",
    };
  }
  return {
    level: "healthy",
    label,
    detail: `Current runtime evidence reports the scheduler as ${scheduler.state}.`,
  };
}

export function exposureProbePresentation(
  reachable: boolean | null | undefined,
  evidenceIsCurrent: boolean,
  subject: string,
): EvidencePresentation {
  if (reachable === true) {
    return {
      level: "critical",
      label: "Confirmed public",
      detail: `${subject} responded to the external exposure probe. Restrict public access, then run the probe again.`,
    };
  }
  if (reachable === false && evidenceIsCurrent) {
    return {
      level: "healthy",
      label: "Confirmed private",
      detail: `${subject} did not respond to the current external exposure probe.`,
    };
  }
  if (reachable === false) {
    return {
      level: "unknown",
      label: "Unknown",
      detail: `The last probe found ${subject.toLowerCase()} private, but that evidence is stale.`,
    };
  }
  return {
    level: "unknown",
    label: "Unknown",
    detail: `No validated external exposure result is available for ${subject.toLowerCase()}.`,
  };
}

function scheduleLabel(schedule: string) {
  switch (schedule) {
    case "0 * * * *":
      return "Hourly";
    case "0 */6 * * *":
      return "Six-hour";
    case "0 2 * * *":
      return "Daily";
    case "0 2 * * 0":
      return "Weekly";
    default:
      return "Custom";
  }
}
