import { joinUrlPath } from "@common/lib/helpers/joinUrlPath";

async function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const MAX_RETRIES = 3;
const MAX_RETRIES_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 5_000;

export type CheckDeploymentResult = {
  allowedOps: string[];
  isReadOnly: boolean;
  compatibilityId: string | null;
  capabilities: {
    snapshotCheckpointRepairExecute: boolean;
  };
} | null;

export async function checkDeploymentInfo(
  adminKey: string,
  deploymentUrl: string,
): Promise<CheckDeploymentResult> {
  let retries = 0;
  while (retries < MAX_RETRIES) {
    try {
      const resp = await fetch(
        joinUrlPath(deploymentUrl, "/api/check_admin_key"),
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Convex ${adminKey}`,
            "Convex-Client": "dashboard-0.0.0",
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
      if (resp.ok) {
        try {
          const body = await resp.json();
          if (
            !Array.isArray(body.allowedOps) ||
            !body.allowedOps.every(
              (operation: unknown) => typeof operation === "string",
            ) ||
            typeof body.isReadOnly !== "boolean" ||
            !(
              body.compatibilityId === null ||
              typeof body.compatibilityId === "string"
            ) ||
            body.capabilities === null ||
            typeof body.capabilities !== "object" ||
            typeof body.capabilities.snapshotCheckpointRepairExecute !==
              "boolean"
          ) {
            return null;
          }
          const requiredCompatibilityId =
            process.env.NEXT_PUBLIC_CONVEX_SELF_HOSTED_COMPATIBILITY_ID;
          if (
            requiredCompatibilityId &&
            body.compatibilityId !== requiredCompatibilityId
          ) {
            return null;
          }
          return {
            allowedOps: body.allowedOps,
            isReadOnly: body.isReadOnly,
            compatibilityId: body.compatibilityId,
            capabilities: {
              snapshotCheckpointRepairExecute:
                body.capabilities.snapshotCheckpointRepairExecute,
            },
          };
        } catch {
          return null;
        }
      }
    } catch {
      // Do nothing
    }
    await sleep(MAX_RETRIES_DELAY_MS);
    retries++;
  }
  return null;
}
