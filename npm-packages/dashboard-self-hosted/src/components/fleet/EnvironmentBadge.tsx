import { CodeIcon, RocketIcon } from "@radix-ui/react-icons";
import { cn } from "@ui/cn";

export function EnvironmentBadge({
  type,
  compact = false,
}: {
  type: "dev" | "prod";
  compact?: boolean;
}) {
  const Icon = type === "prod" ? RocketIcon : CodeIcon;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-medium tracking-[0.14em] uppercase",
        compact
          ? "gap-1 px-1.5 py-0.5 text-[9px]"
          : "gap-1.5 px-2 py-1 text-[10px]",
        type === "prod"
          ? "border-content-error bg-background-error text-content-error"
          : "border-border-selected bg-background-tertiary text-content-accent",
      )}
    >
      <Icon className={compact ? "size-2.5" : "size-3"} />
      {type}
    </span>
  );
}
