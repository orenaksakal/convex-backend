import { Button } from "@ui/Button";
import { Callout } from "@ui/Callout";
import { useId, useState } from "react";
import { OperatorApiError } from "../../lib/operatorApi";
import { HealthSignal, SignalLevel, signalForState } from "./HealthSignal";

export const operatorInputClasses =
  "min-h-9 w-full rounded-md border bg-background-primary px-3 text-content-primary";

export function OperatorLoading({ detail }: { detail: string }) {
  return (
    <div className="min-w-0 rounded-lg border bg-background-secondary p-4">
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
  signal,
}: {
  label: string;
  value: string;
  detail: string;
  warning?: boolean;
  signal?: SignalLevel;
}) {
  const inferred = signalForState(value);
  const level =
    signal ??
    (inferred === "unknown"
      ? "unknown"
      : warning
      ? inferred === "critical"
        ? "critical"
        : "attention"
      : undefined);
  return (
    <div className="rounded-lg border bg-background-secondary p-4">
      <div className="text-xs font-medium tracking-wide text-content-secondary uppercase">
        {label}
      </div>
      {level ? (
        <HealthSignal level={level} label={value} className="mt-2" />
      ) : (
        <div className="mt-1 font-semibold wrap-break-word">{value}</div>
      )}
      <div className="mt-1 text-xs wrap-break-word text-content-secondary">
        {detail}
      </div>
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

export type OperatorPreset<T extends string | number | null> = {
  label: string;
  value: T;
  description: string;
};

export function OperatorTextPresetField({
  label,
  description,
  value,
  presets,
  onChange,
  customLabel = "Custom value",
  placeholder,
  disabled = false,
}: {
  label: string;
  description: string;
  value: string | null;
  presets: OperatorPreset<string | null>[];
  onChange: (value: string | null) => void;
  customLabel?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [customSelected, setCustomSelected] = useState(false);
  const id = useId();
  const match = presets.find((preset) => preset.value === value);
  const isCustom = customSelected || !match;
  const selectedDescription = isCustom
    ? "Enter a value supported by the operator validation contract."
    : match.description;
  return (
    <OperatorField label={label} description={description}>
      <div className="overflow-hidden rounded-md border bg-background-primary focus-within:border-border-selected">
        <select
          id={`${id}-preset`}
          className="min-h-9 w-full border-0 bg-transparent px-3 text-content-primary focus:ring-0"
          value={isCustom ? "__custom__" : presetKey(match!.value)}
          disabled={disabled}
          onChange={(event) => {
            if (event.target.value === "__custom__") {
              setCustomSelected(true);
              return;
            }
            const preset = presets.find(
              (candidate) => presetKey(candidate.value) === event.target.value
            );
            if (preset) {
              setCustomSelected(false);
              onChange(preset.value);
            }
          }}
          aria-label={`${label} preset`}
        >
          {presets.map((preset) => (
            <option
              key={presetKey(preset.value)}
              value={presetKey(preset.value)}
            >
              {preset.label}
            </option>
          ))}
          <option value="__custom__">{customLabel}…</option>
        </select>
        {isCustom ? (
          <input
            className="min-h-9 w-full border-0 border-t bg-transparent px-3 font-mono text-sm text-content-primary focus:ring-0"
            value={value ?? ""}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(event) =>
              onChange(event.target.value === "" ? null : event.target.value)
            }
            aria-label={`${label} custom value`}
          />
        ) : null}
      </div>
      <span className="rounded-sm bg-background-tertiary px-2 py-1.5 text-xs text-content-secondary">
        {selectedDescription}
      </span>
    </OperatorField>
  );
}

export function OperatorNumberPresetField({
  label,
  description,
  value,
  presets,
  onChange,
  min,
  max,
  customLabel = "Custom value",
  formatValue = (number) => number.toLocaleString(),
}: {
  label: string;
  description: string;
  value: number | null;
  presets: OperatorPreset<number | null>[];
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  customLabel?: string;
  formatValue?: (value: number) => string;
}) {
  const [customSelected, setCustomSelected] = useState(false);
  const match = presets.find((preset) => preset.value === value);
  const isCustom = customSelected || !match;
  const selectedDescription = isCustom
    ? `Enter a whole number${
        min === undefined ? "" : ` from ${formatValue(min)}`
      }${max === undefined ? "" : ` to ${formatValue(max)}`}.`
    : match.description;
  return (
    <OperatorField label={label} description={description}>
      <div className="overflow-hidden rounded-md border bg-background-primary focus-within:border-border-selected">
        <select
          className="min-h-9 w-full border-0 bg-transparent px-3 text-content-primary focus:ring-0"
          value={isCustom ? "__custom__" : presetKey(match!.value)}
          onChange={(event) => {
            if (event.target.value === "__custom__") {
              setCustomSelected(true);
              return;
            }
            const preset = presets.find(
              (candidate) => presetKey(candidate.value) === event.target.value
            );
            if (preset) {
              setCustomSelected(false);
              onChange(preset.value);
            }
          }}
          aria-label={`${label} preset`}
        >
          {presets.map((preset) => (
            <option
              key={presetKey(preset.value)}
              value={presetKey(preset.value)}
            >
              {preset.label}
            </option>
          ))}
          <option value="__custom__">{customLabel}…</option>
        </select>
        {isCustom ? (
          <input
            className="min-h-9 w-full border-0 border-t bg-transparent px-3 font-mono text-sm text-content-primary focus:ring-0"
            type="number"
            min={min}
            max={max}
            value={value ?? ""}
            onChange={(event) =>
              onChange(
                event.target.value === "" ? null : Number(event.target.value)
              )
            }
            aria-label={`${label} custom value`}
          />
        ) : null}
      </div>
      <span className="rounded-sm bg-background-tertiary px-2 py-1.5 text-xs text-content-secondary">
        {selectedDescription}
      </span>
    </OperatorField>
  );
}

function presetKey(value: string | number | null) {
  return value === null ? "__automatic__" : String(value);
}

export function formatOperatorDate(value: string | null | undefined) {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleString()
    : "Unknown";
}
