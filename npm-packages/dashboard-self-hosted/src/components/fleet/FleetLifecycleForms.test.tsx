import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  adoptFleetDeployment,
  reconfigureFleetDeploymentDomains,
  renameFleetDeployment,
  renameFleetProject,
} from "../../lib/fleetApi";
import {
  AdoptDeploymentModal,
  ReconfigureDomainsModal,
  RenameFleetResourceModal,
} from "../../pages/fleet";

jest.mock("../../lib/fleetApi", () => ({
  ...jest.requireActual("../../lib/fleetApi"),
  adoptFleetDeployment: jest.fn(),
  reconfigureFleetDeploymentDomains: jest.fn(),
  renameFleetDeployment: jest.fn(),
  renameFleetProject: jest.fn(),
}));

const adoptMock = jest.mocked(adoptFleetDeployment);
const reconfigureMock = jest.mocked(reconfigureFleetDeploymentDomains);
const renameDeploymentMock = jest.mocked(renameFleetDeployment);
const renameProjectMock = jest.mocked(renameFleetProject);
const project = {
  id: "prj_example",
  slug: "example",
  name: "Example",
};

beforeEach(() => {
  jest
    .spyOn(globalThis.crypto, "randomUUID")
    .mockReturnValue("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
});

afterEach(() => jest.restoreAllMocks());

test("adoption reviews the target and reuses its intent on retry", async () => {
  adoptMock
    .mockRejectedValueOnce(new Error("Response was lost"))
    .mockResolvedValueOnce({ deployment: {} as never });
  const onAdopted = jest.fn();
  render(
    <AdoptDeploymentModal
      project={project}
      onClose={jest.fn()}
      onAdopted={onAdopted}
    />,
  );

  change("Deployment name", "Production");
  change("Reference", "production");
  change("Convex API URL", "https://convex.example.com");
  change("Dashboard URL", "https://dashboard.example.com");
  change("Private operator URL", "http://operator:7790");
  change("Database backup binding", "example-production");

  const submit = screen.getByRole("button", {
    name: "Register external deployment",
  });
  fireEvent.click(submit);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Response was lost",
  );
  fireEvent.click(submit);

  await waitFor(() => expect(onAdopted).toHaveBeenCalledTimes(1));
  expect(adoptMock).toHaveBeenCalledTimes(2);
  expect(adoptMock.mock.calls[0][2]).toBe(adoptMock.mock.calls[1][2]);
});

test("domain changes reuse their intent across a retry", async () => {
  reconfigureMock
    .mockRejectedValueOnce(new Error("Response was lost"))
    .mockResolvedValueOnce({ deployment: {} as never, operation: null });
  const onQueued = jest.fn();
  render(
    <ReconfigureDomainsModal
      deployment={
        {
          id: "dep_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          projectSlug: "example",
          reference: "production",
          name: "Production",
          desiredPolicy: {
            applicationDomain: "example.com",
            deploymentDomain: "convex.example.com",
            siteDomain: "http.example.com",
          },
        } as never
      }
      onClose={jest.fn()}
      onQueued={onQueued}
    />,
  );

  const submit = screen.getByRole("button", { name: "Queue domain change" });
  expect(submit).toBeEnabled();
  fireEvent.click(submit);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Response was lost",
  );
  fireEvent.click(submit);

  await waitFor(() => expect(onQueued).toHaveBeenCalledTimes(1));
  expect(reconfigureMock).toHaveBeenCalledTimes(2);
  expect(reconfigureMock.mock.calls[0][2]).toBe(
    reconfigureMock.mock.calls[1][2],
  );
});

test("project rename preserves its stable slug and reuses the mutation intent", async () => {
  renameProjectMock
    .mockRejectedValueOnce(new Error("Response was lost"))
    .mockResolvedValueOnce({ project });
  const onRenamed = jest.fn();
  render(
    <RenameFleetResourceModal
      target={{ kind: "project", project }}
      onClose={jest.fn()}
      onRenamed={onRenamed}
    />,
  );

  change("Project name", "Renamed product");
  const submit = screen.getByRole("button", { name: "Rename project" });
  fireEvent.click(submit);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Response was lost",
  );
  fireEvent.click(submit);

  await waitFor(() => expect(onRenamed).toHaveBeenCalledTimes(1));
  expect(renameProjectMock).toHaveBeenCalledTimes(2);
  expect(renameProjectMock.mock.calls[0][0]).toBe("example");
  expect(renameProjectMock.mock.calls[0][2]).toBe(
    renameProjectMock.mock.calls[1][2],
  );
});

test("deployment rename preserves its stable deployment ID", async () => {
  renameDeploymentMock.mockResolvedValueOnce({ deployment: {} as never });
  const onRenamed = jest.fn();
  render(
    <RenameFleetResourceModal
      target={{
        kind: "deployment",
        deployment: {
          id: "dep_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          projectSlug: "example",
          reference: "production",
          name: "Production",
        } as never,
      }}
      onClose={jest.fn()}
      onRenamed={onRenamed}
    />,
  );

  change("Deployment name", "Production Canada");
  fireEvent.click(screen.getByRole("button", { name: "Rename deployment" }));

  await waitFor(() => expect(onRenamed).toHaveBeenCalledTimes(1));
  expect(renameDeploymentMock).toHaveBeenCalledWith(
    "dep_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "Production Canada",
    expect.any(String),
  );
});

function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
