import {
  adoptFleetDeployment,
  createFleetProject,
  fleetBootstrap,
  reconfigureFleetDeploymentDomains,
  renameFleetDeployment,
  renameFleetProject,
} from "./fleetApi";

afterEach(() => {
  jest.restoreAllMocks();
  Reflect.deleteProperty(globalThis, "fetch");
});

test("sends the caller's stable idempotency key", async () => {
  const fetchMock = mockFetch({
    ok: true,
    status: 201,
    json: async () => ({
      project: { id: "prj_one", slug: "one", name: "One" },
    }),
  } as Response);

  await createFleetProject({ name: "One" }, "intent-key-one");

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const init = fetchMock.mock.calls[0][1];
  expect((init?.headers as Record<string, string>)["Idempotency-Key"]).toBe(
    "intent-key-one",
  );
});

test("preserves the fleet request ID on API errors", async () => {
  mockFetch({
    ok: false,
    status: 409,
    headers: {
      get: (name: string) =>
        name === "x-request-id" ? "request-from-header" : null,
    } as Headers,
    json: async () => ({
      error: {
        code: "conflict",
        message: "The operation conflicts with current state",
        requestId: "request-from-body",
      },
    }),
  } as Response);

  await expect(fleetBootstrap()).rejects.toMatchObject({
    status: 409,
    code: "conflict",
    requestId: "request-from-body",
  });
});

test("uses stable intent keys for adoption and domain reconfiguration", async () => {
  const fetchMock = mockFetch({
    ok: true,
    status: 202,
    json: async () => ({ deployment: {}, operation: null }),
  } as Response);

  await adoptFleetDeployment(
    "example",
    {
      name: "Production",
      type: "prod",
      deploymentUrl: "https://convex.example.com",
      dashboardUrl: "https://dashboard.example.com",
      operatorUrl: "https://operator.example.com",
      databaseBindingAlias: "example-prod",
    },
    "adopt-intent-key",
  );
  await reconfigureFleetDeploymentDomains(
    "dep_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    {
      applicationDomain: "example.com",
      deploymentDomain: "convex.example.com",
      siteDomain: "http.example.com",
      confirmation: "change domains example/production",
    },
    "domain-intent-key",
  );

  expect(fetchMock.mock.calls[0][0]).toBe(
    "/fleet/v1/projects/example/deployments/adopt",
  );
  expect(
    (fetchMock.mock.calls[0][1]?.headers as Record<string, string>)[
      "Idempotency-Key"
    ],
  ).toBe("adopt-intent-key");
  expect(fetchMock.mock.calls[1][0]).toBe(
    "/fleet/v1/deployments/dep_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/domains",
  );
  expect(
    (fetchMock.mock.calls[1][1]?.headers as Record<string, string>)[
      "Idempotency-Key"
    ],
  ).toBe("domain-intent-key");
});

test("renames project and deployment labels through stable identity paths", async () => {
  const fetchMock = mockFetch({
    ok: true,
    status: 200,
    json: async () => ({}),
  } as Response);

  await renameFleetProject("example project", "Renamed", "project-intent");
  await renameFleetDeployment("dep_abc/123", "Production", "deployment-intent");

  expect(fetchMock.mock.calls[0][0]).toBe(
    "/fleet/v1/projects/example%20project/rename",
  );
  expect(fetchMock.mock.calls[0][1]?.body).toBe(
    JSON.stringify({ name: "Renamed" }),
  );
  expect(fetchMock.mock.calls[1][0]).toBe(
    "/fleet/v1/deployments/dep_abc%2F123/rename",
  );
  expect(fetchMock.mock.calls[1][1]?.body).toBe(
    JSON.stringify({ name: "Production" }),
  );
});

function mockFetch(response: Partial<Response>) {
  const fetchMock = jest.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      response as Response,
  );
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: fetchMock,
  });
  return fetchMock;
}
