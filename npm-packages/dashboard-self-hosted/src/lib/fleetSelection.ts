const DEPLOYMENT_ID = /^dep_[a-f0-9]{32}$/;

export function isFleetDeploymentId(value: unknown): value is string {
  return typeof value === "string" && DEPLOYMENT_ID.test(value);
}

export function fleetDeploymentHref(href: string, deploymentId: string) {
  if (!isFleetDeploymentId(deploymentId)) {
    throw new Error("Fleet deployment ID is invalid");
  }
  const parsed = new URL(href, "https://dashboard.local");
  if (parsed.origin !== "https://dashboard.local") {
    throw new Error("Fleet dashboard navigation must stay same-origin");
  }
  parsed.searchParams.set("deployment", deploymentId);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
