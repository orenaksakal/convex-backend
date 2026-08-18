import { useCallback, useRef, useState } from "react";
import { Button } from "@ui/Button";
import { Callout } from "@ui/Callout";
import { DeploymentSettingsLayout } from "@common/layouts/DeploymentSettingsLayout";
import { OperatorActionConfirmation } from "../../components/operator/OperatorActionConfirmation";
import { OperatorResourceFreshness } from "../../components/operator/OperatorResourceFreshness";
import { useOperatorResource } from "../../components/operator/useOperatorResource";
import {
  ApplicationOperations,
  ExecutedOperatorAction,
  OperatorMetadata,
  OperatorConfiguration,
  PreparedOperatorAction,
  operatorGet,
  operatorMutation,
} from "../../lib/operatorApi";
import {
  ApplicationImpersonationHandoff,
  safeApplicationHandoff,
} from "../../lib/applicationHandoff";

type ApplicationOperationsWithHandoff = ApplicationOperations & {
  impersonationHandoff: ApplicationImpersonationHandoff;
};

type PageData = {
  configuration: OperatorConfiguration;
  metadata: OperatorMetadata;
  operations: ApplicationOperationsWithHandoff;
};

export default function ApplicationOperationsPage() {
  const [data, setData] = useState<PageData | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [prepared, setPrepared] = useState<PreparedOperatorAction | null>(null);
  const [preparingKind, setPreparingKind] = useState<string | null>(null);
  const preparingRef = useRef(false);
  const [accepted, setAccepted] = useState<ExecutedOperatorAction | null>(null);
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [eventId, setEventId] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [showDatabaseDetails, setShowDatabaseDetails] = useState(false);

  const load = useCallback(async () => {
    const [configurationResponse, metadata] = await Promise.all([
      operatorGet<{ configuration: OperatorConfiguration }>(
        "/v1/configuration",
      ),
      operatorGet<OperatorMetadata>("/v1/metadata"),
    ]);
    if (!metadata.capabilities.applicationOperations.read) {
      throw new Error(
        "Application operations are not enabled for this deployment.",
      );
    }
    const response = await operatorGet<{
      operations: ApplicationOperationsWithHandoff;
    }>("/v1/application-operations");
    setData({
      configuration: configurationResponse.configuration,
      metadata,
      operations: response.operations,
    });
  }, []);
  const resource = useOperatorResource(load);

  async function prepare(
    kind: string,
    parameters: Record<string, unknown> = {},
  ) {
    if (!data || preparingRef.current) return;
    preparingRef.current = true;
    setPreparingKind(kind);
    setError(null);
    setAccepted(null);
    setHandoffUrl(null);
    setHandoffError(null);
    try {
      setPrepared(
        await operatorMutation<PreparedOperatorAction>(
          "/v1/actions/prepare",
          "POST",
          {
            kind,
            instanceId: data.configuration.instance.id,
            baseRevision: data.configuration.revision,
            parameters,
          },
        ),
      );
    } catch (requestError) {
      setError(asError(requestError));
    } finally {
      preparingRef.current = false;
      setPreparingKind(null);
    }
  }

  function actionEnabled(kind: string) {
    return data?.metadata.capabilities.actions[kind]?.enabled === true;
  }

  return (
    <DeploymentSettingsLayout page="operations">
      <div className="flex flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">Application operations</h3>
            <p className="max-w-3xl text-sm text-content-secondary">
              Instance-scoped PostgreSQL and auth-bridge evidence. Data rows
              remain in the Data view; this page is for operational signals and
              audited maintenance.
            </p>
          </div>
          <OperatorResourceFreshness
            label="Application evidence"
            lastUpdatedAt={resource.lastUpdatedAt}
            refreshing={resource.refreshing}
            error={resource.error}
            onRefresh={resource.refresh}
          />
        </header>

        {resource.loading && (
          <Panel
            title="Loading application evidence"
            detail="Querying this instance through its private operator."
          />
        )}
        {resource.error && (
          <Callout variant="error">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-medium">
                  Application evidence refresh failed
                </div>
                <div>{resource.error.message}</div>
              </div>
              <Button variant="neutral" onClick={() => void resource.refresh()}>
                Retry
              </Button>
            </div>
          </Callout>
        )}
        {error && (
          <Callout variant="error">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-medium">
                  Application operations unavailable
                </div>
                <div>{error.message}</div>
              </div>
              <Button variant="neutral" onClick={() => void resource.refresh()}>
                Retry
              </Button>
            </div>
          </Callout>
        )}
        {accepted && (
          <Callout variant="success">
            <div>
              Action <code>{accepted.kind}</code> was accepted for this
              instance. Evidence refreshes automatically to verify the result.
              {handoffUrl && (
                <div className="mt-2">
                  <a className="underline" href={handoffUrl} rel="noreferrer">
                    Continue through the one-use application handoff
                  </a>
                </div>
              )}
            </div>
          </Callout>
        )}
        {handoffError && <Callout variant="error">{handoffError}</Callout>}

        {data && !resource.loading && (
          <>
            <div className="grid min-w-0 gap-4 xl:grid-cols-2">
              <DatabaseSummary
                operations={data.operations}
                optimizeEnabled={actionEnabled("postgres-analyze")}
                repairEnabled={actionEnabled("postgres-reset-statistics")}
                preparingKind={preparingKind}
                onOptimize={() => void prepare("postgres-analyze")}
                onRepair={() => void prepare("postgres-reset-statistics")}
              />
              <AuthBridgeCard
                operations={data.operations}
                retryEnabled={
                  actionEnabled("auth-outbox-retry") &&
                  data.operations.authBridge.retrySupported
                }
                preparingKind={preparingKind}
                eventId={eventId}
                setEventId={setEventId}
                onRetry={() => void prepare("auth-outbox-retry", { eventId })}
              />
            </div>
            <Impersonation
              enabled={
                actionEnabled("impersonate-user") &&
                data.operations.impersonationHandoff?.enabled === true
              }
              preparing={preparingKind === "impersonate-user"}
              preparationBlocked={preparingKind !== null}
              email={userEmail}
              setEmail={setUserEmail}
              onPrepare={() =>
                void prepare("impersonate-user", {
                  email: userEmail,
                  returnPath: "/app",
                })
              }
            />
            {preparingKind !== null && (
              <p className="sr-only" role="status" aria-live="polite">
                {preparationStatus(preparingKind)}
              </p>
            )}
            <section className="overflow-hidden rounded-lg border bg-background-secondary">
              <Button
                variant="unstyled"
                className="w-full justify-start px-4 py-3 text-sm font-medium"
                onClick={() =>
                  setShowDatabaseDetails((currentValue) => !currentValue)
                }
                aria-expanded={showDatabaseDetails}
              >
                Database table details
              </Button>
              {showDatabaseDetails ? (
                <div className="grid gap-4 border-t p-4">
                  <TableFootprint tables={data.operations.tables} embedded />
                </div>
              ) : null}
            </section>
            {prepared && (
              <OperatorActionConfirmation
                prepared={prepared}
                onCancel={() => setPrepared(null)}
                onAccepted={(result) => {
                  const isImpersonation = result.kind === "impersonate-user";
                  const nextHandoffUrl = isImpersonation
                    ? safeApplicationHandoff(
                        result.result?.launchUrl,
                        data.operations.impersonationHandoff,
                      )
                    : null;
                  setPrepared(null);
                  setAccepted(result);
                  setHandoffUrl(nextHandoffUrl);
                  setHandoffError(
                    isImpersonation && !nextHandoffUrl
                      ? "The operator returned an application handoff that did not match this deployment's trusted origin and one-use URL contract. No link was opened."
                      : null,
                  );
                  void load();
                }}
              />
            )}
          </>
        )}
      </div>
    </DeploymentSettingsLayout>
  );
}

function DatabaseSummary({
  operations,
  optimizeEnabled,
  repairEnabled,
  preparingKind,
  onOptimize,
  onRepair,
}: {
  operations: ApplicationOperations;
  optimizeEnabled: boolean;
  repairEnabled: boolean;
  preparingKind: string | null;
  onOptimize: () => void;
  onRepair: () => void;
}) {
  const { database } = operations;
  const ratio =
    database.connections.max > 0
      ? (database.connections.total / database.connections.max) * 100
      : 0;
  const transactionTotal =
    database.transactions.committed + database.transactions.rolledBack;
  const commitRatio = transactionTotal
    ? (database.transactions.committed / transactionTotal) * 100
    : 100;
  const preparationBlocked = preparingKind !== null;
  return (
    <section
      className="min-w-0 rounded-xl border bg-background-secondary p-4"
      aria-labelledby="database-summary-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 id="database-summary-title" className="font-semibold">
            PostgreSQL
          </h4>
          <p className="text-sm text-content-secondary">
            {database.name} · observed {formatDate(operations.generatedAt)}
          </p>
        </div>
        <span className="rounded-full border bg-background-primary px-2 py-1 text-xs">
          {formatBytes(database.sizeBytes)}
        </span>
      </div>
      <div className="mt-5 grid gap-5">
        <MetricBar
          label="Connection capacity"
          value={`${database.connections.total} / ${database.connections.max}`}
          detail={`${database.connections.active} active now`}
          percent={ratio}
          tone={ratio >= 85 ? "danger" : ratio >= 70 ? "warning" : "accent"}
        />
        <MetricBar
          label="Cache efficiency"
          value={`${database.cacheHitRatio.toFixed(1)}%`}
          detail="Reads served without disk access"
          percent={database.cacheHitRatio}
          tone={database.cacheHitRatio < 90 ? "warning" : "success"}
        />
        <MetricBar
          label="Committed transactions"
          value={`${commitRatio.toFixed(1)}%`}
          detail={`${formatNumber(
            database.transactions.committed,
          )} committed · ${formatNumber(
            database.transactions.rolledBack,
          )} rolled back`}
          percent={commitRatio}
          tone={commitRatio < 95 ? "warning" : "success"}
        />
      </div>
      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-1 border-t pt-3 text-xs text-content-secondary">
        <span>{formatNumber(database.deadlocks)} deadlocks</span>
        <span>{formatBytes(database.tempBytes)} temporary data</span>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background-primary p-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">PostgreSQL maintenance</div>
          <div className="text-xs text-content-secondary">
            Optimize planner statistics or repair accumulated counters.
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="neutral"
            disabled={!optimizeEnabled || preparationBlocked}
            loading={preparingKind === "postgres-analyze"}
            onClick={onOptimize}
          >
            Optimize tables
          </Button>
          <Button
            variant="danger"
            disabled={!repairEnabled || preparationBlocked}
            loading={preparingKind === "postgres-reset-statistics"}
            onClick={onRepair}
          >
            Repair statistics
          </Button>
        </div>
        <p className="w-full text-xs text-content-secondary">
          Both actions are deployment-scoped, audited, and require typed
          confirmation before execution.
        </p>
      </div>
    </section>
  );
}

function AuthBridgeCard({
  operations,
  retryEnabled,
  preparingKind,
  eventId,
  setEventId,
  onRetry,
}: {
  operations: ApplicationOperations;
  retryEnabled: boolean;
  preparingKind: string | null;
  eventId: string;
  setEventId: (value: string) => void;
  onRetry: () => void;
}) {
  const bridge = operations.authBridge;
  const total = bridge.pending + bridge.deadLettered + bridge.delivered;
  const deliveredPercent = total ? (bridge.delivered / total) * 100 : 100;
  return (
    <section
      className="min-w-0 rounded-xl border bg-background-secondary p-4"
      aria-labelledby="auth-bridge-title"
    >
      <h4 id="auth-bridge-title" className="font-semibold">
        Better Auth → Convex bridge
      </h4>
      {!bridge.installed ? (
        <p className="mt-2 text-sm text-content-secondary">
          No <code>better_auth.auth_outbox</code> table was detected. This is
          normal for apps that do not use the bridge.
        </p>
      ) : (
        <>
          {bridge.variant === "legacy" ? (
            <Callout variant="instructions" className="mt-3">
              This app uses the legacy auth bridge. Delivery evidence is
              available, but this schema has no dead-letter state to repair
              from the fleet dashboard.
            </Callout>
          ) : null}
          <div className="mt-5">
            <MetricBar
              label="Delivery completion"
              value={`${deliveredPercent.toFixed(1)}%`}
              detail={`${formatNumber(
                bridge.delivered,
              )} delivered · ${formatNumber(bridge.pending)} pending`}
              percent={deliveredPercent}
              tone={
                bridge.deadLettered
                  ? "danger"
                  : bridge.pending
                    ? "warning"
                    : "success"
              }
            />
            <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
              <CompactMetric label="Pending" value={bridge.pending} />
              <CompactMetric label="Retrying" value={bridge.retrying} />
              <CompactMetric
                label="Dead-lettered"
                value={bridge.deadLettered}
                warning={bridge.deadLettered > 0}
              />
            </dl>
            {bridge.oldestPendingAt ? (
              <p className="mt-3 text-xs wrap-break-word text-content-secondary">
                Oldest pending event: {formatDate(bridge.oldestPendingAt)}
              </p>
            ) : null}
          </div>
          {retryEnabled && (
            <div className="mt-4 rounded-lg border bg-background-primary p-3">
              <div className="mb-3">
                <div className="text-sm font-medium">Repair auth delivery</div>
                <p className="text-xs text-content-secondary">
                  Release one exact dead-lettered event for another delivery
                  attempt. The repair is audited and requires typed
                  confirmation.
                </p>
              </div>
              <div className="flex max-w-xl flex-wrap items-end gap-2">
                <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm">
                  <span>Dead-lettered event ID</span>
                  <input
                    className="min-h-9 rounded-md border bg-background-primary px-3 font-mono"
                    value={eventId}
                    onChange={(event) => setEventId(event.target.value)}
                    inputMode="numeric"
                  />
                </label>
                <Button
                  variant="danger"
                  disabled={
                    !/^[1-9][0-9]*$/.test(eventId) || preparingKind !== null
                  }
                  loading={preparingKind === "auth-outbox-retry"}
                  onClick={onRetry}
                >
                  Prepare repair
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function TableFootprint({
  tables,
  embedded = false,
}: {
  tables: ApplicationOperations["tables"];
  embedded?: boolean;
}) {
  return (
    <section
      className={
        embedded
          ? "min-w-0"
          : "overflow-hidden rounded-lg border bg-background-secondary"
      }
      aria-labelledby="table-footprint-title"
    >
      <div className="p-4">
        <h4 id="table-footprint-title" className="font-semibold">
          Table footprint
        </h4>
        <p className="text-sm text-content-secondary">
          Better Auth tables only; Convex internal PostgreSQL tables are
          excluded. Browse application data from the Data view.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-y bg-background-tertiary text-xs tracking-wide text-content-secondary uppercase">
            <tr>
              <th className="px-4 py-2">Table</th>
              <th className="px-4 py-2">Estimated rows</th>
              <th className="px-4 py-2">Size</th>
              <th className="px-4 py-2">Analyzed</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {tables.map((table) => (
              <tr key={`${table.schema}.${table.name}`}>
                <td className="px-4 py-2 font-mono text-xs">
                  {table.schema}.{table.name}
                </td>
                <td className="px-4 py-2">
                  {formatNumber(table.estimatedRows)}
                </td>
                <td className="px-4 py-2">{formatBytes(table.sizeBytes)}</td>
                <td className="px-4 py-2 text-content-secondary">
                  {table.analyzedAt
                    ? formatDate(table.analyzedAt)
                    : "Not reported"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Impersonation({
  enabled,
  preparing,
  preparationBlocked,
  email,
  setEmail,
  onPrepare,
}: {
  enabled: boolean;
  preparing: boolean;
  preparationBlocked: boolean;
  email: string;
  setEmail: (value: string) => void;
  onPrepare: () => void;
}) {
  return (
    <section
      className="rounded-lg border bg-background-secondary p-4"
      aria-labelledby="impersonation-title"
    >
      <h4 id="impersonation-title" className="font-semibold">
        Application impersonation
      </h4>
      <p className="mt-1 max-w-3xl text-sm text-content-secondary">
        {enabled
          ? "Find the Better Auth account by email to create a reviewed, two-minute, one-use handoff. No reusable app credential is exposed to the dashboard."
          : "Impersonation needs an explicit application domain for this deployment. Set it from the Fleet deployment settings, then reconcile the operator."}
      </p>
      <div className="mt-4 flex max-w-xl flex-wrap items-end gap-2">
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm">
          <span>Email address</span>
          <input
            className="min-h-9 rounded-md border bg-background-primary px-3"
            type="email"
            autoComplete="off"
            placeholder="user@example.com"
            value={email}
            disabled={!enabled}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <Button
          variant="danger"
          disabled={
            !enabled ||
            preparationBlocked ||
            !email.trim() ||
            !email.includes("@")
          }
          loading={preparing}
          onClick={onPrepare}
        >
          Prepare impersonation
        </Button>
      </div>
    </section>
  );
}

function MetricBar({
  label,
  value,
  detail,
  percent,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  percent: number;
  tone: "accent" | "success" | "warning" | "danger";
}) {
  const width = Math.max(0, Math.min(100, percent));
  const toneClass = {
    accent: "bg-util-accent",
    success: "bg-util-success",
    warning: "bg-util-warning",
    danger: "bg-util-error",
  }[tone];
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-sm font-medium">{label}</span>
        <span className="shrink-0 font-semibold tabular-nums">{value}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-background-tertiary">
        <div
          className={`h-full rounded-full ${toneClass}`}
          style={{ width: `${width}%` }}
          role="img"
          aria-label={`${label}: ${value}`}
        />
      </div>
      <div className="mt-1 text-xs wrap-break-word text-content-secondary">
        {detail}
      </div>
    </div>
  );
}

function CompactMetric({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: number;
  warning?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-md bg-background-primary px-2 py-3">
      <dt className="truncate text-[10px] font-medium tracking-wide text-content-secondary uppercase">
        {label}
      </dt>
      <dd
        className={`mt-1 text-lg font-semibold tabular-nums ${
          warning ? "text-content-error" : ""
        }`}
      >
        {formatNumber(value)}
      </dd>
    </div>
  );
}
function Panel({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border bg-background-secondary p-4">
      <div className="font-medium">{title}</div>
      <div className="text-sm text-content-secondary">{detail}</div>
    </div>
  );
}
function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}
function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let amount = value;
  let index = -1;
  do {
    amount /= 1024;
    index += 1;
  } while (amount >= 1024 && index < units.length - 1);
  return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${units[index]}`;
}
function formatDate(value: string) {
  return new Date(value).toLocaleString();
}
function asError(value: unknown) {
  return value instanceof Error
    ? value
    : new Error("Unknown application operations error");
}

function preparationStatus(kind: string) {
  switch (kind) {
    case "postgres-analyze":
      return "Preparing table optimization confirmation.";
    case "postgres-reset-statistics":
      return "Preparing statistics repair confirmation.";
    case "auth-outbox-retry":
      return "Preparing auth delivery repair confirmation.";
    case "impersonate-user":
      return "Preparing application impersonation confirmation.";
    default:
      return "Preparing operator action confirmation.";
  }
}
