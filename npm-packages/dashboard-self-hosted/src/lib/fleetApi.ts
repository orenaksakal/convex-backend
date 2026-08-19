export type FleetProject = {
  id: string;
  slug: string;
  name: string;
  deploymentCount?: number;
  devCount?: number;
  prodCount?: number;
};

export type FleetDeployment = {
  id: string;
  projectId: string;
  projectSlug: string;
  projectName?: string;
  reference: string;
  name: string;
  type: "dev" | "prod";
  isDefault: boolean;
  hostId: string;
  state:
    | "requested"
    | "provisioning"
    | "ready"
    | "failed"
    | "deleting"
    | "deleted";
  desiredPolicy: {
    profile: "development" | "production";
    postgresConnectionLimit: number;
    maxConcurrentQueries: number;
    maxConcurrentMutations: number;
    maxConcurrentV8Actions: number;
    maxConcurrentNodeActions: number;
    maxConcurrentSyncs: number;
    capacityEnvelope: {
      testedUsersPerApp: number;
      operatingReservePercent: number;
      planningUsersPerApp: number;
      testedAppCount: number;
      maxSubscriptionsPerQueryBucket: number;
    };
    backupRequired: boolean;
    backupSchedule: string | null;
    backupRetentionDays: number;
    alertsEnabled: boolean;
    insightsLookbackHours: number;
    publicRuntimeEnabled: boolean;
    deploymentDomain?: string;
    siteDomain?: string;
    applicationDomain?: string;
  };
  deploymentUrl: string | null;
  siteUrl: string | null;
  dashboardUrl: string | null;
  failure?: { code: string; message: string; step?: string | null } | null;
  observed?: { adopted?: boolean; [key: string]: unknown };
  activeOperation?: {
    id: string;
    kind?:
      | "deployment.provision"
      | "deployment.retry"
      | "deployment.reconfigure"
      | "deployment.delete";
    state: "queued" | "running" | "failed" | "succeeded";
    currentStep: string | null;
  } | null;
};

export type FleetBootstrap = {
  apiVersion: 1;
  projects: FleetProject[];
  deployments: FleetDeployment[];
};

export type FleetDeploymentHealth = {
  deploymentId: string;
  status: import("./operatorApi").OperatorStatus | null;
  error: string | null;
};

export class FleetApiError extends Error {
  status: number;
  code: string;
  requestId: string | null;

  constructor(
    status: number,
    payload: {
      error?: { code?: string; message?: string; requestId?: string };
    },
    responseRequestId: string | null = null,
  ) {
    super(
      payload.error?.message ??
        `Fleet API request failed with status ${status}`,
    );
    this.name = "FleetApiError";
    this.status = status;
    this.code = payload.error?.code ?? "unknown";
    this.requestId = payload.error?.requestId ?? responseRequestId;
  }
}

export function fleetBootstrap(): Promise<FleetBootstrap> {
  return fleetRequest("/v1/bootstrap", { method: "GET" });
}

export async function fleetDeploymentHealth(
  deploymentId: string,
): Promise<FleetDeploymentHealth> {
  try {
    const response = await fleetRequest<{
      status: import("./operatorApi").OperatorStatus;
    }>(
      `/v1/deployments/${encodeURIComponent(deploymentId)}/operator/v1/status`,
      { method: "GET" },
    );
    return { deploymentId, status: response.status, error: null };
  } catch (error) {
    return {
      deploymentId,
      status: null,
      error:
        error instanceof Error ? error.message : "Health evidence unavailable",
    };
  }
}

export function createFleetProject(
  input: { name: string; slug?: string },
  idempotencyKey: string,
) {
  return fleetRequest<{ project: FleetProject }>("/v1/projects", {
    method: "POST",
    headers: mutationHeaders(idempotencyKey),
    body: JSON.stringify(input),
  });
}

export function renameFleetProject(
  projectSlug: string,
  name: string,
  idempotencyKey: string,
) {
  return fleetRequest<{ project: FleetProject }>(
    `/v1/projects/${encodeURIComponent(projectSlug)}/rename`,
    {
      method: "POST",
      headers: mutationHeaders(idempotencyKey),
      body: JSON.stringify({ name }),
    },
  );
}

export function deleteFleetProject(
  projectSlug: string,
  idempotencyKey: string,
) {
  return fleetRequest<{ project: FleetProject; removed: true }>(
    `/v1/projects/${encodeURIComponent(projectSlug)}/delete`,
    {
      method: "POST",
      headers: mutationHeaders(idempotencyKey),
      body: JSON.stringify({}),
    },
  );
}

export function createFleetDeployment(
  projectSlug: string,
  input: {
    name: string;
    reference?: string;
    type: "dev" | "prod";
    isDefault?: boolean;
    deploymentDomain: string;
    siteDomain: string;
    applicationDomain?: string;
  },
  idempotencyKey: string,
) {
  return fleetRequest<{
    deployment: FleetDeployment;
    operation: { id: string; state: string };
  }>(`/v1/projects/${encodeURIComponent(projectSlug)}/deployments`, {
    method: "POST",
    headers: mutationHeaders(idempotencyKey),
    body: JSON.stringify(input),
  });
}

export function adoptFleetDeployment(
  projectSlug: string,
  input: {
    name: string;
    reference?: string;
    type: "dev" | "prod";
    isDefault?: boolean;
    hostId?: string;
    deploymentUrl: string;
    siteUrl?: string | null;
    dashboardUrl: string;
    operatorUrl: string;
    databaseBindingAlias: string;
  },
  idempotencyKey: string,
) {
  return fleetRequest<{ deployment: FleetDeployment }>(
    `/v1/projects/${encodeURIComponent(projectSlug)}/deployments/adopt`,
    {
      method: "POST",
      headers: mutationHeaders(idempotencyKey),
      body: JSON.stringify(input),
    },
  );
}

export function reconfigureFleetDeploymentDomains(
  deploymentId: string,
  input: {
    applicationDomain: string;
    deploymentDomain: string;
    siteDomain: string;
  },
  idempotencyKey: string,
) {
  return fleetRequest<{
    deployment: FleetDeployment;
    operation: {
      id: string;
      kind: "deployment.reconfigure";
      state: string;
    } | null;
  }>(`/v1/deployments/${encodeURIComponent(deploymentId)}/domains`, {
    method: "POST",
    headers: mutationHeaders(idempotencyKey),
    body: JSON.stringify(input),
  });
}

export function retryFleetDeployment(
  deploymentId: string,
  idempotencyKey: string,
) {
  return fleetRequest<{
    deployment: FleetDeployment;
    operation: { id: string; state: string; completedSteps: string[] };
  }>(`/v1/deployments/${encodeURIComponent(deploymentId)}/retry`, {
    method: "POST",
    headers: mutationHeaders(idempotencyKey),
    body: JSON.stringify({}),
  });
}

export function renameFleetDeployment(
  deploymentId: string,
  name: string,
  idempotencyKey: string,
) {
  return fleetRequest<{ deployment: FleetDeployment }>(
    `/v1/deployments/${encodeURIComponent(deploymentId)}/rename`,
    {
      method: "POST",
      headers: mutationHeaders(idempotencyKey),
      body: JSON.stringify({ name }),
    },
  );
}

export function cloneFleetDeployment(
  deploymentId: string,
  input: {
    name: string;
    reference: string;
    projectSlug?: string;
    isDefault?: boolean;
    deploymentDomain: string;
    siteDomain: string;
    applicationDomain?: string;
  },
  idempotencyKey: string,
) {
  return fleetRequest<{
    deployment: FleetDeployment;
    operation: { id: string; kind: string; state: string };
  }>(`/v1/deployments/${encodeURIComponent(deploymentId)}/clone`, {
    method: "POST",
    headers: mutationHeaders(idempotencyKey),
    body: JSON.stringify(input),
  });
}

export function deleteFleetDeployment(
  deploymentId: string,
  idempotencyKey: string,
) {
  return fleetRequest<{
    deployment: FleetDeployment;
    operation: { id: string; kind: string; state: string } | null;
    resourcesDeleted: boolean;
  }>(`/v1/deployments/${encodeURIComponent(deploymentId)}/delete`, {
    method: "POST",
    headers: mutationHeaders(idempotencyKey),
    body: JSON.stringify({}),
  });
}

export function issueFleetDashboardCredential(deploymentId: string) {
  return fleetRequest<{
    deployment: Pick<
      FleetDeployment,
      | "id"
      | "projectSlug"
      | "reference"
      | "name"
      | "type"
      | "deploymentUrl"
      | "siteUrl"
    >;
    credential: {
      token: string;
      issuedAt: string;
      expiresAt: string;
      allowedOps: string[];
    };
  }>(`/v1/deployments/${encodeURIComponent(deploymentId)}/dashboard-token`, {
    method: "POST",
  });
}

async function fleetRequest<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(fleetUrl(path), {
    ...init,
    credentials: "same-origin",
    headers: { ...init.headers, "X-Convex-Fleet": "1" },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new FleetApiError(
      response.status,
      payload,
      response.headers.get("x-request-id"),
    );
  }
  return response.json() as Promise<T>;
}

function mutationHeaders(idempotencyKey: string) {
  if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    throw new Error("Fleet mutation idempotency key is invalid");
  }
  return {
    "Content-Type": "application/json",
    "Idempotency-Key": idempotencyKey,
  };
}

function fleetUrl(path: string) {
  const base = process.env.NEXT_PUBLIC_FLEET_API_PATH ?? "/fleet";
  if (!base.startsWith("/") || base.startsWith("//") || base.includes("://")) {
    throw new Error(
      "NEXT_PUBLIC_FLEET_API_PATH must be a same-origin absolute path",
    );
  }
  if (!path.startsWith("/"))
    throw new Error("fleet API path must start with /");
  return `${base.replace(/\/$/, "")}${path}`;
}
