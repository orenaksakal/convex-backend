import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useCallback, useState } from "react";
import { OperatorResourceFreshness } from "./OperatorResourceFreshness";
import { useOperatorResource } from "./useOperatorResource";

test("preserves last-known evidence when a background refresh fails", async () => {
  const loader = jest
    .fn<Promise<string>, []>()
    .mockResolvedValueOnce("first")
    .mockRejectedValueOnce(new Error("offline"));

  function Harness() {
    const [value, setValue] = useState<string | null>(null);
    const load = useCallback(async () => setValue(await loader()), []);
    const resource = useOperatorResource(load, { intervalMs: 60_000 });
    return (
      <>
        <div>{value ?? "empty"}</div>
        <OperatorResourceFreshness
          label="Backup evidence"
          {...resource}
          onRefresh={resource.refresh}
        />
      </>
    );
  }

  render(<Harness />);
  await screen.findByText("first");
  fireEvent.click(screen.getByRole("button", { name: /Backup evidence/ }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /Refresh failed/ }),
    ).toBeInTheDocument(),
  );
  expect(screen.getByText("first")).toBeInTheDocument();
  expect(loader).toHaveBeenCalledTimes(2);
});
