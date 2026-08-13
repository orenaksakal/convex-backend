import { fireEvent, render, screen } from "@testing-library/react";
import { SelfHostedCommandPalette } from "./SelfHostedCommandPalette";

const mockPush = jest.fn(async () => true);
const mockEvents = {
  on: jest.fn(),
  off: jest.fn(),
};

jest.mock("next/router", () => ({
  useRouter: () => ({
    push: mockPush,
    events: mockEvents,
    query: {},
  }),
}));

beforeEach(() => {
  mockPush.mockClear();
  mockEvents.on.mockClear();
  mockEvents.off.mockClear();
});

test("keeps the navigation trigger available on narrow screens", () => {
  render(<SelfHostedCommandPalette />);

  const trigger = screen.getByRole("button", {
    name: "Open deployment command palette",
  });
  expect(trigger).toHaveClass("flex");
  expect(trigger).not.toHaveClass("hidden");
});

test("filters and navigates to the selected result with Enter", () => {
  render(<SelfHostedCommandPalette />);

  fireEvent.keyDown(window, { key: "k", metaKey: true });
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "runtime" } });

  expect(
    screen.getByRole("option", { name: "Runtime capacity Settings" }),
  ).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(input, { key: "Enter" });

  expect(mockPush).toHaveBeenCalledWith("/settings/runtime");
});

test("wraps arrow-key selection and navigates without executing an action", () => {
  render(<SelfHostedCommandPalette />);

  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  const input = screen.getByRole("combobox");
  fireEvent.keyDown(input, { key: "ArrowDown" });

  expect(
    screen.getByRole("option", { name: "Data Deployment" }),
  ).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(input, { key: "Enter" });

  expect(mockPush).toHaveBeenCalledWith("/data");
});

test("Escape closes the palette and clears its query before reopening", () => {
  render(<SelfHostedCommandPalette />);

  fireEvent.keyDown(window, { key: "k", metaKey: true });
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "release" },
  });
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  fireEvent.keyDown(window, { key: "k", metaKey: true });
  expect(screen.getByRole("combobox")).toHaveValue("");
  expect(
    screen.getByRole("option", { name: "Health and Insights Deployment" }),
  ).toHaveAttribute("aria-selected", "true");
});
