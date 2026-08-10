import { CaretSortIcon, CubeIcon, PlusIcon } from "@radix-ui/react-icons";
import { Menu, MenuLink } from "@ui/Menu";
import { useEffect, useMemo, useState } from "react";

import { EnvironmentBadge } from "./EnvironmentBadge";
import {
  FleetBootstrap,
  FleetDeployment,
  fleetBootstrap,
} from "../../lib/fleetApi";

export function FleetSwitcher({ deploymentUrl }: { deploymentUrl: string }) {
  const [fleet, setFleet] = useState<FleetBootstrap | null>(null);

  useEffect(() => {
    let active = true;
    void fleetBootstrap()
      .then((value) => {
        if (active) setFleet(value);
      })
      .catch(() => {
        if (active) setFleet(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const current = useMemo(
    () =>
      fleet?.deployments.find((deployment) =>
        sameOrigin(deployment.deploymentUrl, deploymentUrl),
      ),
    [deploymentUrl, fleet],
  );
  if (!fleet || !current) return null;
  const siblings = fleet.deployments.filter(
    (deployment) => deployment.projectId === current.projectId,
  );

  return (
    <div className="flex h-10 items-center rounded-full border bg-background-primary/70 shadow-sm">
      <Menu
        placement="bottom-start"
        buttonProps={{
          variant: "unstyled",
          className:
            "flex h-9 items-center gap-2 rounded-full px-3 text-sm font-semibold hover:bg-background-tertiary",
          icon: <CubeIcon className="size-4 text-content-secondary" />,
          children: (
            <>
              <span className="max-w-40 truncate">
                {current.projectName ?? current.projectSlug}
              </span>
              <CaretSortIcon />
            </>
          ),
        }}
      >
        <>
          {fleet.projects.map((project) => (
            <MenuLink
              key={project.id}
              href={`/fleet?project=${encodeURIComponent(project.slug)}`}
              selected={project.id === current.projectId}
            >
              <span className="min-w-44 truncate font-medium">
                {project.name}
              </span>
              <span className="ml-auto text-xs text-content-tertiary">
                {project.deploymentCount ?? 0}
              </span>
            </MenuLink>
          ))}
          <MenuLink href="/fleet">
            <PlusIcon /> Manage fleet
          </MenuLink>
        </>
      </Menu>
      <span className="text-content-tertiary" aria-hidden="true">
        /
      </span>
      <Menu
        placement="bottom-start"
        buttonProps={{
          variant: "unstyled",
          className:
            "flex h-9 items-center gap-2 rounded-full px-3 text-sm hover:bg-background-tertiary",
          children: (
            <>
              <EnvironmentBadge type={current.type} compact />
              <span className="max-w-40 truncate font-medium">
                {current.name}
              </span>
              <CaretSortIcon />
            </>
          ),
        }}
      >
        <>
          {siblings.map((deployment) => (
            <DeploymentMenuLink
              key={deployment.id}
              deployment={deployment}
              currentId={current.id}
            />
          ))}
          <MenuLink
            href={`/fleet?project=${encodeURIComponent(
              current.projectSlug,
            )}&create=deployment`}
          >
            <PlusIcon /> New deployment
          </MenuLink>
        </>
      </Menu>
    </div>
  );
}

function DeploymentMenuLink({
  deployment,
  currentId,
}: {
  deployment: FleetDeployment;
  currentId: string;
}) {
  const href =
    deployment.state === "ready" && deployment.deploymentUrl
      ? `/?deployment=${encodeURIComponent(deployment.id)}`
      : `/fleet?project=${encodeURIComponent(deployment.projectSlug)}`;
  return (
    <MenuLink href={href} selected={deployment.id === currentId}>
      <EnvironmentBadge type={deployment.type} compact />
      <span className="min-w-36 truncate">{deployment.name}</span>
      <span className="ml-auto text-xs text-content-tertiary capitalize">
        {deployment.state}
      </span>
    </MenuLink>
  );
}

function sameOrigin(left: string | null, right: string) {
  if (!left) return false;
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}
