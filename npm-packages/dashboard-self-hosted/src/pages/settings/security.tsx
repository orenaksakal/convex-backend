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
  DeployCredential,
  ExecutedOperatorAction,
  IssuedDeployCredential,
  operatorGet,
  operatorMutation,
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

export default function SecurityPage() {
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
      "/v1/deploy-credentials",
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
        dashboardCredentialRef:
          result.current.security.dashboardCredentialRef,
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
          },
        ),
      );
    } catch (requestError) {
      setSessionError(asError(requestError));
    }
  }

  async function refreshDeployCredentials() {
    const result = await operatorGet<{ credentials: DeployCredential[] }>(
      "/v1/deploy-credentials",
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
        { label: deployLabel, expiresInDays: deployExpiryDays },
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
          { expiresInDays: deployExpiryDays },
        );
        setIssuedDeployCredential(issued);
      } else {
        await operatorMutation<DeployCredential>(
          `/v1/deploy-credentials/${deployConfirmation.credential.id}`,
          "DELETE",
        );
        setMessage(
          `Deploy credential ${deployConfirmation.credential.label} was revoked immediately.`,
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
  const credentialReferences = form
    ? [
        {
          label: "Dashboard signing",
          alias: form.dashboardCredentialRef,
          detail: "Five-minute deployment credentials issued by the operator",
        },
        {
          label: "PostgreSQL",
          alias: operator.configuration?.providers.database.credentialRef,
          detail: "Application database login selected on General",
        },
        {
          label: "Object storage",
          alias: operator.configuration?.providers.objectStorage.credentialRef,
          detail: "S3/R2 credential selected on General",
        },
      ]
    : [];

  return (
    <DeploymentSettingsLayout page="security">
      <div className="flex flex-col gap-6">
        <header>
          <h3 className="font-semibold">Security</h3>
          <p className="mt-1 max-w-prose text-sm text-content-secondary">
            Verify the private administration boundary and configure scoped
            dashboard sessions. Client-log exposure and edit confirmation are
            configured on General. Host firewall, proxy, TLS, and domain
            configuration remain deployment-layer controls.
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
            accepted. Refresh status after the host hook completes to verify
            the new rotation timestamp.
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
            <section
              className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
              aria-label="Security evidence"
            >
              <EvidenceCard
                label="Admin exposure"
                value={probeLabel(status?.security.publicAdminReachable)}
                detail={
                  status
                    ? `Checked ${formatOperatorDate(status.security.checkedAt)}`
                    : "No validated exposure probe"
                }
                warning={
                  !evidenceIsCurrent ||
                  status?.security.publicAdminReachable !== false
                }
              />
              <EvidenceCard
                label="Metrics exposure"
                value={probeLabel(status?.security.metricsPubliclyReachable)}
                detail="Metrics must remain on the private operator network"
                warning={
                  !evidenceIsCurrent ||
                  status?.security.metricsPubliclyReachable !== false
                }
              />
              <EvidenceCard
                label="Client-log redaction"
                value={
                  effectiveRedaction === true
                    ? "Effective"
                    : effectiveRedaction === false
                      ? "Disabled"
                      : "Unknown"
                }
                detail={`Declared ${operator.configuration.runtime.knobs.REDACT_LOGS_TO_CLIENT === true ? "enabled" : "disabled"} on General`}
                warning={
                  !evidenceIsCurrent ||
                  effectiveRedaction !==
                    (operator.configuration.runtime.knobs
                      .REDACT_LOGS_TO_CLIENT === true)
                }
              />
              <EvidenceCard
                label="Status freshness"
                value={status?.freshness.state ?? "Unavailable"}
                detail={
                  status
                    ? `${status.freshness.ageSeconds}s old; maximum ${status.freshness.maxAgeSeconds}s`
                    : "No validated status provider"
                }
                warning={!evidenceIsCurrent}
              />
            </section>

            {deployCredentialCapability?.read && (
              <section
                className="rounded-lg border bg-background-secondary p-4"
                aria-labelledby="deploy-credentials-title"
              >
                <h4 id="deploy-credentials-title" className="font-semibold">
                  CLI and CI deploy credentials
                </h4>
                <p className="mt-1 max-w-prose text-sm text-content-secondary">
                  Create credentials restricted by the backend to the single
                  <code className="mx-1">Deploy</code> operation. Revocation is
                  checked on every use. Secret values are shown once and are
                  never stored by the operator or browser.
                </p>

                <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
                  <OperatorField
                    label="Credential label"
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
                  <OperatorField
                    label="Expires in days"
                    description="1 through 365 days."
                  >
                    <input
                      className={operatorInputClasses}
                      type="number"
                      min={1}
                      max={365}
                      value={deployExpiryDays}
                      onChange={(event) =>
                        setDeployExpiryDays(Number(event.target.value))
                      }
                    />
                  </OperatorField>
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
                    Create credential
                  </Button>
                </div>

                {issuedDeployCredential && (
                  <Callout variant="success">
                    <div className="flex flex-col gap-2">
                      <div className="font-semibold">
                        Copy this secret now. It will not be shown again.
                      </div>
                      <code className="rounded-sm bg-background-tertiary p-3 text-xs break-all">
                        {issuedDeployCredential.token}
                      </code>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="xs"
                          onClick={() => {
                            void navigator.clipboard
                              .writeText(issuedDeployCredential.token)
                              .then(() =>
                                setMessage("Deploy credential copied to the clipboard."),
                              )
                              .catch((error) => setSessionError(asError(error)));
                          }}
                        >
                          Copy secret
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
                    <div id="deploy-confirmation-title" className="font-semibold">
                      Confirm {deployConfirmation.kind}
                    </div>
                    <p className="mt-1 text-content-secondary">
                      This immediately invalidates the existing credential.
                      {deployConfirmation.kind === "rotate"
                        ? " A replacement secret will be shown once."
                        : " Running deployments that still use it will fail."}
                    </p>
                    <label className="mt-3 flex max-w-xl flex-col gap-1">
                      <span>
                        Type <code>{`${deployConfirmation.kind} ${deployConfirmation.credential.id}`}</code>
                      </span>
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
                          ? "Rotate credential"
                          : "Revoke credential"}
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
                        <tr key={credential.id} className="border-b last:border-0">
                          <td className="p-3">
                            <div className="font-medium">{credential.label}</div>
                            <code className="text-xs text-content-secondary">
                              {credential.id}
                            </code>
                          </td>
                          <td className="p-3 font-mono text-xs">Deploy</td>
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
                          <td colSpan={6} className="p-4 text-content-secondary">
                            No deploy credentials. Create one for a trusted CLI
                            or CI workflow.
                          </td>
                        </tr>
                      )}
                      {deployCredentials === null && (
                        <tr>
                          <td colSpan={6} className="p-4 text-content-secondary">
                            Loading deploy credentials…
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section
              className="rounded-lg border bg-background-secondary p-4"
              aria-labelledby="credential-lifecycle-title"
            >
              <h4 id="credential-lifecycle-title" className="font-semibold">
                Credential lifecycle
              </h4>
              <p className="mt-1 max-w-prose text-sm text-content-secondary">
                Rotate only configured aliases through host-reviewed provider
                adapters. Existing secret values are never returned to this
                page.
              </p>
              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                {credentialReferences.map((reference) => {
                  const credential = reference.alias
                    ? status?.security.credentials.find(
                        (item) => item.alias === reference.alias,
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
                        <dt className="text-content-secondary">Alias</dt>
                        <dd className="truncate font-mono text-xs">
                          {reference.alias ?? "Not configured"}
                        </dd>
                        <dt className="text-content-secondary">State</dt>
                        <dd>{credential?.state ?? "Unknown"}</dd>
                        <dt className="text-content-secondary">Last rotated</dt>
                        <dd>
                          {credential?.lastRotatedAt
                            ? formatOperatorDate(credential.lastRotatedAt)
                            : "Unknown"}
                        </dd>
                        <dt className="text-content-secondary">Due</dt>
                        <dd>
                          {credential?.rotationDueAt
                            ? formatOperatorDate(credential.rotationDueAt)
                            : "Unknown"}
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
                        Rotate {reference.label.toLowerCase()} credential
                      </Button>
                    </div>
                  );
                })}
              </div>
              {!evidenceIsCurrent && (
                <Callout variant="error">
                  Credential lifecycle evidence is missing or stale. Rotation
                  controls may prepare an action, but no credential is current
                  until the host provider attests it.
                </Callout>
              )}
            </section>

            <section
              className="rounded-lg border bg-background-secondary p-4"
              aria-labelledby="security-policy-title"
            >
              <h4 id="security-policy-title" className="font-semibold">
                Dashboard security policy
              </h4>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <OperatorField
                  label="Session TTL seconds"
                  description="Scoped HttpOnly dashboard session; minimum 60 and maximum 3600 seconds."
                >
                  <input
                    className={operatorInputClasses}
                    type="number"
                    min={60}
                    max={3600}
                    value={form.dashboardSessionTtlSeconds}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        dashboardSessionTtlSeconds: Number(event.target.value),
                      })
                    }
                  />
                </OperatorField>
                <OperatorField
                  label="Dashboard credential alias"
                  description="Server-side secret-manager reference; the secret value is never returned."
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
                    Permanently disallowed by configuration validation. Exposure
                    probes above verify the deployment consequence.
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
      "Session TTL must be a whole number from 60 through 3600 seconds.",
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

function probeLabel(value: boolean | null | undefined) {
  if (value === false) return "Private";
  if (value === true) return "Publicly reachable";
  return "Unknown";
}
