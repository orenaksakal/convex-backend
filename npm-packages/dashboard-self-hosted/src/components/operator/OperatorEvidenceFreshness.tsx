import { ReloadIcon } from "@radix-ui/react-icons";
import { Button } from "@ui/Button";
import { useEffect, useState } from "react";
import { useOperatorState } from "./useOperatorState";

export function OperatorEvidenceFreshness() {
  const operator = useOperatorState();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  const label = operator.lastUpdatedAt
    ? `Status updated ${relativeAge(now - operator.lastUpdatedAt)}`
    : operator.loading
      ? "Loading evidence"
      : "Evidence unavailable";
  const detail = operator.error ? `Refresh failed. ${label}.` : label;

  return (
    <Button
      size="xs"
      variant="neutral"
      className="shrink-0"
      icon={
        <ReloadIcon className={operator.refreshing ? "animate-spin" : ""} />
      }
      onClick={() => void operator.refresh()}
      loading={operator.refreshing}
      aria-label={`${detail} Refresh operator status`}
    >
      <span className="hidden lg:inline">{detail}</span>
      <span className="lg:hidden">Refresh</span>
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
