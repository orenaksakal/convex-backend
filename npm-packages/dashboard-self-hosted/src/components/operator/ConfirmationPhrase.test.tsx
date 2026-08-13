import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConfirmationPhrase } from "./ConfirmationPhrase";

test("copies the exact confirmation phrase", async () => {
  const writeText = jest.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });

  render(<ConfirmationPhrase value="delete example/prod" />);
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));

  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith("delete example/prod"),
  );
  expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Confirmation text copied to the clipboard.",
  );
});

test("reports clipboard failures without changing the confirmation phrase", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: jest.fn(async () => Promise.reject(new Error("no"))) },
  });

  render(<ConfirmationPhrase value="rollback app-one" />);
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));

  expect(
    await screen.findByRole("button", { name: "Copy failed" }),
  ).toBeInTheDocument();
  expect(screen.getByText("rollback app-one")).toBeInTheDocument();
});
