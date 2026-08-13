import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  ExecutedOperatorAction,
  operatorGet,
  operatorMutation,
} from "../../lib/operatorApi";
import { OperatorActionConfirmation } from "./OperatorActionConfirmation";
import { trackOperatorAction } from "./OperatorActionTracker";

jest.mock("../../lib/operatorApi", () => ({
  ...jest.requireActual("../../lib/operatorApi"),
  operatorGet: jest.fn(),
  operatorMutation: jest.fn(),
}));
jest.mock("./OperatorActionTracker", () => ({
  trackOperatorAction: jest.fn(),
}));

const queued: ExecutedOperatorAction = {
  actionId: "action-1",
  kind: "manual-backup",
  state: "queued",
  acceptedAt: "2026-08-12T12:00:00.000Z",
  startedAt: null,
  completedAt: null,
  result: null,
  failure: null,
};

test("tracks an accepted durable action and reports terminal completion", async () => {
  const completed: ExecutedOperatorAction = {
    ...queued,
    state: "succeeded",
    startedAt: "2026-08-12T12:00:01.000Z",
    completedAt: "2026-08-12T12:01:00.000Z",
    result: { accepted: true, archiveId: "archive-1" },
  };
  jest.mocked(operatorMutation).mockResolvedValue(queued);
  jest.mocked(operatorGet).mockResolvedValue({ action: completed });
  const onAccepted = jest.fn();

  render(
    <OperatorActionConfirmation
      prepared={{
        token: "prepared-token",
        action: {
          id: "action-1",
          kind: "manual-backup",
          instanceId: "app-one",
          expiresAt: "2026-08-12T12:05:00.000Z",
          confirmation: "backup app-one",
          expectedDowntime: "none",
          backupPrerequisite: null,
          archive: null,
          summary: "Create a verified backup.",
        },
      }}
      onCancel={jest.fn()}
      onAccepted={onAccepted}
    />,
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: "Paste confirmation text" }),
    { target: { value: "backup app-one" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Execute exact action" }));

  await waitFor(() => expect(trackOperatorAction).toHaveBeenCalledWith(queued));
  await waitFor(() => expect(operatorGet).toHaveBeenCalledWith("/v1/actions/action-1"));
  await waitFor(() => expect(onAccepted).toHaveBeenCalledWith(completed));
});
