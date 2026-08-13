import { useEffect, useMemo, useState } from "react";
import { DeploymentSettingsLayout } from "@common/layouts/DeploymentSettingsLayout";
import { Button } from "@ui/Button";
import { Callout } from "@ui/Callout";
import { OperatorActionConfirmation } from "../../components/operator/OperatorActionConfirmation";
import {
  EvidenceCard,
  formatOperatorDate,
  OperatorError,
  OperatorField,
  OperatorLoading,
  operatorInputClasses,
} from "../../components/operator/OperatorPagePrimitives";
import { useOperatorState } from "../../components/operator/useOperatorState";
import {
  ExecutedOperatorAction,
  OperatorConfiguration,
  OperatorStatus,
  PreparedOperatorAction,
  operatorMutation,
} from "../../lib/operatorApi";

type ReleaseForm = OperatorConfiguration["release"];

export default function ReleasesPage() {
  const operator = useOperatorState();
  const [form, setForm] = useState<ReleaseForm | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prepared, setPrepared] = useState<PreparedOperatorAction | null>(null);
  const [accepted, setAccepted] = useState<ExecutedOperatorAction | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);

  useEffect(() => {
    if (operator.configuration) setForm(operator.configuration.release);
  }, [operator.configuration]);

  const changed =
    form !== null &&
    operator.configuration !== null &&
    JSON.stringify(form) !== JSON.stringify(operator.configuration.release);
  const issues = useMemo(() => validateRelease(form), [form]);

  async function save() {
    if (!form || issues.length > 0) return;
    setSaving(true);
    try {
      const result = await operator.patch({ release: form });
      setForm(result.current.release);
      setReviewing(false);
    } catch {
      // The shared hook renders the exact API error and refreshes conflicts.
    } finally {
      setSaving(false);
    }
  }

  async function prepare(
    kind: "release" | "rollback",
    imageDigest: string | null,
  ) {
    const configuration = operator.configuration;
    if (!configuration || !imageDigest) return;
    setAccepted(null);
    setActionError(null);
    try {
      const next = await operatorMutation<PreparedOperatorAction>(
        "/v1/actions/prepare",
        "POST",
        {
          kind,
          instanceId: configuration.instance.id,
          baseRevision: configuration.revision,
          parameters: { imageDigest },
        },
      );
      setPrepared(next);
    } catch (requestError) {
      setActionError(asError(requestError));
    }
  }

  const status = operator.status;
  const lastBackup = status?.backups.lastSuccessful;
  const backupAgeHours = lastBackup
    ? (Date.now() - Date.parse(lastBackup.completedAt)) / 3_600_000
    : Number.POSITIVE_INFINITY;
  const backupReady =
    lastBackup?.verified === true &&
    backupAgeHours <= (operator.configuration?.backup.rpoHours ?? 0);
  const releaseCapability =
    operator.metadata?.capabilities.actions.release?.enabled;
  const rollbackCapability =
    operator.metadata?.capabilities.actions.rollback?.enabled;

  return (
    <DeploymentSettingsLayout page="releases">
      <div className="flex flex-col gap-6">
        <header>
          <h3 className="font-semibold">Backend updates</h3>
          <p className="mt-1 max-w-prose text-sm text-content-secondary">
            Choose which backend version to deploy or return to a previous
            version. Saving a version does not change the running deployment;
            starting an update or rollback always requires a separate
            confirmation.
          </p>
        </header>

        {operator.loading && (
          <OperatorLoading detail="Checking the running version, rollback version, and latest backup." />
        )}
        {operator.error && (
          <OperatorError error={operator.error} onRetry={operator.refresh} />
        )}
        {actionError && (
          <OperatorError
            error={actionError}
            onRetry={async () => {
              setActionError(null);
              await operator.refresh();
            }}
          />
        )}
        {accepted && (
          <Callout variant="success">
            The {accepted.kind === "release" ? "update" : "rollback"} request
            was accepted at {formatOperatorDate(accepted.acceptedAt)}. Refresh
            to see when it finishes.
          </Callout>
        )}

        {operator.configuration &&
          operator.metadata &&
          form &&
          !operator.loading && (
            <>
              <section
                className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
                aria-label="Release evidence"
              >
                <EvidenceCard
                  label="Update status"
                  value={releaseStateLabel(status?.release.state)}
                  detail={
                    status
                      ? status.freshness.state === "current"
                        ? `Last checked ${formatOperatorDate(status.generatedAt)}`
                        : `Status may be out of date · last checked ${formatOperatorDate(status.generatedAt)}`
                      : "Could not check the deployment"
                  }
                  warning={
                    !status ||
                    status.freshness.state !== "current" ||
                    status.release.state !== "idle"
                  }
                />
                <EvidenceCard
                  label="Backend image"
                  value={shortDigest(status?.release.backendImageDigest)}
                  detail={
                    status?.release.backendImageDigest ??
                    "Effective digest not reported"
                  }
                  warning={!status?.release.backendImageDigest}
                />
                <EvidenceCard
                  label="Dashboard image"
                  value={shortDigest(status?.release.dashboardImageDigest)}
                  detail={
                    status?.release.dashboardImageDigest ??
                    "Effective digest not reported"
                  }
                  warning={!status?.release.dashboardImageDigest}
                />
                <EvidenceCard
                  label="Recovery prerequisite"
                  value={backupReady ? "Ready" : "Not proven"}
                  detail={
                    lastBackup
                      ? `${lastBackup.id} · ${backupAgeHours.toFixed(1)}h old · ${lastBackup.verified ? "verified" : "unverified"}`
                      : "No backup evidence"
                  }
                  warning={!backupReady}
                />
              </section>

              <section
                className="rounded-lg border bg-background-secondary p-4"
                aria-labelledby="release-target-title"
              >
                <h4 id="release-target-title" className="font-semibold">
                  Reviewed image targets
                </h4>
                <p className="mt-1 text-sm text-content-secondary">
                  Only immutable <code>sha256:</code> digests are accepted.
                  Registry credentials and host orchestration stay server-side.
                </p>
                <div className="mt-4 grid gap-4">
                  <OperatorField
                    label="Desired image digest"
                    description="Candidate backend image after preflight and backup gates."
                  >
                    <input
                      className={operatorInputClasses}
                      value={form.desiredImageDigest ?? ""}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          desiredImageDigest: nullIfEmpty(event.target.value),
                        })
                      }
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </OperatorField>
                  <OperatorField
                    label="Rollback image digest"
                    description="Previously verified image retained for explicit rollback."
                  >
                    <input
                      className={operatorInputClasses}
                      value={form.rollbackImageDigest ?? ""}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          rollbackImageDigest: nullIfEmpty(event.target.value),
                        })
                      }
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </OperatorField>
                </div>

                {issues.length > 0 && (
                  <Callout variant="error">
                    <ul className="list-disc pl-5">
                      {issues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  </Callout>
                )}

                {reviewing && changed && (
                  <div className="mt-4 rounded-md border bg-background-primary p-3 text-sm">
                    <div className="font-medium">Review immutable targets</div>
                    <p className="mt-1">
                      Target <code>{operator.configuration.instance.id}</code>,
                      base revision {operator.configuration.revision}. This
                      records targets only and performs no deployment action.
                    </p>
                    <pre className="mt-3 scrollbar overflow-auto rounded-sm bg-background-tertiary p-3 text-xs">
                      {JSON.stringify(form, null, 2)}
                    </pre>
                    <div className="mt-3 flex gap-2">
                      <Button onClick={() => void save()} loading={saving}>
                        Save reviewed targets
                      </Button>
                      <Button
                        variant="neutral"
                        onClick={() => setReviewing(false)}
                        disabled={saving}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    disabled={!changed || issues.length > 0}
                    onClick={() => setReviewing(true)}
                  >
                    Review target change
                  </Button>
                  <Button
                    variant="neutral"
                    disabled={!changed}
                    onClick={() => {
                      setForm(operator.configuration!.release);
                      setReviewing(false);
                    }}
                  >
                    Reset
                  </Button>
                  <Button
                    variant="neutral"
                    disabled={
                      changed ||
                      !backupReady ||
                      !releaseCapability ||
                      !form.desiredImageDigest
                    }
                    onClick={() =>
                      void prepare("release", form.desiredImageDigest)
                    }
                  >
                    Prepare release
                  </Button>
                  <Button
                    variant="danger"
                    disabled={
                      changed ||
                      !backupReady ||
                      !rollbackCapability ||
                      !form.rollbackImageDigest
                    }
                    onClick={() =>
                      void prepare("rollback", form.rollbackImageDigest)
                    }
                  >
                    Prepare rollback
                  </Button>
                </div>
              </section>

              {prepared && (
                <OperatorActionConfirmation
                  prepared={prepared}
                  onCancel={() => setPrepared(null)}
                  onAccepted={(result) => {
                    setPrepared(null);
                    setAccepted(result);
                  }}
                />
              )}
            </>
          )}
      </div>
    </DeploymentSettingsLayout>
  );
}

function releaseStateLabel(
  state: OperatorStatus["release"]["state"] | undefined,
) {
  if (state === "idle") return "No update in progress";
  if (state === "preflight") return "Checking update safety";
  if (state === "canary") return "Installing the update";
  if (state === "rolling_back") return "Returning to the previous version";
  if (state === "failed") return "Last update failed";
  return "Status unavailable";
}

function validateRelease(form: ReleaseForm | null) {
  if (!form) return [];
  return ([form.desiredImageDigest, form.rollbackImageDigest] as const).flatMap(
    (digest, index) =>
      digest === null || /^sha256:[a-f0-9]{64}$/.test(digest)
        ? []
        : [
            `${index === 0 ? "Desired" : "Rollback"} image must be an immutable lowercase sha256 digest.`,
          ],
  );
}

function shortDigest(value: string | null | undefined) {
  return value ? `${value.slice(0, 15)}…${value.slice(-8)}` : "Not reported";
}

function nullIfEmpty(value: string) {
  return value.trim() === "" ? null : value.trim();
}

function asError(value: unknown) {
  return value instanceof Error
    ? value
    : new Error("Unknown operator action error");
}
