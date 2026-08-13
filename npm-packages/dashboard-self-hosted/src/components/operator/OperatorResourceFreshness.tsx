import { ReloadIcon } from "@radix-ui/react-icons";
import { Button } from "@ui/Button";
import { useEffect, useState } from "react";

export function OperatorResourceFreshness({
  label,
  lastUpdatedAt,
  refreshing,
  error,
  onRefresh,
}: {
  label: string;
  lastUpdatedAt: number | null;
  refreshing: boolean;
  error: Error | null;
  onRefresh(): Promise<void>;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  const age = lastUpdatedAt
    ? `updated ${relativeAge(now - lastUpdatedAt)}`
    : "not yet loaded";
  const state = error
    ? lastUpdatedAt
      ? `Refresh failed · ${age}`
      : "Load failed"
    : age;
  const shortLabel = label.replace(/ evidence$/i, "");
  const text = `${shortLabel} · ${state}`;
  return (
    <Button
      size="xs"
      variant="neutral"
      className="shrink-0"
      icon={<ReloadIcon className={refreshing ? "animate-spin" : ""} />}
      loading={refreshing}
      onClick={() => void onRefresh()}
      aria-label={`${label} ${text}. Refresh now`}
    >
      {text}
    </Button>
  );
}

function relativeAge(ageMs: number) {
  const seconds = Math.max(0, Math.floor(ageMs / 1_000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}
