import { fleetDeploymentHref, isFleetDeploymentId } from "./fleetSelection";

const deploymentId = "dep_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("recognizes canonical fleet deployment IDs", () => {
  expect(isFleetDeploymentId(deploymentId)).toBe(true);
  expect(isFleetDeploymentId("dep_not-valid")).toBe(false);
  expect(isFleetDeploymentId([deploymentId])).toBe(false);
});

test("preserves route state while adding the selected deployment", () => {
  expect(
    fleetDeploymentHref("/settings/runtime?tab=limits#pool", deploymentId),
  ).toBe(`/settings/runtime?tab=limits&deployment=${deploymentId}#pool`);
});

test("rejects external navigation and invalid deployment IDs", () => {
  expect(() =>
    fleetDeploymentHref("https://example.com", deploymentId),
  ).toThrow("same-origin");
  expect(() => fleetDeploymentHref("/settings", "bad")).toThrow(
    "deployment ID",
  );
});
