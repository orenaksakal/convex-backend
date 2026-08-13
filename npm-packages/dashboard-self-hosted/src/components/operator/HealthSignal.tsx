import { cn } from "@ui/cn";

export type SignalLevel = "healthy" | "attention" | "critical" | "unknown";

const signalStyles: Record<SignalLevel, string> = {
  healthy: "border-content-success bg-background-success text-content-success",
  attention:
    "border-content-warning bg-background-warning text-content-warning",
  critical: "border-content-error bg-background-error text-content-error",
  unknown:
    "border-border-transparent bg-background-tertiary text-content-secondary",
};

const dotStyles: Record<SignalLevel, string> = {
  healthy: "bg-util-success",
  attention: "bg-util-warning",
  critical: "bg-util-error",
  unknown: "bg-background-primary",
};

export function HealthSignal({
  level,
  label,
  compact = false,
  className,
}: {
  level: SignalLevel;
  label: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-full border font-medium",
        compact
          ? "gap-1.5 px-2 py-0.5 text-[11px]"
          : "gap-2 px-2.5 py-1 text-xs",
        signalStyles[level],
        className
      )}
    >
      <span
        className={cn("size-2 shrink-0 rounded-full", dotStyles[level])}
        aria-hidden="true"
      />
      <span className="min-w-0 wrap-break-word">{label}</span>
    </span>
  );
}

export function TrafficLightLegend({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-wrap gap-x-4 gap-y-2 text-xs text-content-secondary",
        className
      )}
    >
      <span>
        <HealthSignal level="healthy" label="Healthy" compact /> Serving path
        works
      </span>
      <span>
        <HealthSignal level="attention" label="Degraded" compact /> Serving path
        impaired
      </span>
      <span>
        <HealthSignal level="critical" label="Unavailable" compact /> Serving
        path down
      </span>
      <span>
        <HealthSignal level="unknown" label="Unknown" compact /> Evidence
        unavailable
      </span>
    </div>
  );
}

export function signalForState(value: string | null | undefined): SignalLevel {
  if (!value) return "unknown";
  const state = value.trim().toLowerCase();
  if (
    [
      "",
      "unknown",
      "missing",
      "not reported",
      "not observed",
      "evidence unavailable",
      "probe unavailable",
    ].includes(state)
  ) {
    return "unknown";
  }
  if (
    [
      "healthy",
      "current",
      "ready",
      "ok",
      "passed",
      "succeeded",
      "idle",
      "active",
      "effective",
    ].includes(state)
  ) {
    return "healthy";
  }
  if (
    [
      "failed",
      "critical",
      "unavailable",
      "unhealthy",
      "firing",
      "delivery_failed",
      "overdue",
    ].includes(state)
  ) {
    return "critical";
  }
  if (
    [
      "degraded",
      "warning",
      "stale",
      "due",
      "running",
      "pending restart",
      "never",
    ].includes(state)
  ) {
    return "attention";
  }
  // A state without a reviewed traffic-light mapping is unsafe to ignore.
  return "critical";
}
