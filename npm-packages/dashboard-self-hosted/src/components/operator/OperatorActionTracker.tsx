import { useCallback, useEffect, useState } from "react";
import { Button } from "@ui/Button";
import {
  ExecutedOperatorAction,
  operatorActionScope,
  operatorGet,
} from "../../lib/operatorApi";

const STORAGE_PREFIX = "convex-operator-actions:";
const TRACKER_EVENT = "convex-operator-action-tracker";

type TrackedAction = Pick<
  ExecutedOperatorAction,
  "actionId" | "kind" | "acceptedAt"
>;

export function trackOperatorAction(action: ExecutedOperatorAction) {
  if (typeof window === "undefined") return;
  const scope = operatorActionScope();
  const actions = readTrackedActions(scope).filter(
    (candidate) => candidate.actionId !== action.actionId,
  );
  actions.unshift({
    actionId: action.actionId,
    kind: action.kind,
    acceptedAt: action.acceptedAt,
  });
  window.localStorage.setItem(
    storageKey(scope),
    JSON.stringify(actions.slice(0, 20)),
  );
  window.dispatchEvent(new CustomEvent(TRACKER_EVENT, { detail: { scope } }));
}

export function OperatorActionTray({ scope }: { scope: string }) {
  const [tracked, setTracked] = useState<TrackedAction[]>([]);
  const [statuses, setStatuses] = useState<
    Record<string, ExecutedOperatorAction>
  >({});

  const reload = useCallback(() => setTracked(readTrackedActions(scope)), [scope]);

  useEffect(() => {
    reload();
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ scope?: string }>).detail;
      if (detail?.scope === scope) reload();
    };
    window.addEventListener(TRACKER_EVENT, listener);
    return () => window.removeEventListener(TRACKER_EVENT, listener);
  }, [reload, scope]);

  useEffect(() => {
    if (tracked.length === 0) return undefined;
    let active = true;
    const refresh = async () => {
      const results = await Promise.all(
        tracked.map(async (action) => {
          try {
            const response = await operatorGet<{ action: ExecutedOperatorAction }>(
              `/v1/actions/${encodeURIComponent(action.actionId)}`,
            );
            return [action.actionId, response.action] as const;
          } catch {
            return null;
          }
        }),
      );
      if (!active) return;
      setStatuses((current) => ({
        ...current,
        ...Object.fromEntries(results.filter((result) => result !== null)),
      }));
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 2_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [tracked]);

  const dismiss = (actionId: string) => {
    const next = tracked.filter((action) => action.actionId !== actionId);
    window.localStorage.setItem(storageKey(scope), JSON.stringify(next));
    setTracked(next);
  };

  if (tracked.length === 0) return null;
  return (
    <aside
      className="fixed inset-x-3 bottom-16 z-50 ml-auto max-w-md rounded-lg border bg-background-secondary p-3 shadow-lg sm:right-4 sm:bottom-3 sm:left-auto sm:w-96"
      aria-label="Operator action progress"
      aria-live="polite"
    >
      <div className="text-sm font-semibold">Operator actions</div>
      <div className="mt-2 grid gap-2">
        {tracked.map((action) => {
          const status = statuses[action.actionId];
          const state = status?.state ?? "queued";
          return (
            <div
              key={action.actionId}
              className="flex items-start justify-between gap-3 rounded-md border bg-background-primary p-2 text-sm"
            >
              <div className="min-w-0">
                <div className="font-medium">{actionLabel(action.kind)}</div>
                <div className="text-content-secondary">
                  {stateLabel(state)} · <code>{action.actionId.slice(0, 8)}</code>
                </div>
                {status?.failure && (
                  <div className="mt-1 text-content-error">
                    {status.failure.message}
                  </div>
                )}
              </div>
              {(state === "succeeded" || state === "failed") && (
                <Button
                  size="xs"
                  variant="unstyled"
                  onClick={() => dismiss(action.actionId)}
                  aria-label={`Dismiss ${actionLabel(action.kind)} status`}
                >
                  Dismiss
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export function readTrackedActions(scope: string): TrackedAction[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey(scope)) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is TrackedAction =>
        item !== null &&
        typeof item === "object" &&
        typeof item.actionId === "string" &&
        /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/.test(item.actionId) &&
        typeof item.kind === "string" &&
        typeof item.acceptedAt === "string",
    );
  } catch {
    return [];
  }
}

function storageKey(scope: string) {
  return `${STORAGE_PREFIX}${scope}`;
}

function stateLabel(state: ExecutedOperatorAction["state"]) {
  if (state === "queued") return "Queued";
  if (state === "running") return "Running";
  if (state === "succeeded") return "Completed";
  return "Failed";
}

function actionLabel(kind: string) {
  return kind.replaceAll("-", " ");
}
