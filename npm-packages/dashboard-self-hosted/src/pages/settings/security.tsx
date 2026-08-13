import { useEffect, useMemo, useState } from "react";
import {
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
} from "@headlessui/react";
import { DeploymentSettingsLayout } from "@common/layouts/DeploymentSettingsLayout";
import { useDeploymentUrl } from "@common/lib/deploymentApi";
import { Button } from "@ui/Button";
import { Callout } from "@ui/Callout";
import { OperatorActionConfirmation } from "../../components/operator/OperatorActionConfirmation";
import { ConfirmationPhrase } from "../../components/operator/ConfirmationPhrase";
import {
  HealthSignal,
  SignalLevel,
} from "../../components/operator/HealthSignal";
import {
  formatOperatorDate,
  OperatorError,
  OperatorField,
  OperatorLoading,
  OperatorNumberPresetField,
  operatorInputClasses,
} from "../../components/operator/OperatorPagePrimitives";
import { exposureProbePresentation } from "../../components/operator/TruthfulEvidence";
import { useOperatorState } from "../../components/operator/useOperatorState";
import {
  DeployCredential,
  ExecutedOperatorAction,
  IssuedDeployCredential,
  operatorGet,
  operatorMutation,
  OperatorStatus,
  PreparedOperatorAction,
} from "../../lib/operatorApi";

type SecurityForm = {
  dashboardSessionTtlSeconds: number;
  dashboardCredentialRef: string;
};

type DeployConfirmation = {
  kind: "rotate" | "revoke";
  credential: DeployCredential;
  value: string;
};

const DEPLOY_EXPIRY_PRESETS = [
  {
    label: "7 days · temporary",
    value: 7,
    description: "Best for a short-lived machine or migration.",
  },
  {
    label: "30 days · frequent rotation",
    value: 30,
    description: "Limits exposure with a monthly rotation routine.",
  },
  {
    label: "90 days (recommended)",
    value: 90,
    description: "Balanced lifetime for continuous integration credentials.",
  },
  {
    label: "180 days",
    value: 180,
    description: "Lower-maintenance option for stable automation.",
  },
  {
    label: "365 days · maximum",
    value: 365,
    description: "Longest allowed lifetime; schedule a rotation reminder.",
  },
];

const SESSION_TTL_PRESETS = [
  {
    label: "5 minutes · strict",
    value: 300,
    description: "Frequent reauthentication for high-risk maintenance windows.",
  },
  {
    label: "15 minutes (recommended)",
    value: 900,
    description: "Short-lived access without interrupting routine checks.",
  },
  {
    label: "30 minutes",
    value: 1800,
    description: "More convenient for longer operational sessions.",
  },
  {
    label: "1 hour · maximum",
    value: 3600,
    description: "Longest permitted dashboard session.",
  },
];

export default function SecurityPage() {
  const deploymentUrl = useDeploymentUrl();
  const operator = useOperatorState();
  const [form, setForm] = useState<SecurityForm | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reissuing, setReissuing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<Error | null>(null);
  const [prepared, setPrepared] = useState<PreparedOperatorAction | null>(null);
  const [accepted, setAccepted] = useState<ExecutedOperatorAction | null>(null);
  const [deployCredentials, setDeployCredentials] = useState<
    DeployCredential[] | null
  >(null);
  const [deployLabel, setDeployLabel] = useState("");
  const [deployExpiryDays, setDeployExpiryDays] = useState(90);
  const [deployBusy, setDeployBusy] = useState(false);
  const [issuedDeployCredential, setIssuedDeployCredential] =
    useState<IssuedDeployCredential | null>(null);
  const deployCommand = issuedDeployCredential
    ? `npx convex deploy --url ${JSON.stringify(
        deploymentUrl
      )} --admin-key ${JSON.stringify(issuedDeployCredential.token)}`
    : null;
  const [deployConfirmation, setDeployConfirmation] =
    useState<DeployConfirmation | null>(null);

  const deployCredentialCapability =
    operator.metadata?.capabilities.deployCredentials;

  useEffect(() => {
    if (!deployCredentialCapability?.read) {
      setDeployCredentials(null);
      return;
    }
    let active = true;
    void operatorGet<{ credentials: DeployCredential[] }>(
      "/v1/deploy-credentials"
    )
      .then((result) => {
        if (active) setDeployCredentials(result.credentials);
      })
      .catch((requestError) => {
        if (active) setSessionError(asError(requestError));
      });
    return () => {
      active = false;
    };
  }, [deployCredentialCapability?.read]);

  useEffect(() => {
    if (!operator.configuration) return;
    setForm({
      dashboardSessionTtlSeconds:
        operator.configuration.security.dashboardSessionTtlSeconds,
      dashboardCredentialRef:
        operator.configuration.security.dashboardCredentialRef,
    });
  }, [operator.configuration]);

  const original = operator.configuration
    ? {
        dashboardSessionTtlSeconds:
          operator.configuration.security.dashboardSessionTtlSeconds,
        dashboardCredentialRef:
          operator.configuration.security.dashboardCredentialRef,
      }
    : null;
  const changed =
    form !== null &&
    original !== null &&
    JSON.stringify(form) !== JSON.stringify(original);
  const issues = useMemo(() => validate(form), [form]);

  async function save() {
    if (!form || issues.length > 0) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await operator.patch({
        security: {
          dashboardSessionTtlSeconds: form.dashboardSessionTtlSeconds,
          dashboardCredentialRef: form.dashboardCredentialRef,
          publicAdminEndpointsAllowed: false,
        },
      });
      setForm({
        dashboardSessionTtlSeconds:
          result.current.security.dashboardSessionTtlSeconds,
        dashboardCredentialRef: result.current.security.dashboardCredentialRef,
      });
      setReviewing(false);
      setMessage("Security policy saved.");
    } catch {
      // The shared hook displays the exact error and refreshes revision conflicts.
    } finally {
      setSaving(false);
    }
  }

  async function reissueSession() {
    setReissuing(true);
    setMessage(null);
    setSessionError(null);
    try {
      await operatorMutation<void>("/v1/session", "DELETE");
      window.location.reload();
    } catch (requestError) {
      setSessionError(asError(requestError));
    } finally {
      setReissuing(false);
    }
  }

  async function prepareRotation(credentialAlias: string) {
    if (!operator.configuration || !form) return;
    setSessionError(null);
    setAccepted(null);
    try {
      setPrepared(
        await operatorMutation<PreparedOperatorAction>(
          "/v1/actions/prepare",
          "POST",
          {
            kind: "rotate-credential",
            instanceId: operator.configuration.instance.id,
            baseRevision: operator.configuration.revision,
            parameters: { credentialAlias },
          }
        )
      );
    } catch (requestError) {
      setSessionError(asError(requestError));
    }
  }

  async function refreshDeployCredentials() {
    const result = await operatorGet<{ credentials: DeployCredential[] }>(
      "/v1/deploy-credentials"
    );
    setDeployCredentials(result.credentials);
  }

  async function createDeployCredential() {
    if (
      !deployCredentialCapability?.write ||
      deployLabel.trim() !== deployLabel ||
      deployLabel.length < 1 ||
      deployLabel.length > 64 ||
      !Number.isSafeInteger(deployExpiryDays) ||
      deployExpiryDays < 1 ||
      deployExpiryDays > 365
    )
      return;
    setDeployBusy(true);
    setSessionError(null);
    setMessage(null);
    setIssuedDeployCredential(null);
    try {
      const issued = await operatorMutation<IssuedDeployCredential>(
        "/v1/deploy-credentials",
        "POST",
        { label: deployLabel, expiresInDays: deployExpiryDays }
      );
      setIssuedDeployCredential(issued);
      setDeployLabel("");
      await refreshDeployCredentials();
    } catch (requestError) {
      setSessionError(asError(requestError));
    } finally {
      setDeployBusy(false);
    }
  }

  async function executeDeployCredentialChange() {
    if (!deployConfirmation) return;
    const phrase = `${deployConfirmation.kind} ${deployConfirmation.credential.id}`;
    if (deployConfirmation.value !== phrase) return;
    setDeployBusy(true);
    setSessionError(null);
    setMessage(null);
    setIssuedDeployCredential(null);
    try {
      if (deployConfirmation.kind === "rotate") {
        const issued = await operatorMutation<IssuedDeployCredential>(
          `/v1/deploy-credentials/${deployConfirmation.credential.id}/rotate`,
          "POST",
          { expiresInDays: deployExpiryDays }
        );
        setIssuedDeployCredential(issued);
      } else {
        await operatorMutation<DeployCredential>(
          `/v1/deploy-credentials/${deployConfirmation.credential.id}`,
          "DELETE"
        );
        setMessage(
          `Deploy-only key ${deployConfirmation.credential.label} was revoked immediately.`
        );
      }
      setDeployConfirmation(null);
      await refreshDeployCredentials();
    } catch (requestError) {
      setSessionError(asError(requestError));
    } finally {
      setDeployBusy(false);
    }
  }

  const status = operator.status;
  const effectiveRedaction =
    status?.runtime.effectiveKnobs?.REDACT_LOGS_TO_CLIENT;
  const evidenceIsCurrent = status?.freshness.state === "current";
  const adminExposure = exposureProbePresentation(
    status?.security.publicAdminReachable,
    evidenceIsCurrent,
    "Administrative endpoints"
  );
  const metricsExposure = exposureProbePresentation(
    status?.security.metricsPubliclyReachable,
    evidenceIsCurrent,
    "The monitoring endpoint"
  );
  const exposureCheckedAt = status
    ? ` Last checked ${formatOperatorDate(status.security.checkedAt)}.`
    : "";
  const credentialReferences = form
    ? [
        {
          label: "Dashboard access key",
          alias: form.dashboardCredentialRef,
          detail: "Protects sign-in sessions for this deployment's dashboard",
        },
        {
          label: "Database password",
          alias: operator.configuration?.providers.database.credentialRef,
          detail: "Connects this deployment to its PostgreSQL database",
        },
        {
          label: "File storage key",
          alias: operator.configuration?.providers.objectStorage.credentialRef,
          detail: "Connects this deployment to its stored files",
        },
      ]
    : [];
  const credentialRotationEnabled =
    operator.metadata?.capabilities.actions["rotate-credential"]?.enabled ===
    true;
  const visibleCredentialReferences = credentialReferences.filter(
    (reference) => {
      const credential = reference.alias
        ? status?.security.credentials.find(
            (item) => item.alias === reference.alias
          )
        : undefined;
      return (
        credentialRotationEnabled ||
        (credential !== undefined &&
          (credential.state !== "unknown" ||
            credential.lastRotatedAt !== null ||
            credential.rotationDueAt !== null))
      );
    }
  );

  return (
    <DeploymentSettingsLayout page="security">
      <div className="flex flex-col gap-6">
        <header>
          <h3 className="font-semibold">Security</h3>
          <p className="mt-1 max-w-prose text-sm text-content-secondary">
            Verify the private administration boundary and configure scoped
            dashboard sessions. Client-log exposure and edit confirmation are
            configured on General. Host firewall, proxy, Transport Layer
            Security (TLS), and domain configuration remain deployment-layer
            controls.
          </p>
        </header>

        {operator.loading && (
          <OperatorLoading detail="Waiting for private-boundary probes and effective security state." />
        )}
        {operator.error && (
          <OperatorError error={operator.error} onRetry={operator.refresh} />
        )}
        {sessionError && (
          <OperatorError
            error={sessionError}
            onRetry={async () => {
              setSessionError(null);
              await operator.refresh();
            }}
          />
        )}
        {message && <Callout variant="success">{message}</Callout>}
        {accepted && (
          <Callout variant="success">
            Credential rotation action <code>{accepted.actionId}</code> was
            accepted. Refresh status after the host hook completes to verify the
            new rotation timestamp.
          </Callout>
        )}
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

        {operator.configuration && form && !operator.loading && (
          <>
            <section className="overflow-hidden rounded-lg border bg-background-secondary">
              <div className="border-b px-4 py-3">
                <h4 className="font-semibold">Security checks</h4>
                <p className="mt-1 text-sm text-content-secondary">
                  Make sure the dashboard is private and its security settings
                  are up to date.
                </p>
              </div>
              <div className="divide-y">
                <PostureRow
                  label="Administrative endpoint exposure"
                  value={adminExposure.label}
                  detail={`${adminExposure.detail}${exposureCheckedAt}`}
                  level={adminExposure.level}
                />
                <PostureRow
                  label="Monitoring endpoint exposure"
                  value={metricsExposure.label}
                  detail={`${metricsExposure.detail}${exposureCheckedAt}`}
                  level={metricsExposure.level}
                />
                <PostureRow
                  label="Client-log redaction"
                  value={
                    !evidenceIsCurrent
                      ? "Unknown"
                      : effectiveRedaction === true
                      ? "Effective"
                      : effectiveRedaction === false
                      ? "Disabled"
                      : "Not observed"
                  }
                  detail="Prevents sensitive function details reaching clients"
                  level={
                    !evidenceIsCurrent || effectiveRedaction === undefined
                      ? "unknown"
                      : effectiveRedaction === true
                      ? "healthy"
                      : "attention"
                  }
                />
                <PostureRow
                  label="Evidence"
                  value={status?.freshness.state ?? "Unknown"}
                  detail={
                    status
                      ? `${status.freshness.ageSeconds}s old`
                      : "No validated status"
                  }
                  level={
                    !status
                      ? "unknown"
                      : evidenceIsCurrent
                      ? "healthy"
                      : "attention"
                  }
                />
              </div>
            </section>

            {deployCredentialCapability?.read && (
              <section
                className="rounded-lg border bg-background-secondary p-4"
                aria-labelledby="deploy-credentials-title"
              >
                <h4 id="deploy-credentials-title" className="font-semibold">
                  Deploy-only access for CLI and CI
                </h4>
                <p className="mt-1 max-w-prose text-sm text-content-secondary">
                  Create a separate key for each developer or automation
                  workflow that deploys code to this instance. These keys can
                  only deploy; they cannot perform other administrator actions.
                  Each key can be revoked independently and is shown only once.
                </p>
                <Callout variant="instructions" className="mt-3 block">
                  <div className="font-medium">
                    Why does the Convex CLI call this an admin key?
                  </div>
                  <p className="mt-1">
                    The CLI uses the option <code>--admin-key</code> and the
                    variable <code>CONVEX_SELF_HOSTED_ADMIN_KEY</code> for
                    self-hosted access. Despite that name, a key created here is
                    restricted to deploying code. Use it together with
                    <code className="mx-1">CONVEX_SELF_HOSTED_URL</code>, as
                    shown in the command after creation.
                  </p>
                  <p className="mt-2">
                    <code>CONVEX_DEPLOY_KEY</code> is for Convex Cloud and will
                    not work with this self-hosted key.
                  </p>
                </Callout>

                <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
                  <OperatorField
                    label="Key name"
                    description="A descriptive name for the workflow or machine."
                  >
                    <input
                      className={operatorInputClasses}
                      value={deployLabel}
                      maxLength={64}
                      autoComplete="off"
                      onChange={(event) => setDeployLabel(event.target.value)}
                    />
                  </OperatorField>
                  <OperatorNumberPresetField
                    label="Expires in days"
                    description="Shorter-lived keys are safer; choose a common replacement interval or set an exact duration."
                    value={deployExpiryDays}
                    presets={DEPLOY_EXPIRY_PRESETS}
                    min={1}
                    max={365}
                    onChange={(value) =>
                      value !== null && setDeployExpiryDays(value)
                    }
                  />
                  <Button
                    disabled={
                      !deployCredentialCapability.write ||
                      deployLabel.trim() !== deployLabel ||
                      deployLabel.length < 1 ||
                      deployLabel.length > 64 ||
                      !Number.isSafeInteger(deployExpiryDays) ||
                      deployExpiryDays < 1 ||
                      deployExpiryDays > 365
                    }
                    loading={deployBusy}
                    onClick={() => void createDeployCredential()}
                  >
                    Create deploy-only key
                  </Button>
                </div>

                {issuedDeployCredential && (
                  <Callout variant="success">
                    <div className="flex flex-col gap-2">
                      <div className="font-semibold">
                        Copy this deploy-only key now. It will not be shown
                        again.
                      </div>
                      <code className="rounded-sm bg-background-tertiary p-3 text-xs break-all">
                        {issuedDeployCredential.token}
                      </code>
                      <div className="text-sm text-content-secondary">
                        Run from the application directory containing your
                        <code className="mx-1">convex/</code> functions:
                      </div>
                      <code className="rounded-sm bg-background-tertiary p-3 text-xs break-all">
                        {deployCommand}
                      </code>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="xs"
                          onClick={() => {
                            void navigator.clipboard
                              .writeText(issuedDeployCredential.token)
                              .then(() =>
                                setMessage(
                                  "Deploy-only key copied to the clipboard."
                                )
                              )
                              .catch((error) =>
                                setSessionError(asError(error))
                              );
                          }}
                        >
                          Copy key
                        </Button>
                        <Button
                          size="xs"
                          onClick={() => {
                            if (!deployCommand) return;
                            void navigator.clipboard
                              .writeText(deployCommand)
                              .then(() =>
                                setMessage(
                                  "Deploy command copied to the clipboard."
                                )
                              )
                              .catch((error) =>
                                setSessionError(asError(error))
                              );
                          }}
                        >
                          Copy deploy command
                        </Button>
                        <Button
                          size="xs"
                          variant="neutral"
                          onClick={() => setIssuedDeployCredential(null)}
                        >
                          I have saved it
                        </Button>
                      </div>
                    </div>
                  </Callout>
                )}

                {deployConfirmation && (
                  <div
                    className="mt-4 rounded-md border bg-background-primary p-3 text-sm"
                    role="alertdialog"
                    aria-labelledby="deploy-confirmation-title"
                  >
                    <div
                      id="deploy-confirmation-title"
                      className="font-semibold"
                    >
                      Confirm {deployConfirmation.kind}
                    </div>
                    <p className="mt-1 text-content-secondary">
                      This immediately invalidates the existing key.
                      {deployConfirmation.kind === "rotate"
                        ? " A replacement secret will be shown once."
                        : " Running deployments that still use it will fail."}
                    </p>
                    <ConfirmationPhrase
                      className="mt-3 max-w-xl"
                      value={`${deployConfirmation.kind} ${deployConfirmation.credential.id}`}
                    />
                    <label className="mt-3 flex max-w-xl flex-col gap-1">
                      <span>Paste confirmation text</span>
                      <input
                        className={operatorInputClasses}
                        value={deployConfirmation.value}
                        autoComplete="off"
                        onChange={(event) =>
                          setDeployConfirmation({
                            ...deployConfirmation,
                            value: event.target.value,
                          })
                        }
                      />
                    </label>
                    <div className="mt-3 flex gap-2">
                      <Button
                        variant="danger"
                        disabled={
                          deployConfirmation.value !==
                          `${deployConfirmation.kind} ${deployConfirmation.credential.id}`
                        }
                        loading={deployBusy}
                        onClick={() => void executeDeployCredentialChange()}
                      >
                        {deployConfirmation.kind === "rotate"
                          ? "Replace key"
                          : "Revoke key"}
                      </Button>
                      <Button
                        variant="neutral"
                        disabled={deployBusy}
                        onClick={() => setDeployConfirmation(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                <div className="mt-4 overflow-x-auto rounded-md border bg-background-primary">
                  <table className="w-full min-w-3xl text-left text-sm">
                    <thead className="border-b text-xs text-content-secondary">
                      <tr>
                        <th className="p-3 font-medium">Label</th>
                        <th className="p-3 font-medium">Scope</th>
                        <th className="p-3 font-medium">State</th>
                        <th className="p-3 font-medium">Expires</th>
                        <th className="p-3 font-medium">Last used</th>
                        <th className="p-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deployCredentials?.map((credential) => (
                        <tr
                          key={credential.id}
                          className="border-b last:border-0"
                        >
                          <td className="p-3">
                            <div className="font-medium">
                              {credential.label}
                            </div>
                            <code className="text-xs text-content-secondary">
                              {credential.id}
                            </code>
                          </td>
                          <td className="p-3 text-xs">Deploy only</td>
                          <td className="p-3 capitalize">{credential.state}</td>
                          <td className="p-3">
                            {formatOperatorDate(credential.expiresAt)}
                          </td>
                          <td className="p-3">
                            {credential.lastUsedAt
                              ? formatOperatorDate(credential.lastUsedAt)
                              : "Never"}
                          </td>
                          <td className="p-3">
                            <div className="flex gap-2">
                              <Button
                                size="xs"
                                variant="neutral"
                                disabled={
                                  deployBusy ||
                                  credential.state !== "active" ||
                                  !deployCredentialCapability.write
                                }
                                onClick={() =>
                                  setDeployConfirmation({
                                    kind: "rotate",
                                    credential,
                                    value: "",
                                  })
                                }
                              >
                                Rotate
                              </Button>
                              <Button
                                size="xs"
                                variant="danger"
                                disabled={
                                  deployBusy ||
                                  credential.state !== "active" ||
                                  !deployCredentialCapability.write
                                }
                                onClick={() =>
                                  setDeployConfirmation({
                                    kind: "revoke",
                                    credential,
                                    value: "",
                                  })
                                }
                              >
                                Revoke
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {deployCredentials?.length === 0 && (
                        <tr>
                          <td
                            colSpan={6}
                            className="p-4 text-content-secondary"
                          >
                            No deploy-only keys. Create one for a trusted
                            developer or automation workflow.
                          </td>
                        </tr>
                      )}
                      {deployCredentials === null && (
                        <tr>
                          <td
                            colSpan={6}
                            className="p-4 text-content-secondary"
                          >
                            Loading deploy-only keys…
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {visibleCredentialReferences.length > 0 && (
              <Disclosure
                as="section"
                className="rounded-lg border bg-background-secondary p-4"
              >
                <DisclosureButton className="w-full cursor-pointer text-left font-semibold">
                  Infrastructure keys
                </DisclosureButton>
                <DisclosurePanel>
                  <p className="mt-1 max-w-prose text-sm text-content-secondary">
                    These keys connect the dashboard, database, and file
                    storage. Their values remain securely stored on the server
                    and are never shown on this page. Replace each key
                    periodically to limit the impact of an old key being
                    exposed.
                  </p>
                  <div className="mt-4 grid gap-3 lg:grid-cols-3">
                    {visibleCredentialReferences.map((reference) => {
                      const credential = reference.alias
                        ? status?.security.credentials.find(
                            (item) => item.alias === reference.alias
                          )
                        : undefined;
                      return (
                        <div
                          key={reference.label}
                          className="rounded-md border bg-background-primary p-3"
                        >
                          <div className="text-sm font-medium">
                            {reference.label}
                          </div>
                          <div className="mt-1 text-xs text-content-secondary">
                            {reference.detail}
                          </div>
                          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                            <dt className="text-content-secondary">Status</dt>
                            <dd>{infrastructureKeyStatus(credential)}</dd>
                            <dt className="text-content-secondary">
                              Last replaced
                            </dt>
                            <dd>
                              {credential?.lastRotatedAt
                                ? formatOperatorDate(credential.lastRotatedAt)
                                : "Never"}
                            </dd>
                            <dt className="text-content-secondary">
                              Replace by
                            </dt>
                            <dd>
                              {credential?.rotationDueAt
                                ? formatOperatorDate(credential.rotationDueAt)
                                : credential?.state === "due" ||
                                  credential?.state === "overdue"
                                ? "Now"
                                : "Not scheduled"}
                            </dd>
                          </dl>
                          <Button
                            className="mt-3"
                            variant="neutral"
                            disabled={
                              changed ||
                              !reference.alias ||
                              !operator.metadata?.capabilities.actions[
                                "rotate-credential"
                              ]?.enabled
                            }
                            onClick={() => {
                              if (reference.alias)
                                void prepareRotation(reference.alias);
                            }}
                          >
                            Replace {reference.label.toLowerCase()}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                  {!evidenceIsCurrent && (
                    <Callout variant="error">
                      The latest key status is missing or out of date. You can
                      start a replacement, but wait for a fresh status report
                      before treating it as complete.
                    </Callout>
                  )}
                </DisclosurePanel>
              </Disclosure>
            )}

            <section
              className="rounded-lg border bg-background-secondary p-4"
              aria-labelledby="security-policy-title"
            >
              <h4 id="security-policy-title" className="font-semibold">
                Dashboard security policy
              </h4>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <OperatorNumberPresetField
                  label="Dashboard session time to live (TTL), seconds"
                  description="How long a signed-in dashboard session remains valid before reauthentication is required. The cookie is scoped and inaccessible to browser JavaScript (HttpOnly); minimum 60 and maximum 3600 seconds."
                  value={form.dashboardSessionTtlSeconds}
                  presets={SESSION_TTL_PRESETS}
                  min={60}
                  max={3600}
                  onChange={(dashboardSessionTtlSeconds) =>
                    dashboardSessionTtlSeconds !== null &&
                    setForm({ ...form, dashboardSessionTtlSeconds })
                  }
                />
                <OperatorField
                  label="Dashboard credential alias"
                  description="Safe name that points to the dashboard-signing secret on the private operator host. The alias is shown here; the secret value is never returned to the browser."
                >
                  <input
                    className={operatorInputClasses}
                    value={form.dashboardCredentialRef}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        dashboardCredentialRef: event.target.value.trim(),
                      })
                    }
                    autoComplete="off"
                  />
                </OperatorField>
                <div className="rounded-md border bg-background-primary p-3 text-sm">
                  <div className="font-medium">
                    Public administrative endpoints
                  </div>
                  <div className="mt-1 text-content-secondary">
                    Disallowed by configuration validation. The observed public
                    or private result is reported in Security checks above.
                  </div>
                </div>
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
                  <div className="font-medium">
                    Review security policy revision
                  </div>
                  <p className="mt-1">
                    Target <code>{operator.configuration.instance.id}</code>,
                    base revision {operator.configuration.revision}.
                  </p>
                  <pre className="mt-3 scrollbar overflow-auto rounded-sm bg-background-tertiary p-3 text-xs">
                    {JSON.stringify(form, null, 2)}
                  </pre>
                  <div className="mt-3 flex gap-2">
                    <Button onClick={() => void save()} loading={saving}>
                      Apply reviewed policy
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
                  Review policy change
                </Button>
                <Button
                  variant="neutral"
                  disabled={!changed}
                  onClick={() => {
                    if (original) setForm(original);
                    setReviewing(false);
                  }}
                >
                  Reset
                </Button>
                <Button
                  variant="neutral"
                  loading={reissuing}
                  onClick={() => void reissueSession()}
                >
                  Revoke session and reload
                </Button>
              </div>
            </section>
          </>
        )}
      </div>
    </DeploymentSettingsLayout>
  );
}

function validate(form: SecurityForm | null) {
  if (!form) return [];
  const issues = [];
  if (
    !Number.isSafeInteger(form.dashboardSessionTtlSeconds) ||
    form.dashboardSessionTtlSeconds < 60 ||
    form.dashboardSessionTtlSeconds > 3600
  )
    issues.push(
      "Session TTL must be a whole number from 60 through 3600 seconds."
    );
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(form.dashboardCredentialRef))
    issues.push("Dashboard credential alias is invalid.");
  return issues;
}

function asError(value: unknown) {
  return value instanceof Error
    ? value
    : new Error("Unknown operator session error");
}

function infrastructureKeyStatus(
  credential: OperatorStatus["security"]["credentials"][number] | undefined
) {
  if (!credential || credential.state === "unknown")
    return "Status unavailable";
  if (credential.state === "overdue") return "Replacement overdue";
  if (credential.state === "due")
    return credential.lastRotatedAt ? "Replace soon" : "Never replaced";
  return "Up to date";
}

function PostureRow({
  label,
  value,
  detail,
  level,
}: {
  label: string;
  value: string;
  detail: string;
  level: SignalLevel;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-content-secondary">{detail}</div>
      </div>
      <HealthSignal level={level} label={value} compact />
    </div>
  );
}
