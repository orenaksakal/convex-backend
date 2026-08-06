import { Button } from "@ui/Button";
import { Callout } from "@ui/Callout";
import { OperatorApiError } from "../../lib/operatorApi";

export const operatorInputClasses =
  "min-h-9 w-full rounded-md border bg-background-primary px-3 text-content-primary";

export function OperatorLoading({ detail }: { detail: string }) {
  return (
    <div className="rounded-lg border bg-background-secondary p-4">
      <div className="font-medium">Loading operator state</div>
      <div className="text-sm text-content-secondary">{detail}</div>
    </div>
  );
}

export function OperatorError({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => Promise<void>;
}) {
  return (
    <Callout variant="error">
      <div className="flex flex-col gap-2">
        <div>
          <div className="font-medium">Operator controls are unavailable.</div>
          <div>{error.message}</div>
        </div>
        {error instanceof OperatorApiError && error.issues.length > 0 && (
          <ul className="list-disc pl-5">
            {error.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
        <Button variant="neutral" size="xs" onClick={() => void onRetry()}>
          Retry
        </Button>
      </div>
    </Callout>
  );
}

export function EvidenceCard({
  label,
  value,
  detail,
  warning = false,
}: {
  label: string;
  value: string;
  detail: string;
  warning?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-background-secondary p-4">
      <div className="text-xs font-medium tracking-wide text-content-secondary uppercase">
        {label}
      </div>
      <div
        className={
          warning
            ? "mt-1 font-semibold text-content-warning"
            : "mt-1 font-semibold"
        }
      >
        {value}
      </div>
      <div className="mt-1 text-xs text-content-secondary">{detail}</div>
    </div>
  );
}

export function OperatorField({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      <span className="text-xs text-content-secondary">{description}</span>
    </label>
  );
}

export function formatOperatorDate(value: string | null | undefined) {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleString()
    : "Unknown";
}
