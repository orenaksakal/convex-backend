import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  adoptFleetDeployment,
  reconfigureFleetDeploymentDomains,
} from "../../lib/fleetApi";
import {
  AdoptDeploymentModal,
  ReconfigureDomainsModal,
} from "../../pages/fleet";

jest.mock("../../lib/fleetApi", () => ({
  ...jest.requireActual("../../lib/fleetApi"),
  adoptFleetDeployment: jest.fn(),
  reconfigureFleetDeploymentDomains: jest.fn(),
}));

const adoptMock = jest.mocked(adoptFleetDeployment);
const reconfigureMock = jest.mocked(reconfigureFleetDeploymentDomains);
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

test("adoption requires explicit ownership confirmation and reuses its intent on retry", async () => {
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
  change("Confirmation", "adopt example/production");

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

test("domain changes require the exact deployment confirmation and reuse their intent", async () => {
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
  expect(submit).toBeDisabled();
  change("Confirmation", "change domains example/production");
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

function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
