// eslint-disable-next-line import/no-relative-packages
import "../../../@convex-dev/design-system/src/styles/shared.css";
// eslint-disable-next-line import/no-relative-packages
import "../../../dashboard-common/src/styles/globals.css";
import { AppProps } from "next/app";
import Head from "next/head";
import { useQuery } from "convex/react";
import udfs from "@common/udfs";
import { GearIcon } from "@radix-ui/react-icons";
import { ConvexLogo } from "@common/elements/ConvexLogo";
import { ToastContainer } from "@common/elements/ToastContainer";
import { ThemeConsumer } from "@common/elements/ThemeConsumer";
import { Favicon } from "@common/elements/Favicon";
import { ToggleTheme } from "@common/elements/ToggleTheme";
import { SelfHostedDisconnectOverlay } from "@common/features/disconnectOverlay/SelfHostedDisconnectOverlay";
import { Menu } from "@ui/Menu";
import { ThemeProvider } from "next-themes";
import React, { useEffect, useMemo, useState, useContext } from "react";
import { ErrorBoundary } from "components/ErrorBoundary";
import { DeploymentDashboardLayout } from "@common/layouts/DeploymentDashboardLayout";
import {
  DeploymentApiProvider,
  WaitForDeploymentApi,
  DeploymentInfo,
  DeploymentInfoContext,
} from "@common/lib/deploymentContext";
import { Tooltip } from "@ui/Tooltip";
import { checkDeploymentInfo } from "lib/checkDeploymentInfo";
import { ConvexCloudReminderToast } from "components/ConvexCloudReminderToast";
import { UIProvider } from "@ui/UIContext";
import Link from "next/link";
import { useRouter } from "next/router";
import { SelfHostedCommandPalette } from "components/SelfHostedCommandPalette";
import {
  OperatorConfiguration,
  operatorGet,
  operatorMutation,
  selectFleetOperatorDeployment,
} from "lib/operatorApi";
import { Button } from "@ui/Button";
import {
  BackendCapabilitiesContext,
  SelfHostedBackendCapabilities,
} from "lib/backendCapabilities";
import { SelfHostedSettingsContext } from "lib/selfHostedSettings";
import { FleetSwitcher } from "components/fleet/FleetSwitcher";
import { OperatorActionTray } from "components/operator/OperatorActionTracker";
import { OperatorEvidenceFreshness } from "components/operator/OperatorEvidenceFreshness";
import { OperatorStateProvider } from "components/operator/useOperatorState";
import {
  FleetDeployment,
  fleetBootstrap,
  issueFleetDashboardCredential,
} from "lib/fleetApi";
import { isFleetDeploymentId } from "lib/fleetSelection";

if (process.env.NEXT_PUBLIC_LOAD_MONACO_INTERNALLY === "true") {
  import("../lib/monacoInternalLoader").then((a) => a).catch(console.error);
}

/**
 * Wrapper component that consumes SelfHostedSettingsContext and passes
 * the settings to DeploymentDashboardLayout
 */
function DeploymentDashboardLayoutWrapper({
  children,
}: {
  children: JSX.Element;
}) {
  const { visiblePages } = useContext(SelfHostedSettingsContext);

  return (
    <DeploymentDashboardLayout visiblePages={visiblePages}>
      {children}
    </DeploymentDashboardLayout>
  );
}

function App({
  Component,
  pageProps: { deploymentUrl, ...pageProps },
}: AppProps & {
  pageProps: {
    deploymentUrl: string | null;
  };
}) {
  const isFleetPage = (Component as typeof Component & { fleetPage?: boolean })
    .fleetPage;
  return (
    <>
      <Head>
        <title>Convex Dashboard</title>
        <meta name="description" content="Manage your Convex apps" />
        <Favicon />
      </Head>
      <UIProvider Link={Link}>
        <ThemeProvider attribute="class" disableTransitionOnChange>
          <ThemeConsumer />
          <ToastContainer />
          <div className="flex h-screen flex-col">
            {isFleetPage ? (
              <Component {...pageProps} />
            ) : deploymentUrl ? (
              <DashboardSurface
                Component={Component}
                pageProps={pageProps}
                deploymentUrl={deploymentUrl}
              />
            ) : (
              <SharedFleetDashboard
                Component={Component}
                pageProps={pageProps}
              />
            )}
          </div>
        </ThemeProvider>
      </UIProvider>
    </>
  );
}

function DashboardSurface({
  Component,
  pageProps,
  deploymentUrl,
  deploymentId,
}: {
  Component: AppProps["Component"];
  pageProps: Record<string, unknown>;
  deploymentUrl: string;
  deploymentId?: string;
}) {
  return (
    <OperatorStateProvider>
      <DeploymentInfoProvider
        deploymentUrl={deploymentUrl}
        deploymentId={deploymentId}
      >
        <DeploymentApiProvider deploymentOverride="local">
          <WaitForDeploymentApi>
            <DeploymentDashboardLayoutWrapper>
              <>
                <Component {...pageProps} />
                <ConvexCloudReminderToast />
                <OperatorActionTray scope={deploymentId ?? "standalone"} />
              </>
            </DeploymentDashboardLayoutWrapper>
          </WaitForDeploymentApi>
        </DeploymentApiProvider>
      </DeploymentInfoProvider>
    </OperatorStateProvider>
  );
}

function SharedFleetDashboard({
  Component,
  pageProps,
}: {
  Component: AppProps["Component"];
  pageProps: Record<string, unknown>;
}) {
  const router = useRouter();
  const [deployment, setDeployment] = useState<FleetDeployment | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const queryDeployment = router.query.deployment;
  const requestedDeployment = isFleetDeploymentId(queryDeployment)
    ? queryDeployment
    : null;
  const invalidSelection =
    router.isReady &&
    queryDeployment !== undefined &&
    requestedDeployment === null;

  useEffect(() => {
    if (!router.isReady) return undefined;
    let active = true;
    const requested = requestedDeployment;
    if (!requested && queryDeployment !== undefined) {
      selectFleetOperatorDeployment(null);
      setDeployment(null);
      setError(new Error("The selected deployment ID is invalid"));
      return undefined;
    }
    if (!requested) {
      const fallback =
        deployment?.id ??
        window.sessionStorage.getItem("convex-fleet-deployment");
      if (isFleetDeploymentId(fallback)) {
        void router.replace(
          {
            pathname: router.pathname,
            query: { ...router.query, deployment: fallback },
          },
          undefined,
          { shallow: true },
        );
        return undefined;
      }
      window.location.replace("/fleet");
      return undefined;
    }
    setError(null);
    if (deployment?.id === requested) {
      selectFleetOperatorDeployment(requested);
      return undefined;
    }
    selectFleetOperatorDeployment(null);
    setDeployment(null);
    void fleetBootstrap()
      .then((fleet) => {
        const selected = fleet.deployments.find(
          (candidate) => candidate.id === requested,
        );
        if (
          !selected ||
          selected.state !== "ready" ||
          !selected.deploymentUrl
        ) {
          throw new Error("The selected deployment is not ready");
        }
        if (!active) return;
        window.sessionStorage.setItem("convex-fleet-deployment", selected.id);
        selectFleetOperatorDeployment(selected.id);
        setDeployment(selected);
      })
      .catch((caught) => {
        if (active) setError(asError(caught));
      });
    return () => {
      active = false;
    };
  }, [
    deployment?.id,
    queryDeployment,
    requestedDeployment,
    router,
    router.isReady,
    router.pathname,
  ]);

  if (invalidSelection) {
    return (
      <DeploymentSelectionError message="The selected deployment ID is invalid" />
    );
  }
  if (requestedDeployment && deployment?.id !== requestedDeployment) {
    return <DeploymentSelectionLoading />;
  }

  if (error) {
    return <DeploymentSelectionError message={error.message} />;
  }
  if (!deployment?.deploymentUrl) {
    return <DeploymentSelectionLoading />;
  }
  return (
    <DashboardSurface
      Component={Component}
      pageProps={pageProps}
      deploymentUrl={deployment.deploymentUrl}
      deploymentId={deployment.id}
    />
  );
}

function DeploymentSelectionLoading() {
  return (
    <div className="flex h-screen items-center justify-center text-sm text-content-secondary">
      Loading the selected deployment…
    </div>
  );
}

function DeploymentSelectionError({ message }: { message: string }) {
  return (
    <div className="flex h-screen items-center justify-center px-6 text-center">
      <div className="max-w-lg rounded-lg border bg-background-secondary p-5">
        <div className="font-medium">Deployment access failed</div>
        <div className="mt-1 text-sm text-content-secondary">{message}</div>
        <Button href="/fleet" className="mt-4" size="sm" variant="neutral">
          Return to fleet manager
        </Button>
      </div>
    </div>
  );
}

function normalizeUrl(url: string) {
  try {
    const parsedUrl = new URL(url);
    // remove trailing slash
    return parsedUrl.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

App.getInitialProps = async ({ ctx }: { ctx: { req?: any } }) => {
  // On server-side, get from process.env
  if (ctx.req) {
    // Note -- we can't use `ctx.req.url` when serving the dashboard statically,
    // so instead we'll read from query params on the client side.

    let deploymentUrl: string | null = null;
    if (process.env.NEXT_PUBLIC_DEPLOYMENT_URL) {
      deploymentUrl = normalizeUrl(process.env.NEXT_PUBLIC_DEPLOYMENT_URL);
    }
    return {
      pageProps: {
        deploymentUrl,
      },
    };
  }

  // On client-side navigation, get from window.__NEXT_DATA__
  const clientSideDeploymentUrl =
    window.__NEXT_DATA__?.props?.pageProps?.deploymentUrl ?? null;
  return {
    pageProps: {
      deploymentUrl: clientSideDeploymentUrl ?? null,
    },
  };
};

export default App;

const deploymentInfo: Omit<DeploymentInfo, "deploymentUrl" | "adminKey"> = {
  ok: true,
  addBreadcrumb: console.error,
  captureMessage: console.error,
  captureException: console.error,
  reportHttpError: (
    method: string,
    url: string,
    error: { code: string; message: string },
  ) => {
    console.error(
      `failed to request ${method} ${url}: ${error.code} - ${error.message} `,
    );
  },
  useCurrentTeam: () => ({
    id: 0,
    name: "Team",
    slug: "team",
  }),
  useTeamMembers: () => [],
  useTeamEntitlements: () => ({
    auditLogRetentionDays: -1,
    logStreamingEnabled: true,
    streamingExportEnabled: true,
  }),
  useCurrentUsageBanner: () => null,
  useCurrentProject: () => ({
    id: 0,
    name: "Project",
    slug: "project",
    teamId: 0,
  }),
  useCurrentDeployment: () => {
    return {
      id: 0,
      name: "self-hosted",
      deploymentType: "dev",
      projectId: 0,
      kind: "local",
      previewIdentifier: null,
      creator: 0,
      createTime: 0,
      port: 0,
      deviceName: "local",
      isActive: true,
    };
  },
  useIsProtectedDeployment: () => false,
  useHasProjectAdminPermissions: () => true,
  useHasCustomRole: () => false,
  useIsOperationAllowed: () => true,
  useIsDeploymentPaused: () => {
    const deploymentState = useQuery(udfs.deploymentState.deploymentState);
    return deploymentState?.state === "paused";
  },
  useProjectEnvironmentVariables: () => ({ configs: [] }),
  // no-op. don't send analytics in the self-hosted dashboard.
  useLogDeploymentEvent: () => () => {},
  workOSOperations: {
    useDeploymentWorkOSEnvironment: () => ({
      data: undefined,
      error: undefined,
    }),
    useTeamWorkOSIntegration: () => undefined,
    useWorkOSTeamHealth: () => undefined,
    useWorkOSEnvironmentHealth: () => ({ data: undefined, error: undefined }),
    useDisconnectWorkOSTeam: (_teamId?: string) => async () => undefined,
    useInviteWorkOSTeamMember: () => async () => undefined,
    useWorkOSInvitationEligibleEmails: () => undefined,
    useAvailableWorkOSTeamEmails: () => undefined,
    useProvisionWorkOSTeam: (_teamId?: string) => async () => undefined,
    useProvisionWorkOSEnvironment: (_deploymentName?: string) => async () =>
      undefined,
    useDeleteWorkOSEnvironment: (_deploymentName?: string) => async () =>
      undefined,
    useProjectWorkOSEnvironments: (_projectId?: number) => undefined,
    useGetProjectWorkOSEnvironment: (_projectId?: number, _clientId?: string) =>
      undefined,
    useCheckProjectEnvironmentHealth:
      (_projectId?: number, _clientId?: string) => async () =>
        null,
    useProvisionProjectWorkOSEnvironment:
      (_projectId?: number) => async (_body: { environmentName: string }) => ({
        workosEnvironmentId: "",
        workosEnvironmentName: "",
        workosClientId: "",
        workosApiKey: "",
        newlyProvisioned: false,
        userEnvironmentName: "",
      }),
    useDeleteProjectWorkOSEnvironment:
      (_projectId?: number) => async (_clientId: string) => ({
        workosEnvironmentId: "",
        workosEnvironmentName: "",
        workosTeamId: "",
      }),
  },
  CloudImport: ({ sourceCloudBackupId }: { sourceCloudBackupId: number }) => (
    <div>{sourceCloudBackupId}</div>
  ),
  TeamMemberLink: () => (
    <Tooltip tip="Identity management is not available in self-hosted deployments.">
      <div className="underline decoration-dotted underline-offset-4">
        An admin
      </div>
    </Tooltip>
  ),
  Link,
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => (
    <ErrorBoundary>{children}</ErrorBoundary>
  ),
  DisconnectOverlay: () => <SelfHostedDisconnectOverlay />,
  useTeamUsageState: () => "Default",
  useTeamPlanType: () => null,
  teamsURI: "",
  projectsURI: "",
  deploymentsURI: "",
  isSelfHosted: true,
  workosIntegrationEnabled: false,
  // Gated off until the usage limits feature ships; self-hosted has no
  // LaunchDarkly, so flip this to true at launch.
  usageLimitsEnabled: false,
  // Gated off until the feature ships; self-hosted has no LaunchDarkly, so
  // flip this to true at launch.
  copyEnvVarNameAndValueEnabled: false,
  connectionStateCheckIntervalMs: 2500,
};

function DeploymentInfoProvider({
  children,
  deploymentUrl,
  deploymentId,
}: {
  children: React.ReactNode;
  deploymentUrl: string | null;
  deploymentId?: string;
}) {
  const [credential, setCredential] = useState<DashboardCredential | null>(
    null,
  );
  const [credentialError, setCredentialError] = useState<Error | null>(null);
  const [credentialGeneration, setCredentialGeneration] = useState(0);
  const [visiblePages, setVisiblePages] = useState<string[] | undefined>(
    undefined,
  );
  const [dashboardEditConfirmation, setDashboardEditConfirmation] =
    useState(true);
  const [backendCapabilities, setBackendCapabilities] =
    useState<SelfHostedBackendCapabilities>({
      snapshotCheckpointRepairExecute: false,
    });

  // Memoize this so it can safely be passed into the context
  const settingsContextValue = useMemo(
    () => ({
      visiblePages,
      dashboardEditConfirmation,
      setDashboardEditConfirmation,
    }),
    [dashboardEditConfirmation, visiblePages],
  );

  useEffect(() => {
    let active = true;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let currentCredential: DashboardCredential | null = null;
    if (!deploymentUrl) {
      setCredentialError(
        new Error("NEXT_PUBLIC_DEPLOYMENT_URL is required for this dashboard"),
      );
      return;
    }

    const issue = async () => {
      try {
        const [issued, configurationResponse] = await Promise.all([
          deploymentId
            ? issueFleetDashboardCredential(deploymentId).then(
                (response) => response.credential,
              )
            : operatorMutation<DashboardCredential>(
                "/v1/dashboard-token",
                "POST",
              ),
          operatorGet<{ configuration: OperatorConfiguration }>(
            "/v1/configuration",
          ),
        ]);
        const expiresAt = Date.parse(issued.expiresAt);
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + 60_000) {
          throw new Error("Operator issued an already-expired dashboard token");
        }
        const checked = await checkDeploymentInfo(issued.token, deploymentUrl);
        if (!checked) {
          throw new Error(
            "The backend rejected the short-lived dashboard credential",
          );
        }
        if (!sameOperations(checked.allowedOps, issued.allowedOps)) {
          throw new Error(
            "Backend and operator disagree about dashboard token operations",
          );
        }
        if (!active) return;
        currentCredential = issued;
        setCredential(issued);
        setBackendCapabilities(checked.capabilities);
        setDashboardEditConfirmation(
          configurationResponse.configuration.security
            .dashboardEditConfirmation ?? true,
        );
        setCredentialError(null);
        setVisiblePages(undefined);
        refreshTimer = setTimeout(
          () => void issue(),
          Math.max(10_000, expiresAt - Date.now() - 60_000),
        );
      } catch (error) {
        if (!active) return;
        setCredentialError(asError(error));
        const currentExpiresAt = currentCredential
          ? Date.parse(currentCredential.expiresAt)
          : Number.NaN;
        if (
          currentCredential &&
          Number.isFinite(currentExpiresAt) &&
          currentExpiresAt > Date.now() + 5_000
        ) {
          refreshTimer = setTimeout(
            () => void issue(),
            Math.max(
              1_000,
              Math.min(10_000, currentExpiresAt - Date.now() - 5_000),
            ),
          );
        } else {
          currentCredential = null;
          setCredential(null);
          setBackendCapabilities({
            snapshotCheckpointRepairExecute: false,
          });
        }
      }
    };
    void issue();
    return () => {
      active = false;
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [credentialGeneration, deploymentId, deploymentUrl]);

  const finalValue: DeploymentInfo = useMemo(
    () =>
      ({
        ...deploymentInfo,
        ok: true,
        adminKey: credential?.token ?? "",
        deploymentUrl: deploymentUrl ?? "",
        useIsOperationAllowed: (operation: string) =>
          credential?.allowedOps.includes(operation) ?? false,
        useIsProtectedDeployment: () => dashboardEditConfirmation,
      }) as DeploymentInfo,
    [credential, dashboardEditConfirmation, deploymentUrl],
  );
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  if (!credential) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-6 px-6 text-center">
        <ConvexLogo />
        {credentialError ? (
          <div className="max-w-lg rounded-lg border bg-background-secondary p-4">
            <div className="font-medium">Private dashboard access failed</div>
            <div className="mt-1 text-sm text-content-secondary">
              {credentialError.message}
            </div>
            <Button
              className="mt-3"
              size="sm"
              variant="neutral"
              onClick={() => setCredentialGeneration((value) => value + 1)}
            >
              Retry credential issuance
            </Button>
          </div>
        ) : (
          <div className="text-sm text-content-secondary">
            Requesting a short-lived credential from the private operator…
          </div>
        )}
      </div>
    );
  }
  return (
    <>
      <Header deploymentUrl={deploymentUrl ?? ""} />
      <DeploymentInfoContext.Provider value={finalValue}>
        <BackendCapabilitiesContext.Provider value={backendCapabilities}>
          <SelfHostedSettingsContext.Provider value={settingsContextValue}>
            <SelfHostedCommandPalette visiblePages={visiblePages} />
            <ErrorBoundary>{children}</ErrorBoundary>
          </SelfHostedSettingsContext.Provider>
        </BackendCapabilitiesContext.Provider>
      </DeploymentInfoContext.Provider>
    </>
  );
}

function Header({ deploymentUrl }: { deploymentUrl: string }) {
  if (process.env.NEXT_PUBLIC_HIDE_HEADER) {
    return null;
  }

  return (
    <header className="-ml-1 scrollbar-none flex min-h-[56px] items-center justify-between gap-1 overflow-x-auto border-b bg-background-secondary pr-4 sm:gap-6">
      <div className="flex items-center gap-3">
        <Link
          href="/fleet"
          aria-label="Open fleet manager"
          className="rounded-lg transition-opacity hover:opacity-80"
        >
          <ConvexLogo height={64} width={192} />
        </Link>
        <FleetSwitcher deploymentUrl={deploymentUrl} />
      </div>
      <div className="flex items-center gap-2">
        <OperatorEvidenceFreshness />
        <span className="hidden w-32 sm:block" aria-hidden="true" />
        <Menu
          buttonProps={{
            icon: (
              <GearIcon className="size-7 rounded-sm p-1 text-content-primary hover:bg-background-tertiary" />
            ),
            variant: "unstyled",
            "aria-label": "Dashboard Settings",
          }}
          placement="bottom-end"
        >
          <ToggleTheme />
        </Menu>
      </div>
    </header>
  );
}

type DashboardCredential = {
  token: string;
  issuedAt: string;
  expiresAt: string;
  allowedOps: string[];
};

function sameOperations(left: string[], right: string[]) {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((operation, index) => operation === sortedRight[index])
  );
}

function asError(value: unknown) {
  return value instanceof Error
    ? value
    : new Error("Unknown dashboard credential error");
}
