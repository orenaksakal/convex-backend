import {
  CheckCircledIcon,
  ChevronRightIcon,
  ClockIcon,
  CopyIcon,
  CrossCircledIcon,
  CubeIcon,
  ExclamationTriangleIcon,
  PlusIcon,
  ReloadIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { Button } from "@ui/Button";
import { Modal } from "@ui/Modal";
import { TextInput } from "@ui/TextInput";
import { cn } from "@ui/cn";
import { useRouter } from "next/router";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { EnvironmentBadge } from "../components/fleet/EnvironmentBadge";
import {
  HealthSignal,
  SignalLevel,
  TrafficLightLegend,
  signalForState,
} from "../components/operator/HealthSignal";
import {
  FleetBootstrap,
  FleetDeployment,
  FleetDeploymentHealth,
  FleetProject,
  cloneFleetDeployment,
  createFleetDeployment,
  createFleetProject,
  deleteFleetDeployment,
  deleteFleetProject,
  fleetBootstrap,
  fleetDeploymentHealth,
  retryFleetDeployment,
} from "../lib/fleetApi";

export default function FleetPage() {
  const router = useRouter();
  const [fleet, setFleet] = useState<FleetBootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [health, setHealth] = useState<Record<string, FleetDeploymentHealth>>(
    {},
  );
  const [create, setCreate] = useState<"project" | "deployment" | null>(null);
  const [deploymentAction, setDeploymentAction] = useState<{
    kind: "clone" | "delete";
    deployment: FleetDeployment;
  } | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<FleetProject | null>(
    null,
  );
  const refreshInFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(() => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const task = (async () => {
      setRefreshing(true);
      try {
        const nextFleet = await fleetBootstrap();
        setFleet(nextFleet);
        setError(null);
        const readyDeployments = nextFleet.deployments.filter(
          (deployment) => deployment.state === "ready",
        );
        const nextHealth = await Promise.all(
          readyDeployments.map((deployment) =>
            fleetDeploymentHealth(deployment.id),
          ),
        );
        setHealth(
          Object.fromEntries(
            nextHealth.map((item) => [item.deploymentId, item]),
          ),
        );
      } catch (caught) {
        setError(asError(caught).message);
      } finally {
        setRefreshing(false);
      }
    })().finally(() => {
      if (refreshInFlight.current === task) refreshInFlight.current = null;
    });
    refreshInFlight.current = task;
    return task;
  }, []);

  useEffect(() => void refresh(), [refresh]);
  useEffect(() => {
    if (router.query.create === "deployment") setCreate("deployment");
  }, [router.query.create]);

  const hasActiveOperations = fleet?.deployments.some((deployment) =>
    ["requested", "provisioning", "deleting"].includes(deployment.state),
  );
  useEffect(() => {
    if (!hasActiveOperations) return undefined;
    const timer = setInterval(() => void refresh(), 2500);
    return () => clearInterval(timer);
  }, [hasActiveOperations, refresh]);

  const selectedProject = useMemo(() => {
    if (!fleet?.projects.length) return null;
    const requested =
      typeof router.query.project === "string" ? router.query.project : null;
    return (
      fleet.projects.find((project) => project.slug === requested) ??
      fleet.projects[0]
    );
  }, [fleet, router.query.project]);
  const deployments =
    fleet?.deployments.filter(
      (deployment) => deployment.projectId === selectedProject?.id,
    ) ?? [];

  return (
    <div className="min-h-screen overflow-y-auto bg-background-primary text-content-primary">
      <FleetTopBar
        refreshing={refreshing}
        onRefresh={refresh}
        onCreateProject={() => setCreate("project")}
      />
      <main className="mx-auto grid w-full max-w-[1440px] gap-8 px-5 py-8 lg:grid-cols-[280px_minmax(0,1fr)] lg:px-10">
        <aside>
          <div className="mb-3 flex items-center justify-between px-2">
            <div className="text-[11px] font-semibold tracking-[0.18em] text-content-tertiary uppercase">
              Projects
            </div>
            <Button
              variant="unstyled"
              className="rounded-md p-1.5 hover:bg-background-tertiary"
              onClick={() => setCreate("project")}
              aria-label="Create project"
            >
              <PlusIcon />
            </Button>
          </div>
          <div className="flex flex-col gap-1">
            {fleet?.projects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                selected={project.id === selectedProject?.id}
              />
            ))}
          </div>
        </aside>

        <section className="min-w-0">
          {error ? <ErrorState message={error} onRetry={refresh} /> : null}
          {!error && !fleet ? <LoadingState /> : null}
          {!error && fleet ? (
            <FleetHealthOverview
              deployments={fleet.deployments}
              health={health}
            />
          ) : null}
          {!error && fleet && !selectedProject ? (
            <EmptyFleet onCreate={() => setCreate("project")} />
          ) : null}
          {selectedProject ? (
            <ProjectDeployments
              project={selectedProject}
              deployments={deployments}
              health={health}
              onCreate={() => setCreate("deployment")}
              onRefresh={refresh}
              onClone={(deployment) =>
                setDeploymentAction({ kind: "clone", deployment })
              }
              onDelete={(deployment) =>
                setDeploymentAction({ kind: "delete", deployment })
              }
              onDeleteProject={() => setProjectToDelete(selectedProject)}
            />
          ) : null}
        </section>
      </main>

      {create === "project" ? (
        <CreateProjectModal
          onClose={() => setCreate(null)}
          onCreated={async (project) => {
            await refresh();
            setCreate(null);
            void router.replace(
              `/fleet?project=${encodeURIComponent(project.slug)}`,
            );
          }}
        />
      ) : null}
      {create === "deployment" && selectedProject ? (
        <CreateDeploymentModal
          project={selectedProject}
          onClose={() => setCreate(null)}
          onCreated={async () => {
            await refresh();
            setCreate(null);
            void router.replace(
              `/fleet?project=${encodeURIComponent(selectedProject.slug)}`,
            );
          }}
        />
      ) : null}
      {deploymentAction?.kind === "clone" && fleet ? (
        <CloneDeploymentModal
          deployment={deploymentAction.deployment}
          projects={fleet.projects}
          onClose={() => setDeploymentAction(null)}
          onCreated={async (projectSlug) => {
            await refresh();
            setDeploymentAction(null);
            void router.replace(
              `/fleet?project=${encodeURIComponent(projectSlug)}`,
            );
          }}
        />
      ) : null}
      {deploymentAction?.kind === "delete" ? (
        <DeleteDeploymentModal
          deployment={deploymentAction.deployment}
          onClose={() => setDeploymentAction(null)}
          onDeleted={async () => {
            await refresh();
            setDeploymentAction(null);
          }}
        />
      ) : null}
      {projectToDelete ? (
        <DeleteProjectModal
          project={projectToDelete}
          onClose={() => setProjectToDelete(null)}
          onDeleted={async () => {
            await refresh();
            setProjectToDelete(null);
            void router.replace("/fleet");
          }}
        />
      ) : null}
    </div>
  );
}

(FleetPage as typeof FleetPage & { fleetPage: boolean }).fleetPage = true;

function FleetTopBar({
  refreshing,
  onRefresh,
  onCreateProject,
}: {
  refreshing: boolean;
  onRefresh(): void;
  onCreateProject(): void;
}) {
  return (
    <header className="sticky top-0 z-30 border-b bg-background-secondary/95 backdrop-blur-sm">
      <div className="mx-auto flex min-h-16 max-w-[1440px] items-center justify-between gap-4 px-5 lg:px-10">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-9 place-items-center rounded-xl border bg-background-primary shadow-sm">
            <CubeIcon className="size-5 text-content-accent" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">Convex Freedom</div>
            <div className="truncate text-[11px] tracking-[0.16em] text-content-tertiary uppercase">
              Private deployment fleet
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="neutral"
            size="sm"
            icon={
              <ReloadIcon
                className={cn("size-3.5", refreshing && "animate-spin")}
              />
            }
            onClick={onRefresh}
          >
            Refresh
          </Button>
          <Button size="sm" icon={<PlusIcon />} onClick={onCreateProject}>
            New project
          </Button>
        </div>
      </div>
    </header>
  );
}

function ProjectRow({
  project,
  selected,
}: {
  project: FleetProject;
  selected: boolean;
}) {
  return (
    <Button
      href={`/fleet?project=${encodeURIComponent(project.slug)}`}
      variant="unstyled"
      className={cn(
        "group flex w-full items-center gap-3 rounded-xl border p-3 text-left transition",
        selected
          ? "border-border-selected bg-background-secondary shadow-sm"
          : "border-transparent hover:border-border-transparent hover:bg-background-secondary",
      )}
    >
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-lg text-xs font-bold",
          selected
            ? "bg-util-accent text-white"
            : "bg-background-tertiary text-content-secondary",
        )}
      >
        {project.name.slice(0, 2).toUpperCase()}
      </span>
      <span className="min-w-0 grow">
        <span className="block truncate text-sm font-medium">
          {project.name}
        </span>
        <span className="block truncate text-xs text-content-tertiary">
          {project.deploymentCount ?? 0} deployments
        </span>
      </span>
      <ChevronRightIcon className="text-content-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
    </Button>
  );
}

function ProjectDeployments({
  project,
  deployments,
  health,
  onCreate,
  onRefresh,
  onClone,
  onDelete,
  onDeleteProject,
}: {
  project: FleetProject;
  deployments: FleetDeployment[];
  health: Record<string, FleetDeploymentHealth>;
  onCreate(): void;
  onRefresh(): Promise<void>;
  onClone(deployment: FleetDeployment): void;
  onDelete(deployment: FleetDeployment): void;
  onDeleteProject(): void;
}) {
  const ready = deployments.filter(
    (deployment) => deployment.state === "ready",
  ).length;
  const production = deployments.filter(
    (deployment) => deployment.type === "prod",
  ).length;
  return (
    <>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 text-[11px] font-semibold tracking-[0.2em] text-content-tertiary uppercase">
            Project
          </div>
          <h1 className="font-semibold tracking-tight">{project.name}</h1>
          <div className="mt-2 flex items-center gap-4 text-sm text-content-secondary">
            <span>
              {ready}/{deployments.length} ready
            </span>
            <span>{production} production</span>
            <span className="font-mono text-xs text-content-tertiary">
              {project.slug}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {deployments.length === 0 ? (
            <Button
              variant="neutral"
              icon={<TrashIcon />}
              onClick={onDeleteProject}
            >
              Delete project
            </Button>
          ) : null}
          <Button icon={<PlusIcon />} onClick={onCreate}>
            New deployment
          </Button>
        </div>
      </div>
      {deployments.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {deployments.map((deployment) => (
            <DeploymentCard
              key={deployment.id}
              deployment={deployment}
              health={health[deployment.id]}
              onRefresh={onRefresh}
              onClone={() => onClone(deployment)}
              onDelete={() => onDelete(deployment)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed bg-background-secondary/40 p-12 text-center">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl border bg-background-secondary">
            <CubeIcon className="size-6 text-content-secondary" />
          </div>
          <h2 className="font-semibold">No deployments yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-content-secondary">
            Create a PostgreSQL-backed development or production instance. Both
            use the same runtime and isolation model.
          </p>
          <Button className="mt-5" icon={<PlusIcon />} onClick={onCreate}>
            Create deployment
          </Button>
        </div>
      )}
    </>
  );
}

function DeploymentCard({
  deployment,
  health,
  onRefresh,
  onClone,
  onDelete,
}: {
  deployment: FleetDeployment;
  health?: FleetDeploymentHealth;
  onRefresh(): Promise<void>;
  onClone(): void;
  onDelete(): void;
}) {
  const ready = deployment.state === "ready";
  const deletionFailed =
    deployment.state === "failed" &&
    deployment.activeOperation?.kind === "deployment.delete";
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const signals = deploymentSignals(deployment, health);
  const operationalSignals = deploymentOperationalSignals(deployment, health);
  const operationalItems = deploymentOperationalItems(deployment, health);
  const operationalWarnings = operationalItems.filter(
    (item) => item.kind === "warning",
  );
  const recommendations = operationalItems.filter(
    (item) => item.kind === "recommendation",
  );
  return (
    <article className="group relative overflow-hidden rounded-2xl border bg-background-secondary p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div
        className={cn(
          "absolute inset-x-0 top-0 h-0.5",
          deployment.type === "prod" ? "bg-background-error" : "bg-util-accent",
        )}
      />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-3 flex items-center gap-2">
            <EnvironmentBadge type={deployment.type} />
            {deployment.isDefault ? (
              <span className="text-[10px] font-semibold tracking-[0.14em] text-content-tertiary uppercase">
                Default
              </span>
            ) : null}
          </div>
          <h2 className="truncate font-semibold">{deployment.name}</h2>
          <div className="mt-1 truncate font-mono text-xs text-content-tertiary">
            {deployment.reference}
          </div>
        </div>
        <StateIcon state={deployment.state} />
      </div>
      <div className="mt-6 border-y py-4">
        <div className="mb-3 text-[10px] font-semibold tracking-[0.14em] text-content-tertiary uppercase">
          Instance health
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {signals.map((signal) => (
            <div key={signal.label} className="min-w-0">
              <div className="mb-1 text-[10px] font-semibold tracking-wide text-content-tertiary uppercase">
                {signal.label}
              </div>
              <HealthSignal level={signal.level} label={signal.value} compact />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4">
        <div className="mb-2 text-[10px] font-semibold tracking-[0.14em] text-content-tertiary uppercase">
          Operational readiness
        </div>
        <div className="flex flex-wrap gap-3">
          {operationalSignals.map((signal) => (
            <div key={signal.label} className="min-w-0">
              <div className="mb-1 text-[10px] font-semibold tracking-wide text-content-tertiary uppercase">
                {signal.label}
              </div>
              <HealthSignal level={signal.level} label={signal.value} compact />
            </div>
          ))}
        </div>
      </div>
      {operationalWarnings.length ? (
        <OperationalItems
          title="Operational warnings"
          items={operationalWarnings}
        />
      ) : null}
      {recommendations.length ? (
        <OperationalItems title="Recommendations" items={recommendations} />
      ) : null}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 text-xs text-content-secondary">
          <span className="capitalize">{deployment.state}</span>
          {deployment.activeOperation?.currentStep ? (
            <span className="ml-1 text-content-tertiary">
              · {humanStep(deployment.activeOperation.currentStep)}
            </span>
          ) : null}
          {deployment.failure ? (
            <span className="block truncate text-content-errorSecondary">
              {deployment.failure.message}
            </span>
          ) : null}
          {retryError ? (
            <span className="block truncate text-content-errorSecondary">
              {retryError}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {ready ? (
            <Button
              variant="neutral"
              size="sm"
              icon={<CopyIcon />}
              onClick={onClone}
            >
              Clone
            </Button>
          ) : null}
          {ready || (deployment.state === "failed" && !deletionFailed) ? (
            <Button
              variant="neutral"
              size="sm"
              icon={<TrashIcon className="text-content-error" />}
              onClick={onDelete}
            >
              Delete
            </Button>
          ) : null}
          {ready && deployment.deploymentUrl ? (
            <Button
              href={`/?deployment=${encodeURIComponent(deployment.id)}`}
              variant="neutral"
              size="sm"
            >
              Open dashboard <ChevronRightIcon />
            </Button>
          ) : deployment.state === "failed" ? (
            <Button
              variant="neutral"
              size="sm"
              loading={retrying}
              onClick={async () => {
                setRetrying(true);
                setRetryError(null);
                try {
                  await retryFleetDeployment(deployment.id);
                  await onRefresh();
                } catch (caught) {
                  setRetryError(asError(caught).message);
                } finally {
                  setRetrying(false);
                }
              }}
            >
              {deployment.activeOperation?.kind === "deployment.delete"
                ? "Retry deletion"
                : "Retry provisioning"}
            </Button>
          ) : !ready ? (
            <Button variant="neutral" size="sm" disabled>
              {humanStep(deployment.state)}
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function OperationalItems({
  title,
  items,
}: {
  title: string;
  items: FleetOperationalItem[];
}) {
  return (
    <div className="mt-4 rounded-xl border bg-background-primary p-3">
      <div className="text-[10px] font-semibold tracking-[0.14em] text-content-tertiary uppercase">
        {title}
      </div>
      <div className="mt-2 space-y-2">
        {items.map((item) => (
          <div
            key={item.title}
            className="flex items-start justify-between gap-3 text-xs"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-medium text-content-primary">
                <span
                  className={cn(
                    "mt-px size-2 shrink-0 rounded-full",
                    item.level === "critical"
                      ? "bg-util-error"
                      : item.kind === "warning"
                      ? "bg-util-warning"
                      : "bg-util-accent",
                  )}
                  aria-hidden="true"
                />
                {item.title}
              </div>
              <p className="mt-0.5 pl-4 text-content-secondary">
                {item.detail}
              </p>
            </div>
            {item.href ? (
              <Button
                href={item.href}
                size="xs"
                variant="neutral"
                className="shrink-0"
              >
                Review
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function CreateProjectModal({
  onClose,
  onCreated,
}: {
  onClose(): void;
  onCreated(project: FleetProject): void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      const result = await createFleetProject({
        name,
        ...(slug ? { slug } : {}),
      });
      onCreated(result.project);
    } catch (caught) {
      setError(asError(caught).message);
      setLoading(false);
    }
  }
  return (
    <Modal
      onClose={onClose}
      title="Create project"
      description="Projects group development and production deployments."
    >
      <form className="flex flex-col gap-4 py-4" onSubmit={submit}>
        <TextInput
          id="fleet-project-name"
          label="Project name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
          required
        />
        <TextInput
          id="fleet-project-slug"
          label="Slug (optional)"
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          description="Generated from the name when omitted."
        />
        {error ? (
          <p role="alert" className="text-sm text-content-errorSecondary">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="neutral" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={loading} disabled={!name.trim()}>
            Create project
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CreateDeploymentModal({
  project,
  onClose,
  onCreated,
}: {
  project: FleetProject;
  onClose(): void;
  onCreated(): void;
}) {
  const [name, setName] = useState("");
  const [reference, setReference] = useState("");
  const [type, setType] = useState<"dev" | "prod">("dev");
  const [isDefault, setIsDefault] = useState(false);
  const [deploymentDomain, setDeploymentDomain] = useState("");
  const [siteDomain, setSiteDomain] = useState("");
  const [applicationDomain, setApplicationDomain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      await createFleetDeployment(project.slug, {
        name,
        type,
        isDefault: type === "prod" && isDefault,
        deploymentDomain,
        siteDomain,
        ...(applicationDomain ? { applicationDomain } : {}),
        ...(reference ? { reference } : {}),
      });
      onCreated();
    } catch (caught) {
      setError(asError(caught).message);
      setLoading(false);
    }
  }
  return (
    <Modal
      onClose={onClose}
      title="Create deployment"
      description={`Provision an isolated PostgreSQL-backed instance in ${project.name}.`}
    >
      <form className="flex flex-col gap-4 py-4" onSubmit={submit}>
        <div>
          <div className="mb-2 text-sm">Environment</div>
          <div className="grid grid-cols-2 gap-2">
            {(["dev", "prod"] as const).map((option) => (
              <Button
                key={option}
                variant="unstyled"
                className={cn(
                  "rounded-xl border p-3 text-left transition",
                  type === option
                    ? "border-border-selected bg-background-tertiary shadow-sm"
                    : "hover:bg-background-tertiary/50",
                )}
                onClick={() => {
                  setType(option);
                  if (option === "dev") setIsDefault(false);
                }}
              >
                <span className="flex items-center gap-2">
                  <EnvironmentBadge type={option} />
                  <span className="hidden text-sm font-medium sm:inline">
                    {option === "dev" ? "Development" : "Production"}
                  </span>
                </span>
                <span className="mt-2 block text-xs/relaxed text-content-secondary">
                  {option === "dev"
                    ? "24 connections · Optional backups · Alerts off"
                    : "128 connections · Required backups · Alert destination required"}
                </span>
              </Button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            id="fleet-deployment-name"
            label="Deployment name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            required
          />
          <TextInput
            id="fleet-deployment-reference"
            label="Reference (optional)"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            description="Examples: development or dev/oren."
          />
        </div>
        <div className="rounded-xl border bg-background-primary p-4">
          <div className="text-sm font-medium">Public domains</div>
          <p className="mt-1 text-xs/relaxed text-content-secondary">
            Both domains must already belong to an active zone in your
            Cloudflare account. Provisioning creates or updates their exact
            proxied A records and configures TLS automatically.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <TextInput
              id="fleet-deployment-domain"
              label="Convex API domain"
              value={deploymentDomain}
              onChange={(event) => setDeploymentDomain(event.target.value)}
              description="Clients, CLI, and WebSockets."
              placeholder="convex.example.com"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
            <TextInput
              id="fleet-site-domain"
              label="HTTP actions domain"
              value={siteDomain}
              onChange={(event) => setSiteDomain(event.target.value)}
              description="HTTP actions and hosted endpoints."
              placeholder="http.example.com"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </div>
          <div className="mt-4">
            <TextInput
              id="fleet-application-domain"
              label="Application domain (optional)"
              value={applicationDomain}
              onChange={(event) => setApplicationDomain(event.target.value)}
              description="Enables audited user impersonation handoffs to the app. Leave blank when this deployment has no application frontend."
              placeholder="app.example.com"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>
        </div>
        {type === "prod" ? (
          <div className="flex items-start gap-3 rounded-xl border bg-background-primary p-3 text-sm">
            <input
              id="fleet-deployment-default"
              aria-label="Default production deployment"
              type="checkbox"
              checked={isDefault}
              onChange={(event) => setIsDefault(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="block font-medium">
                Default production deployment
              </span>
              <span className="block text-xs text-content-secondary">
                Used as the project’s default production target.
              </span>
            </span>
          </div>
        ) : null}
        <div className="rounded-xl border bg-background-primary px-3 py-2 text-xs/relaxed text-content-secondary">
          Provisioning is resumable and never runs application migrations or
          imports data.
        </div>
        {error ? (
          <p role="alert" className="text-sm text-content-errorSecondary">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={loading}
            disabled={
              !name.trim() ||
              !deploymentDomain.trim() ||
              !siteDomain.trim() ||
              deploymentDomain.trim() === siteDomain.trim()
            }
          >
            Create {type} deployment
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CloneDeploymentModal({
  deployment,
  projects,
  onClose,
  onCreated,
}: {
  deployment: FleetDeployment;
  projects: FleetProject[];
  onClose(): void;
  onCreated(projectSlug: string): void;
}) {
  const [projectSlug, setProjectSlug] = useState(deployment.projectSlug);
  const [name, setName] = useState(`${deployment.name} copy`);
  const [reference, setReference] = useState(`${deployment.reference}-copy`);
  const [deploymentDomain, setDeploymentDomain] = useState("");
  const [siteDomain, setSiteDomain] = useState("");
  const [applicationDomain, setApplicationDomain] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await cloneFleetDeployment(deployment.id, {
        projectSlug,
        name,
        reference,
        deploymentDomain,
        siteDomain,
        ...(applicationDomain ? { applicationDomain } : {}),
        isDefault: deployment.type === "prod" && isDefault,
      });
      onCreated(projectSlug);
    } catch (caught) {
      setError(asError(caught).message);
      setLoading(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      title="Clone deployment"
      description={`Create a new isolated ${deployment.type} instance from ${deployment.name}.`}
    >
      <form className="flex flex-col gap-4 py-4" onSubmit={submit}>
        <div className="rounded-xl border bg-background-primary p-4">
          <div className="flex items-center gap-2">
            <CopyIcon className="text-content-accent" />
            <span className="text-sm font-medium">Configuration clone</span>
          </div>
          <p className="mt-2 text-xs/relaxed text-content-secondary">
            Copies the environment label, capacity, backup, alert, and insight
            policy. The new instance receives its own PostgreSQL database, R2
            buckets, credentials, and domains. Application data, files, modules,
            and secrets are not copied.
          </p>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span>Target project</span>
          <select
            className="min-h-9 rounded-md border bg-background-primary px-3 text-content-primary"
            value={projectSlug}
            onChange={(event) => setProjectSlug(event.target.value)}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.slug}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            id="fleet-clone-name"
            label="New deployment name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            required
          />
          <TextInput
            id="fleet-clone-reference"
            label="New reference"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            description="Must be unique in the target project."
            required
          />
        </div>
        <div className="rounded-xl border bg-background-primary p-4">
          <div className="text-sm font-medium">New public domains</div>
          <p className="mt-1 text-xs/relaxed text-content-secondary">
            Domains cannot be shared with the source. Cloudflare DNS and TLS are
            configured during provisioning.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <TextInput
              id="fleet-clone-deployment-domain"
              label="Convex API domain"
              value={deploymentDomain}
              onChange={(event) => setDeploymentDomain(event.target.value)}
              placeholder="convex-copy.example.com"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
            <TextInput
              id="fleet-clone-site-domain"
              label="HTTP actions domain"
              value={siteDomain}
              onChange={(event) => setSiteDomain(event.target.value)}
              placeholder="http-copy.example.com"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </div>
          <div className="mt-4">
            <TextInput
              id="fleet-clone-application-domain"
              label="New application domain (optional)"
              value={applicationDomain}
              onChange={(event) => setApplicationDomain(event.target.value)}
              description="Must identify the new app frontend. It is never inherited from the source deployment."
              placeholder="app-copy.example.com"
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>
        </div>
        {deployment.type === "prod" ? (
          <div className="flex items-start gap-3 rounded-xl border bg-background-primary p-3 text-sm">
            <input
              id="fleet-clone-default"
              aria-label="Make project default"
              type="checkbox"
              checked={isDefault}
              onChange={(event) => setIsDefault(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="block font-medium">Make project default</span>
              <span className="block text-xs text-content-secondary">
                Leave off when the target project already has a default
                production deployment.
              </span>
            </span>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-content-errorSecondary">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={loading}
            disabled={
              !name.trim() ||
              !reference.trim() ||
              !deploymentDomain.trim() ||
              !siteDomain.trim() ||
              deploymentDomain.trim() === siteDomain.trim()
            }
          >
            Clone as new instance
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteDeploymentModal({
  deployment,
  onClose,
  onDeleted,
}: {
  deployment: FleetDeployment;
  onClose(): void;
  onDeleted(): void;
}) {
  const confirmationPhrase = `delete ${deployment.projectSlug}/${deployment.reference}`;
  const adopted = deployment.observed?.adopted === true;
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await deleteFleetDeployment(deployment.id, confirmation);
      onDeleted();
    } catch (caught) {
      setError(asError(caught).message);
      setLoading(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      title={
        adopted ? "Remove adopted deployment" : "Delete deployment instance"
      }
      description={`${deployment.projectName ?? deployment.projectSlug} / ${
        deployment.name
      }`}
    >
      <form className="flex flex-col gap-4 py-4" onSubmit={submit}>
        <div className="rounded-xl border border-content-error/40 bg-background-error/10 p-4">
          <div className="flex items-start gap-3">
            <ExclamationTriangleIcon className="mt-0.5 size-5 shrink-0 text-content-error" />
            <div>
              <div className="font-semibold text-content-errorSecondary">
                {adopted
                  ? "This removes fleet access and management."
                  : "This permanently destroys the instance."}
              </div>
              {adopted ? (
                <p className="mt-2 text-sm/relaxed text-content-secondary">
                  This deployment was adopted, so its external runtime and data
                  are not fleet-owned and will remain running. Only its fleet
                  registration and shared-dashboard access are removed.
                </p>
              ) : (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm/relaxed text-content-secondary">
                  <li>Stops services and deletes the local runtime volume.</li>
                  <li>Deletes the isolated PostgreSQL database and role.</li>
                  <li>Deletes instance-owned data and export R2 buckets.</li>
                  <li>
                    Preserves retained archives in the shared backup bucket; the
                    instance-only backup credential is revoked.
                  </li>
                  <li>
                    Revokes scoped credentials and removes fleet-owned DNS and
                    routing.
                  </li>
                </ul>
              )}
            </div>
          </div>
        </div>
        {!adopted ? (
          <p className="text-sm/relaxed text-content-secondary">
            No backup is created automatically. Retention locks can pause
            deletion until protected objects expire; a failed teardown remains
            resumable from its last completed step.
          </p>
        ) : null}
        <div className="rounded-xl border bg-background-primary p-4">
          <p className="text-sm text-content-secondary">
            Copy and paste this exact text to confirm:
          </p>
          <code className="mt-2 block rounded-md bg-background-tertiary px-3 py-2 text-sm font-semibold text-content-primary select-all">
            {confirmationPhrase}
          </code>
          <div className="mt-4">
            <TextInput
              id="fleet-delete-confirmation"
              label="Confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
            />
          </div>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-content-errorSecondary">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="danger"
            loading={loading}
            disabled={confirmation !== confirmationPhrase}
          >
            {adopted ? "Remove from fleet" : "Delete instance permanently"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteProjectModal({
  project,
  onClose,
  onDeleted,
}: {
  project: FleetProject;
  onClose(): void;
  onDeleted(): void;
}) {
  const confirmationPhrase = `delete project ${project.slug}`;
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await deleteFleetProject(project.slug, confirmation);
      onDeleted();
    } catch (caught) {
      setError(asError(caught).message);
      setLoading(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      title="Delete empty project"
      description={`${project.name} · ${project.slug}`}
    >
      <form className="flex flex-col gap-4 py-4" onSubmit={submit}>
        <div className="rounded-xl border border-content-error/40 bg-background-error/10 p-4">
          <div className="flex items-start gap-3">
            <ExclamationTriangleIcon className="mt-0.5 size-5 shrink-0 text-content-error" />
            <div>
              <div className="font-semibold text-content-errorSecondary">
                This removes the project from the fleet.
              </div>
              <p className="mt-2 text-sm/relaxed text-content-secondary">
                Only a project with no active deployments can be deleted. No
                runtime, PostgreSQL database, R2 bucket, or DNS record is
                removed by this action. Historical records for deployments
                already deleted remain available for auditing.
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border bg-background-primary p-4">
          <p className="text-sm text-content-secondary">
            Copy and paste this exact text to confirm:
          </p>
          <code className="mt-2 block rounded-md bg-background-tertiary px-3 py-2 text-sm font-semibold text-content-primary select-all">
            {confirmationPhrase}
          </code>
          <div className="mt-4">
            <TextInput
              id="fleet-delete-project-confirmation"
              label="Confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
            />
          </div>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-content-errorSecondary">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="danger"
            loading={loading}
            disabled={confirmation !== confirmationPhrase}
          >
            Delete empty project
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function FleetHealthOverview({
  deployments,
  health,
}: {
  deployments: FleetDeployment[];
  health: Record<string, FleetDeploymentHealth>;
}) {
  const levels = deployments.map((deployment) =>
    deploymentHealthLevel(deployment, health[deployment.id]),
  );
  const critical = levels.filter((level) => level === "critical").length;
  const attention = levels.filter((level) => level === "attention").length;
  const healthy = levels.filter((level) => level === "healthy").length;
  const unknown = levels.filter((level) => level === "unknown").length;
  const overall: SignalLevel = critical
    ? "critical"
    : attention
    ? "attention"
    : unknown
    ? "unknown"
    : "healthy";
  const overallLabel =
    overall === "healthy"
      ? "Fleet healthy"
      : overall === "critical"
      ? `${critical} unavailable`
      : overall === "attention"
      ? `${attention} degraded`
      : `${unknown} unknown`;
  return (
    <section
      className="mb-8 overflow-hidden rounded-2xl border bg-background-secondary shadow-sm"
      aria-label="Fleet health"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div>
          <div className="text-[11px] font-semibold tracking-[0.18em] text-content-tertiary uppercase">
            Overall health
          </div>
          <HealthSignal level={overall} label={overallLabel} className="mt-2" />
          <p className="mt-2 max-w-2xl text-sm text-content-secondary">
            Instance health covers the active runtime, PostgreSQL, and object
            storage. Backups, recovery, security verification, credentials, and
            alert delivery are tracked separately and do not downgrade a working
            instance.
          </p>
        </div>
        <div className="grid grid-cols-4 gap-2 text-center">
          <FleetCount value={healthy} label="Healthy" level="healthy" />
          <FleetCount value={attention} label="Degraded" level="attention" />
          <FleetCount value={critical} label="Unavailable" level="critical" />
          <FleetCount value={unknown} label="Unknown" level="unknown" />
        </div>
      </div>
      <div className="border-t bg-background-primary/50 px-5 py-3">
        <TrafficLightLegend />
      </div>
    </section>
  );
}

function deploymentHealthLevel(
  deployment: FleetDeployment,
  evidence?: FleetDeploymentHealth,
): SignalLevel {
  if (deployment.state === "failed") return "critical";
  if (deployment.state !== "ready") return "unknown";
  if (evidence?.error || !evidence?.status) return "unknown";
  if (evidence.status.freshness.state === "stale") return "unknown";
  return signalForState(evidence.status.health.state);
}

function FleetCount({
  value,
  label,
  level,
}: {
  value: number;
  label: string;
  level: SignalLevel;
}) {
  return (
    <div className="min-w-16 rounded-xl border bg-background-primary px-3 py-2">
      <h3 className="font-semibold tabular-nums">{value}</h3>
      <HealthSignal
        level={level}
        label={label}
        compact
        className="border-0 bg-transparent px-0"
      />
    </div>
  );
}

function deploymentSignals(
  deployment: FleetDeployment,
  evidence?: FleetDeploymentHealth,
): Array<{ label: string; value: string; level: SignalLevel }> {
  const status = evidence?.status;
  const runtimeLevel = deploymentHealthLevel(deployment, evidence);
  return [
    {
      label: "Instance",
      value:
        deployment.state !== "ready"
          ? deployment.state
          : evidence?.error
          ? "Health unknown"
          : status?.freshness.state === "stale"
          ? "Health unknown"
          : status?.health.state === "unknown"
          ? "Monitoring incomplete"
          : status?.health.state ?? "Monitoring unavailable",
      level: runtimeLevel,
    },
    {
      label: "PostgreSQL",
      value:
        status?.providers.database.state === "unknown"
          ? "Probe unavailable"
          : status?.providers.database.state ?? "Probe unavailable",
      level: signalForState(status?.providers.database.state),
    },
    {
      label: "R2 storage",
      value:
        status?.providers.objectStorage.state === "unknown"
          ? "Probe unavailable"
          : status?.providers.objectStorage.state ?? "Probe unavailable",
      level: signalForState(status?.providers.objectStorage.state),
    },
  ];
}

function deploymentOperationalSignals(
  deployment: FleetDeployment,
  evidence?: FleetDeploymentHealth,
): Array<{ label: string; value: string; level: SignalLevel }> {
  const status = evidence?.status;
  const scheduler = status?.backups.scheduler;
  return [
    {
      label: "Backups",
      value:
        scheduler?.state === "failed"
          ? "Failed"
          : status?.backups.lastSuccessful?.verified
          ? "Verified"
          : deployment.desiredPolicy.backupRequired
          ? "Not verified"
          : "Optional",
      level:
        scheduler?.state === "failed"
          ? "critical"
          : status?.backups.lastSuccessful?.verified
          ? "healthy"
          : "unknown",
    },
  ];
}

type FleetOperationalItem = {
  title: string;
  detail: string;
  level: "attention" | "critical";
  kind: "warning" | "recommendation";
  href?: string;
};

function deploymentOperationalItems(
  deployment: FleetDeployment,
  evidence?: FleetDeploymentHealth,
): FleetOperationalItem[] {
  if (deployment.state === "failed") {
    return [
      {
        title: "Provisioning failed",
        detail:
          deployment.failure?.message ??
          "Retry the failed operation after reviewing its current step.",
        level: "critical",
        kind: "warning",
      },
    ];
  }
  if (deployment.state !== "ready") return [];
  if (evidence?.error || !evidence?.status) {
    return [
      {
        title: "Operator evidence is unavailable",
        detail:
          evidence?.error ??
          "The fleet manager could not retrieve this instance's health evidence.",
        level: "critical",
        kind: "warning",
      },
    ];
  }

  const status = evidence.status;
  const deploymentQuery = `deployment=${encodeURIComponent(deployment.id)}`;
  const issues: FleetOperationalItem[] = [];
  if (status.freshness.state === "stale") {
    issues.push({
      title: "Health evidence is stale",
      detail: `The last evidence is ${Math.round(
        status.freshness.ageSeconds / 60,
      )} minutes old; inspect the instance status timer.`,
      level: "attention",
      kind: "warning",
    });
  }
  if (status.runtime.restartPending) {
    issues.push({
      title: "A configuration restart is pending",
      detail:
        "The current instance remains available, but saved runtime changes are not fully effective yet.",
      level: "attention",
      kind: "recommendation",
      href: `/settings/runtime?${deploymentQuery}`,
    });
  }
  const scheduler = status.backups.scheduler;
  if (scheduler?.state === "failed") {
    issues.push({
      title: "Scheduled backups are failing",
      detail:
        scheduler.lastError ??
        "Review the scheduler and complete a verified manual backup.",
      level: "critical",
      kind: "warning",
      href: `/settings/backups?${deploymentQuery}`,
    });
  } else if (
    deployment.desiredPolicy.backupRequired &&
    !status.backups.lastSuccessful?.verified
  ) {
    issues.push({
      title: "Create the first verified backup",
      detail:
        "The instance is serving normally, but recovery is not protected by a verified archive yet.",
      level: "attention",
      kind: "recommendation",
      href: `/settings/backups?${deploymentQuery}`,
    });
  }
  if (status.release.state === "failed") {
    issues.push({
      title: "The last release attempt failed",
      detail:
        "The current runtime health is reported separately; review the failed release before retrying or rolling back.",
      level: "critical",
      kind: "warning",
    });
  }
  if (
    status.security.publicAdminReachable === true ||
    status.security.metricsPubliclyReachable === true
  ) {
    issues.push({
      title: "Administrative surface is publicly reachable",
      detail:
        "Restrict dashboard and metrics ingress immediately, then rerun the independent exposure probe.",
      level: "critical",
      kind: "warning",
      href: `/settings/security?${deploymentQuery}`,
    });
  } else if (
    status.security.publicAdminReachable === null ||
    status.security.metricsPubliclyReachable === null
  ) {
    issues.push({
      title: "External exposure is not independently verified",
      detail:
        "The instance is private by configuration, but no fresh off-host probe currently proves dashboard and metrics isolation.",
      level: "attention",
      kind: "recommendation",
      href: `/settings/security?${deploymentQuery}`,
    });
  }
  if (status.alerts.state === "firing") {
    issues.push({
      title: "An operational alert is firing",
      detail:
        status.alerts.reasons?.join(", ") ||
        "A configured operational threshold was crossed.",
      level: "critical",
      kind: "warning",
      href: `/settings/alerts?${deploymentQuery}`,
    });
  } else if (status.alerts.state === "delivery_failed") {
    issues.push({
      title: "Alert delivery failed",
      detail:
        status.alerts.lastError ??
        "Review the configured destination and send a test notification.",
      level: "critical",
      kind: "warning",
      href: `/settings/alerts?${deploymentQuery}`,
    });
  } else if (
    deployment.desiredPolicy.alertsEnabled &&
    status.alerts.state === "disabled"
  ) {
    issues.push({
      title: "Production alerts are not configured",
      detail:
        "Fleet policy expects alerting, but this operator has no active delivery destination.",
      level: "attention",
      kind: "recommendation",
      href: `/settings/alerts?${deploymentQuery}`,
    });
  }
  if (
    deployment.desiredPolicy.backupRequired &&
    status.backups.restoreDrill.state !== "passed"
  ) {
    issues.push({
      title:
        status.backups.restoreDrill.state === "failed"
          ? "Restore drill failed"
          : "Restore drill has not been proven",
      detail:
        status.backups.restoreDrill.state === "failed"
          ? "Inspect the isolated restore evidence before relying on this backup set."
          : "Run an isolated restore drill to prove that documents and files can be recovered.",
      level:
        status.backups.restoreDrill.state === "failed"
          ? "critical"
          : "attention",
      kind:
        status.backups.restoreDrill.state === "failed"
          ? "warning"
          : "recommendation",
      href: `/settings/backups?${deploymentQuery}`,
    });
  }
  const overdueCredentials = status.security.credentials.filter(
    (credential) => credential.state === "overdue",
  );
  const dueCredentials = status.security.credentials.filter(
    (credential) => credential.state === "due",
  );
  if (overdueCredentials.length || dueCredentials.length) {
    const affected = overdueCredentials.length
      ? overdueCredentials
      : dueCredentials;
    issues.push({
      title: overdueCredentials.length
        ? "Credential rotation policy is overdue"
        : "Credential rotation review recommended",
      detail: overdueCredentials.length
        ? `${affected.map((credential) => credential.kind).join(", ")} ${
            affected.length === 1 ? "credential is" : "credentials are"
          } outside the configured rotation window.`
        : `Review the recorded age for ${affected
            .map((credential) => credential.kind)
            .join(", ")}; this does not affect current instance availability.`,
      level: overdueCredentials.length ? "critical" : "attention",
      kind: overdueCredentials.length ? "warning" : "recommendation",
      href: `/settings/security?${deploymentQuery}`,
    });
  }
  return issues;
}

function StateIcon({ state }: { state: FleetDeployment["state"] }) {
  if (state === "ready")
    return <CheckCircledIcon className="size-5 text-green-600" />;
  if (state === "failed")
    return <CrossCircledIcon className="size-5 text-content-error" />;
  return <ClockIcon className="size-5 animate-pulse text-amber-600" />;
}
function EmptyFleet({ onCreate }: { onCreate(): void }) {
  return (
    <div className="rounded-3xl border bg-background-secondary p-12 shadow-sm">
      <div className="max-w-xl">
        <div className="mb-6 grid size-14 place-items-center rounded-2xl bg-util-accent text-white">
          <CubeIcon className="size-7" />
        </div>
        <h1 className="font-semibold tracking-tight">
          Your private Convex fleet starts here.
        </h1>
        <p className="mt-3 text-base/relaxed text-content-secondary">
          Create a project, then provision PostgreSQL-backed development and
          production deployments from one control plane.
        </p>
        <Button className="mt-6" icon={<PlusIcon />} onClick={onCreate}>
          Create first project
        </Button>
      </div>
    </div>
  );
}
function LoadingState() {
  return (
    <div className="grid min-h-80 place-items-center">
      <ReloadIcon className="size-6 animate-spin text-content-tertiary" />
    </div>
  );
}
function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry(): void;
}) {
  return (
    <div className="rounded-xl border border-content-error/30 bg-background-secondary p-5">
      <div className="font-medium text-content-errorSecondary">
        Fleet unavailable
      </div>
      <div className="mt-1 text-sm text-content-secondary">{message}</div>
      <Button className="mt-4" variant="neutral" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
function humanStep(value: string) {
  return value.replaceAll("-", " ");
}
function asError(value: unknown) {
  return value instanceof Error ? value : new Error(String(value));
}
