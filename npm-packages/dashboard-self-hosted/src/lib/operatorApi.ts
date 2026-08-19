export type OperatorScalar = string | number | boolean | null;

export type KnobDefinition = {
  type: "integer" | "boolean";
  min?: number;
  max?: number;
  restartRequired: boolean;
  description: string;
};

export type OperatorConfiguration = {
  schemaVersion: 1;
  revision: number;
  updatedAt: string;
  instance: {
    id: string;
    displayName: string;
    deploymentUrl: string;
    siteUrl: string | null;
    applicationOrigin: string | null;
  };
  runtime: {
    profile: string;
    memoryMaxBytes: number;
    cpuQuota: null;
    knobs: Record<string, string | number | boolean>;
  };
  providers: {
    database: { kind: string; credentialRef: string | null };
    objectStorage: {
      kind: string;
      endpointAlias: string | null;
      credentialRef: string | null;
      fixedMultipartPartSizeBytes: number | null;
      maxMultipartObjectSizeBytes: number | null;
    };
  };
  backup: {
    enabled: boolean;
    schedule: string | null;
    destinationAlias: string | null;
    retentionDays: number;
    rpoHours: number;
    rtoHours: number;
  };
  alerts: {
    enabled: boolean;
    destinationAlias: string | null;
    lookbackMinutes: number;
    functionFailureWarningCount: number;
    functionFailureCriticalCount: number;
    permanentOccWarningCount: number;
    permanentOccCriticalCount: number;
    resourceLimitWarningCount: number;
    resourceLimitCriticalCount: number;
    containerRestartWarningCount: number;
    containerRestartCriticalCount: number;
    alertOnContainerUnhealthy: boolean;
    alertOnProviderUnavailable: boolean;
    alertOnBackupFailure: boolean;
  };
  insights: {
    lookbackHours: number;
    documentsReadLimit: number;
    bytesReadLimit: number;
    warningPercent: number;
    durableHistoryAlias: string | null;
  };
  security: {
    dashboardSessionTtlSeconds: number;
    dashboardCredentialRef: string;
    publicAdminEndpointsAllowed: false;
    dashboardEditConfirmation: boolean;
  };
  release: {
    desiredImageDigest: string | null;
    rollbackImageDigest: string | null;
  };
};

export type OperatorStatus = {
  schemaVersion: 1;
  instanceId: string;
  generatedAt: string;
  freshness: {
    state: "current" | "stale";
    ageSeconds: number;
    maxAgeSeconds: number;
  };
  health: { state: "healthy" | "degraded" | "unavailable" | "unknown" };
  runtime: {
    effectiveRevision: number | null;
    restartPending: boolean;
    observedAt: string;
    effectiveKnobs: Record<string, OperatorScalar> | null;
    metrics: Record<string, OperatorScalar>;
  };
  providers: {
    database: {
      kind: string;
      state: "healthy" | "degraded" | "unavailable" | "unknown";
      checkedAt: string;
    };
    objectStorage: {
      kind: string;
      state: "healthy" | "degraded" | "unavailable" | "unknown";
      checkedAt: string;
      effectiveMultipartPartSizeBytes: number | null;
      maximumObjectSizeBytes: number | null;
    };
  };
  backups: {
    lastSuccessful: OperatorArchive | null;
    archives: OperatorArchive[];
    restoreDrill: {
      state: "never" | "passed" | "failed" | "running" | "unknown";
      completedAt: string | null;
    };
    scheduler?: {
      state:
        | "disabled"
        | "idle"
        | "running"
        | "succeeded"
        | "failed"
        | "unknown";
      configurationRevision: number | null;
      lastEvaluatedAt: string | null;
      scheduledFor: string | null;
      lastError: string | null;
    };
  };
  release: {
    state:
      | "idle"
      | "preflight"
      | "canary"
      | "rolling_back"
      | "failed"
      | "unknown";
    backendImageDigest: string | null;
    dashboardImageDigest: string | null;
    rollbackImageDigest: string | null;
  };
  security: {
    publicAdminReachable: boolean | null;
    metricsPubliclyReachable: boolean | null;
    checkedAt: string;
    credentials: Array<{
      alias: string;
      kind: string;
      state: "current" | "due" | "overdue" | "unknown";
      lastRotatedAt: string | null;
      rotationDueAt: string | null;
    }>;
  };
  alerts: {
    state: "ok" | "firing" | "delivery_failed" | "disabled" | "unknown";
    lastDeliveryAt: string | null;
    checkedAt?: string;
    level?: "warning" | "critical" | "test" | null;
    reasons?: string[];
    metrics?: {
      lookbackMinutes: number;
      container: {
        running: boolean;
        status: string;
        health: string;
        oomKilled: boolean;
        restartCount: number;
      };
      convex: {
        completionCount: number;
        functionFailures: number;
        permanentOccFailures: number;
        resourceLimitFailures: number;
      };
      providers: { database: string; objectStorage: string };
      backup: {
        schedulerState: string;
        failed: boolean;
        lastSuccessfulAt: string | null;
      };
    } | null;
    lastError?: string | null;
  };
};

export type OperatorArchive = {
  id: string;
  sha256: string;
  sizeBytes: number;
  verified: boolean;
  completedAt: string;
};

export type OperatorMetadata = {
  apiVersion: number;
  runtimeProfile: string;
  profileDefaults: OperatorConfiguration["runtime"];
  knobDefinitions: Record<string, KnobDefinition>;
  capabilities: {
    configuration: { read: boolean; write: boolean };
    status: { read: boolean };
    insightsHistory: { read: boolean };
    dashboardToken: { issue: boolean };
    deployCredentials: { read: boolean; write: boolean };
    alertDestinations: { read: boolean; write: boolean };
    applicationOperations: {
      read: boolean;
      postgresMaintenance: boolean;
      authBridge: boolean;
    };
    actions: Record<string, { enabled: boolean }>;
  };
};

export type ApplicationOperations = {
  schemaVersion: 1;
  generatedAt: string;
  impersonationHandoff: {
    enabled: boolean;
    trustedOrigin: string | null;
    path: "/operator/impersonate" | null;
  };
  database: {
    name: string;
    sizeBytes: number;
    connections: { active: number; total: number; max: number };
    transactions: { committed: number; rolledBack: number };
    cacheHitRatio: number;
    deadlocks: number;
    tempBytes: number;
    statsResetAt: string | null;
  };
  tables: Array<{
    schema: string;
    name: string;
    estimatedRows: number;
    sizeBytes: number;
    analyzedAt: string | null;
  }>;
  authBridge: {
    installed: boolean;
    variant: "managed" | "legacy" | null;
    retrySupported: boolean;
    pending: number;
    retrying: number;
    deadLettered: number;
    delivered: number;
    oldestPendingAt: string | null;
  };
};

export type AlertDestinations = {
  schemaVersion: 1;
  instanceId: string;
  configured: boolean;
  updatedAt?: string;
  email: {
    enabled: boolean;
    host?: string;
    port?: number;
    secure?: boolean;
    username?: string;
    from?: string;
    to?: string;
    passwordConfigured: boolean;
  };
  telegram: { enabled: boolean; shoutrrUrlConfigured: boolean };
};

export type DeployCredential = {
  id: string;
  label: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  state: "active" | "expired" | "revoked";
  allowedOps: ["Deploy"];
};

export type IssuedDeployCredential = {
  credential: DeployCredential;
  token: string;
  revokedCredentialId?: string;
};

export type OperatorInsightsHistory = {
  sourceAlias: string;
  observedFileBytes: number;
  bytesRead: number;
  byteLimited: boolean;
  recordLimited: boolean;
  recordsDroppedByLimit: number;
  malformedRecords: number;
  nonExecutionRecords: number;
  recordsBeforeWindow: number;
  discardedPartialLines: number;
  readAt: string;
  events: unknown[];
};

export type PreparedOperatorAction = {
  token: string;
  action: {
    id: string;
    kind: string;
    instanceId: string;
    expiresAt: string;
    expectedDowntime: string;
    backupPrerequisite: Pick<
      OperatorArchive,
      "id" | "sha256" | "completedAt"
    > | null;
    archive: Pick<OperatorArchive, "id" | "sha256" | "sizeBytes"> | null;
    summary: string;
  };
};

export type ExecutedOperatorAction = {
  actionId: string;
  kind: string;
  acceptedAt: string;
  state: "queued" | "running" | "succeeded" | "failed";
  startedAt: string | null;
  completedAt: string | null;
  result: Record<string, unknown> | null;
  failure: { code: string; message: string } | null;
};

export class OperatorApiError extends Error {
  status: number;
  code: string;
  issues: string[];
  conflict?: { expected: number; actual: number };

  constructor(
    status: number,
    payload: {
      error?: { code?: string; message?: string };
      issues?: string[];
      conflict?: { expected: number; actual: number };
    },
  ) {
    super(
      payload.error?.message ??
        `Operator API request failed with status ${status}`,
    );
    this.name = "OperatorApiError";
    this.status = status;
    this.code = payload.error?.code ?? "unknown";
    this.issues = payload.issues ?? [];
    this.conflict = payload.conflict;
  }
}

let sessionRequest: Promise<void> | null = null;
let fleetDeploymentId: string | null = null;

export function selectFleetOperatorDeployment(deploymentId: string | null) {
  if (deploymentId !== null && !/^dep_[a-f0-9]{32}$/.test(deploymentId)) {
    throw new Error("Fleet deployment ID is invalid");
  }
  fleetDeploymentId = deploymentId;
  sessionRequest = null;
}

export function operatorActionScope() {
  return fleetDeploymentId ?? "standalone";
}

export async function operatorGet<T>(path: string): Promise<T> {
  return operatorRequest<T>(path, { method: "GET" });
}

export async function operatorMutation<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  return operatorRequest<T>(path, {
    method,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function operatorRequest<T>(
  path: string,
  init: RequestInit,
  mayRefreshSession = true,
): Promise<T> {
  const response = await fetch(operatorUrl(path), {
    ...init,
    credentials: "same-origin",
    headers: {
      ...init.headers,
      ...(fleetDeploymentId
        ? { "X-Convex-Fleet": "1" }
        : { "X-Convex-Operator": "1" }),
    },
  });
  if (response.status === 401 && mayRefreshSession) {
    await ensureOperatorSession();
    return operatorRequest<T>(path, init, false);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new OperatorApiError(response.status, payload);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function ensureOperatorSession() {
  if (fleetDeploymentId) return;
  if (!sessionRequest) {
    sessionRequest = (async () => {
      const response = await fetch(operatorUrl("/v1/browser-sessions"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-Convex-Operator": "1" },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new OperatorApiError(response.status, payload);
      }
    })().finally(() => {
      sessionRequest = null;
    });
  }
  return sessionRequest;
}

function operatorUrl(path: string) {
  if (fleetDeploymentId) {
    return `${fleetBase()}/v1/deployments/${encodeURIComponent(
      fleetDeploymentId,
    )}/operator${path}`;
  }
  const base = process.env.NEXT_PUBLIC_OPERATOR_API_PATH ?? "/operator";
  if (!base.startsWith("/") || base.startsWith("//") || base.includes("://")) {
    throw new Error(
      "NEXT_PUBLIC_OPERATOR_API_PATH must be a same-origin absolute path",
    );
  }
  if (!path.startsWith("/"))
    throw new Error("operator API path must start with /");
  return `${base.replace(/\/$/, "")}${path}`;
}

function fleetBase() {
  const base = process.env.NEXT_PUBLIC_FLEET_API_PATH ?? "/fleet";
  if (!base.startsWith("/") || base.startsWith("//") || base.includes("://")) {
    throw new Error(
      "NEXT_PUBLIC_FLEET_API_PATH must be a same-origin absolute path",
    );
  }
  return base.replace(/\/$/, "");
}
