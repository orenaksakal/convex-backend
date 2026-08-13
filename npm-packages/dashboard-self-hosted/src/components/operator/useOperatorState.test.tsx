import { render, screen, waitFor } from "@testing-library/react";
import { operatorGet } from "../../lib/operatorApi";
import { OperatorEvidenceFreshness } from "./OperatorEvidenceFreshness";
import { OperatorStateProvider } from "./useOperatorState";

jest.mock("../../lib/operatorApi", () => ({
  operatorGet: jest.fn(),
  operatorMutation: jest.fn(),
  OperatorApiError: class OperatorApiError extends Error {},
}));

const operatorGetMock = jest.mocked(operatorGet);

beforeEach(() => {
  operatorGetMock.mockImplementation(async (path) => {
    if (path === "/v1/configuration") {
      return { configuration: { revision: 1 } } as never;
    }
    if (path === "/v1/metadata") {
      return { capabilities: { status: { read: true } } } as never;
    }
    if (path === "/v1/status") {
      return { status: { freshness: { state: "current" } } } as never;
    }
    throw new Error(`Unexpected path: ${path}`);
  });
});

test("loads shared evidence and exposes its refresh age", async () => {
  render(
    <OperatorStateProvider>
      <OperatorEvidenceFreshness />
    </OperatorStateProvider>,
  );

  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /Status updated just now/ }),
    ).toBeInTheDocument(),
  );
  expect(operatorGetMock).toHaveBeenCalledTimes(3);
});
