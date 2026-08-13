import { useEffect, useRef, useState } from "react";
import { Button } from "@ui/Button";
import { Callout } from "@ui/Callout";
import {
  ExecutedOperatorAction,
  OperatorApiError,
  PreparedOperatorAction,
  operatorGet,
  operatorMutation,
} from "../../lib/operatorApi";
import { ConfirmationPhrase } from "./ConfirmationPhrase";
import { trackOperatorAction } from "./OperatorActionTracker";

export function OperatorActionConfirmation({
  prepared,
  onCancel,
  onAccepted,
}: {
  prepared: PreparedOperatorAction;
  onCancel: () => void;
  onAccepted: (result: ExecutedOperatorAction) => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [submitted, setSubmitted] = useState<ExecutedOperatorAction | null>(
    null,
  );
  const acceptedCallback = useRef(onAccepted);
  acceptedCallback.current = onAccepted;

  useEffect(() => {
    if (!submitted || submitted.state === "succeeded") return undefined;
    let active = true;
    const refresh = async () => {
      try {
        const response = await operatorGet<{ action: ExecutedOperatorAction }>(
          `/v1/actions/${encodeURIComponent(submitted.actionId)}`,
        );
        if (!active) return;
        if (response.action.state === "succeeded") {
          setExecuting(false);
          setSubmitted(response.action);
          acceptedCallback.current(response.action);
        } else if (response.action.state === "failed") {
          setExecuting(false);
          setSubmitted(response.action);
          setError(
            new Error(
              response.action.failure?.message ??
                "The reviewed operator action failed.",
            ),
          );
        }
      } catch (requestError) {
        if (active) {
          setExecuting(false);
          setError(
            requestError instanceof Error
              ? requestError
              : new Error("Operator action status is unavailable"),
          );
        }
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 1_500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [submitted]);

  async function execute() {
    let continuesInBackground = false;
    setExecuting(true);
    setError(null);
    try {
      const result = await operatorMutation<ExecutedOperatorAction>(
        "/v1/actions/execute",
        "POST",
        { token: prepared.token, confirmation },
      );
      if (result.state === "succeeded") {
        onAccepted(result);
        setExecuting(false);
      } else if (result.state === "failed") {
        throw new Error(result.failure?.message ?? "The operator action failed");
      } else {
        trackOperatorAction(result);
        setSubmitted(result);
        continuesInBackground = true;
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError
          : new Error("Unknown operator action error"),
      );
    } finally {
      if (!continuesInBackground) setExecuting(false);
    }
  }

  return (
    <section
      className="rounded-lg border border-content-error bg-background-secondary p-4"
      aria-labelledby={`confirm-${prepared.action.id}`}
    >
      <h4 id={`confirm-${prepared.action.id}`} className="font-semibold">
        Confirm operator action
      </h4>
      <p className="mt-1 text-sm">{prepared.action.summary}</p>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="text-content-secondary">Exact instance</dt>
        <dd>
          <code>{prepared.action.instanceId}</code>
        </dd>
        <dt className="text-content-secondary">Expected downtime</dt>
        <dd>{prepared.action.expectedDowntime}</dd>
        <dt className="text-content-secondary">Authorization expires</dt>
        <dd>{new Date(prepared.action.expiresAt).toLocaleString()}</dd>
        {prepared.action.backupPrerequisite && (
          <>
            <dt className="text-content-secondary">Verified backup</dt>
            <dd className="min-w-0">
              <code className="text-xs break-all">
                {prepared.action.backupPrerequisite.id} ·{" "}
                {prepared.action.backupPrerequisite.sha256}
              </code>
            </dd>
          </>
        )}
        {prepared.action.archive && (
          <>
            <dt className="text-content-secondary">Archive</dt>
            <dd className="min-w-0">
              <code className="text-xs break-all">
                {prepared.action.archive.id} · {prepared.action.archive.sha256}
              </code>
            </dd>
          </>
        )}
      </dl>
      <ConfirmationPhrase
        className="mt-4 max-w-2xl"
        value={prepared.action.confirmation}
      />
      <label className="mt-3 flex max-w-2xl flex-col gap-1 text-sm">
        <span>Paste confirmation text</span>
        <input
          className="min-h-9 rounded-md border bg-background-primary px-3 font-mono text-content-primary"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {error && (
        <Callout variant="error">
          <div>
            <div className="font-medium">Action was not accepted.</div>
            <div>{error.message}</div>
            {error instanceof OperatorApiError && error.issues.length > 0 && (
              <ul className="list-disc pl-5">
                {error.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
          </div>
        </Callout>
      )}
      {executing && submitted && (
        <p className="mt-3 text-sm text-content-secondary" role="status">
          Action {submitted.actionId} is {submitted.state}. You can navigate
          away; progress remains available in the operator action tray.
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="danger"
          disabled={confirmation !== prepared.action.confirmation || executing}
          loading={executing}
          onClick={() => void execute()}
        >
          Execute exact action
        </Button>
        <Button variant="neutral" disabled={executing} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
