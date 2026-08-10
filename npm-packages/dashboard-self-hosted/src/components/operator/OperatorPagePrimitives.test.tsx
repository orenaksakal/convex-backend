import { fireEvent, render, screen } from "@testing-library/react";
import {
  OperatorNumberPresetField,
  OperatorTextPresetField,
} from "./OperatorPagePrimitives";

test("schedule presets expose consequences and preserve custom cron expressions", () => {
  const onChange = jest.fn();
  const { rerender } = render(
    <OperatorTextPresetField
      label="Schedule"
      description="Choose a schedule."
      value="0 2 * * *"
      presets={[
        {
          label: "Daily",
          value: "0 2 * * *",
          description: "Runs daily at 02:00 UTC.",
        },
      ]}
      onChange={onChange}
      customLabel="Custom cron expression"
    />,
  );

  expect(screen.getByText("Runs daily at 02:00 UTC.")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox", { name: "Schedule preset" }), {
    target: { value: "__custom__" },
  });
  expect(
    screen.getByRole("textbox", { name: "Schedule custom value" }),
  ).toHaveValue("0 2 * * *");

  rerender(
    <OperatorTextPresetField
      label="Schedule"
      description="Choose a schedule."
      value="15 3 * * 1-5"
      presets={[
        {
          label: "Daily",
          value: "0 2 * * *",
          description: "Runs daily at 02:00 UTC.",
        },
      ]}
      onChange={onChange}
    />,
  );
  expect(
    screen.getByRole("textbox", { name: "Schedule custom value" }),
  ).toHaveValue("15 3 * * 1-5");
});

test("numeric presets apply a safe choice and reveal an exact custom input", () => {
  const onChange = jest.fn();
  render(
    <OperatorNumberPresetField
      label="Retention days"
      description="Archive retention."
      value={30}
      presets={[
        {
          label: "30 days (recommended)",
          value: 30,
          description: "A practical recovery window.",
        },
        {
          label: "90 days",
          value: 90,
          description: "Longer recovery history.",
        },
      ]}
      min={1}
      max={365}
      onChange={onChange}
    />,
  );

  fireEvent.change(
    screen.getByRole("combobox", { name: "Retention days preset" }),
    { target: { value: "90" } },
  );
  expect(onChange).toHaveBeenCalledWith(90);

  fireEvent.change(
    screen.getByRole("combobox", { name: "Retention days preset" }),
    { target: { value: "__custom__" } },
  );
  expect(
    screen.getByRole("spinbutton", { name: "Retention days custom value" }),
  ).toHaveAttribute("min", "1");
  expect(
    screen.getByRole("spinbutton", { name: "Retention days custom value" }),
  ).toHaveAttribute("max", "365");
});
