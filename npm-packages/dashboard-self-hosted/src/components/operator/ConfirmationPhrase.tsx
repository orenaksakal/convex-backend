import { CopyIcon } from "@radix-ui/react-icons";
import { Button } from "@ui/Button";
import { useEffect, useState } from "react";

export function ConfirmationPhrase({
  value,
  className = "",
}: {
  value: string;
  className?: string;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  useEffect(() => setCopyState("idle"), [value]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div className={className}>
      <div className="text-sm text-content-secondary">
        Copy this confirmation text, then paste it below:
      </div>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 rounded-md bg-background-tertiary px-3 py-2 text-sm font-semibold break-all text-content-primary select-all">
          {value}
        </code>
        <Button
          type="button"
          size="xs"
          variant="neutral"
          icon={<CopyIcon />}
          onClick={() => void copy()}
        >
          {copyState === "copied"
            ? "Copied"
            : copyState === "failed"
              ? "Copy failed"
              : "Copy"}
        </Button>
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {copyState === "copied"
          ? "Confirmation text copied to the clipboard."
          : copyState === "failed"
            ? "Could not copy the confirmation text."
            : ""}
      </span>
    </div>
  );
}
