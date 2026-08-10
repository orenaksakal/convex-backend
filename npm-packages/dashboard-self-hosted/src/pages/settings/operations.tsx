import { useCallback, useEffect, useState } from "react";
import { Button } from "@ui/Button";
import { Callout } from "@ui/Callout";
import { DeploymentSettingsLayout } from "@common/layouts/DeploymentSettingsLayout";
import { OperatorActionConfirmation } from "../../components/operator/OperatorActionConfirmation";
import {
  ApplicationOperations,
  ExecutedOperatorAction,
  OperatorMetadata,
  OperatorConfiguration,
  PreparedOperatorAction,
  operatorGet,
  operatorMutation,
} from "../../lib/operatorApi";

type PageData = {
  configuration: OperatorConfiguration;
  metadata: OperatorMetadata;
  operations: ApplicationOperations;
};

export default function ApplicationOperationsPage() {
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [prepared, setPrepared] = useState<PreparedOperatorAction | null>(null);
  const [accepted, setAccepted] = useState<ExecutedOperatorAction | null>(null);
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null);
  const [eventId, setEventId] = useState("");
  const [userId, setUserId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
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
      const response = await operatorGet<{ operations: ApplicationOperations }>(
        "/v1/application-operations",
      );
      setData({
        configuration: configurationResponse.configuration,
        metadata,
        operations: response.operations,
      });
    } catch (requestError) {
      setError(asError(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  async function prepare(
    kind: string,
    parameters: Record<string, unknown> = {},
  ) {
    if (!data) return;
    setError(null);
    setAccepted(null);
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
    }
  }

  function actionEnabled(kind: string) {
    return data?.metadata.capabilities.actions[kind]?.enabled === true;
  }

  return (
    <DeploymentSettingsLayout page="operations">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h3 className="font-semibold">Application operations</h3>
          <p className="max-w-3xl text-sm text-content-secondary">
            Instance-scoped PostgreSQL and auth-bridge evidence. Data rows
            remain in the Data view; this page is for operational signals and
            audited maintenance.
          </p>
        </header>

        {loading && (
          <Panel
            title="Loading application evidence"
            detail="Querying this instance through its private operator."
          />
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
              <Button variant="neutral" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          </Callout>
        )}
        {accepted && (
          <Callout variant="success">
            <div>
              Action <code>{accepted.kind}</code> was accepted for this instance.
              Refresh to verify the resulting evidence.
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

        {data && !loading && (
          <>
            <DatabaseSummary operations={data.operations} />
            <AuthBridgeCard
              operations={data.operations}
              retryEnabled={actionEnabled("auth-outbox-retry")}
              eventId={eventId}
              setEventId={setEventId}
              onRetry={() => void prepare("auth-outbox-retry", { eventId })}
            />
            <TableFootprint tables={data.operations.tables} />
            <Maintenance
              analyzeEnabled={actionEnabled("postgres-analyze")}
              resetEnabled={actionEnabled("postgres-reset-statistics")}
              onAnalyze={() => void prepare("postgres-analyze")}
              onReset={() => void prepare("postgres-reset-statistics")}
            />
            {actionEnabled("impersonate-user") && (
              <Impersonation
                userId={userId}
                setUserId={setUserId}
                onPrepare={() =>
                  void prepare("impersonate-user", {
                    userId,
                    returnPath: "/app",
                  })
                }
              />
            )}
            {prepared && (
              <OperatorActionConfirmation
                prepared={prepared}
                onCancel={() => setPrepared(null)}
                onAccepted={(result) => {
                  setPrepared(null);
                  setAccepted(result);
                  setHandoffUrl(
                    safeApplicationHandoff(
                      result.result.launchUrl,
                      data.configuration.instance.siteUrl,
                    ),
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
}: {
  operations: ApplicationOperations;
}) {
  const { database } = operations;
  const ratio =
    database.connections.max > 0
      ? (database.connections.total / database.connections.max) * 100
      : 0;
  return (
    <section
      className="rounded-lg border bg-background-secondary p-4"
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
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Connections"
          value={`${database.connections.total} / ${database.connections.max}`}
          detail={`${database.connections.active} active · ${ratio.toFixed(
            1,
          )}% used`}
        />
        <Metric
          label="Cache hit ratio"
          value={`${database.cacheHitRatio.toFixed(2)}%`}
          detail="Cumulative database blocks"
        />
        <Metric
          label="Transactions"
          value={formatNumber(database.transactions.committed)}
          detail={`${formatNumber(
            database.transactions.rolledBack,
          )} rolled back`}
        />
        <Metric
          label="Deadlocks"
          value={formatNumber(database.deadlocks)}
          detail={`${formatBytes(database.tempBytes)} temporary data`}
        />
      </dl>
    </section>
  );
}

function AuthBridgeCard({
  operations,
  retryEnabled,
  eventId,
  setEventId,
  onRetry,
}: {
  operations: ApplicationOperations;
  retryEnabled: boolean;
  eventId: string;
  setEventId: (value: string) => void;
  onRetry: () => void;
}) {
  const bridge = operations.authBridge;
  return (
    <section
      className="rounded-lg border bg-background-secondary p-4"
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
          <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Pending"
              value={formatNumber(bridge.pending)}
              detail={
                bridge.oldestPendingAt
                  ? `Oldest ${formatDate(bridge.oldestPendingAt)}`
                  : "Queue is clear"
              }
            />
            <Metric
              label="Retrying"
              value={formatNumber(bridge.retrying)}
              detail="Previously failed, still eligible"
            />
            <Metric
              label="Dead-lettered"
              value={formatNumber(bridge.deadLettered)}
              detail="Requires an explicit retry"
            />
            <Metric
              label="Delivered"
              value={formatNumber(bridge.delivered)}
              detail="Retained delivery history"
            />
          </dl>
          {retryEnabled && (
            <div className="mt-4 flex max-w-xl flex-wrap items-end gap-2 border-t pt-4">
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
                variant="neutral"
                disabled={!/^[1-9][0-9]*$/.test(eventId)}
                onClick={onRetry}
              >
                Prepare retry
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function TableFootprint({
  tables,
}: {
  tables: ApplicationOperations["tables"];
}) {
  return (
    <section
      className="overflow-hidden rounded-lg border bg-background-secondary"
      aria-labelledby="table-footprint-title"
    >
      <div className="p-4">
        <h4 id="table-footprint-title" className="font-semibold">
          Table footprint
        </h4>
        <p className="text-sm text-content-secondary">
          Better Auth tables only; Convex internal PostgreSQL tables are excluded. Browse
          application data from the Data view.
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

function Maintenance({
  analyzeEnabled,
  resetEnabled,
  onAnalyze,
  onReset,
}: {
  analyzeEnabled: boolean;
  resetEnabled: boolean;
  onAnalyze: () => void;
  onReset: () => void;
}) {
  return (
    <section
      className="rounded-lg border bg-background-secondary p-4"
      aria-labelledby="maintenance-title"
    >
      <h4 id="maintenance-title" className="font-semibold">
        Reviewed maintenance
      </h4>
      <p className="mt-1 max-w-3xl text-sm text-content-secondary">
        Actions are scoped to this deployment, recorded in the operator audit
        log, and require exact typed confirmation.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="neutral"
          disabled={!analyzeEnabled}
          onClick={onAnalyze}
        >
                Analyze Better Auth tables
        </Button>
        <Button variant="danger" disabled={!resetEnabled} onClick={onReset}>
          Reset statistics counters
        </Button>
      </div>
    </section>
  );
}

function Impersonation({
  userId,
  setUserId,
  onPrepare,
}: {
  userId: string;
  setUserId: (value: string) => void;
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
        This app provides a reviewed one-use impersonation handoff. Enter the
        Better Auth user ID from the Data view; no reusable app credential is
        exposed to the dashboard.
      </p>
      <div className="mt-4 flex max-w-xl flex-wrap items-end gap-2">
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm">
          <span>User ID</span>
          <input
            className="min-h-9 rounded-md border bg-background-primary px-3 font-mono"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
          />
        </label>
        <Button variant="danger" disabled={!userId.trim()} onClick={onPrepare}>
          Prepare impersonation
        </Button>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border bg-background-primary p-3">
      <dt className="text-xs font-medium tracking-wide text-content-secondary uppercase">
        {label}
      </dt>
      <dd className="mt-1 font-semibold tabular-nums">{value}</dd>
      <dd className="mt-1 text-xs text-content-secondary">{detail}</dd>
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

function safeApplicationHandoff(value: unknown, siteUrl: string | null) {
  if (typeof value !== "string" || !siteUrl) return null;
  try {
    const expected = new URL(siteUrl);
    const candidate = new URL(value);
    return candidate.origin === expected.origin ? candidate.toString() : null;
  } catch {
    return null;
  }
}
