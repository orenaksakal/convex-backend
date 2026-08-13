import { resolveFleetMutationIntent } from "./fleetMutationIntent";

test("reuses one idempotency key for the same submitted intent", () => {
  const createIdempotencyKey = jest.fn(() => "intent-key-one");
  const first = resolveFleetMutationIntent(
    null,
    { name: "Example", type: "dev", optional: undefined },
    createIdempotencyKey
  );
  const retry = resolveFleetMutationIntent(
    first,
    { type: "dev", name: "Example" },
    createIdempotencyKey
  );

  expect(retry).toBe(first);
  expect(retry.idempotencyKey).toBe("intent-key-one");
  expect(createIdempotencyKey).toHaveBeenCalledTimes(1);
});

test("creates a new idempotency key when the submitted intent changes", () => {
  const keys = ["intent-key-one", "intent-key-two"];
  const createIdempotencyKey = jest.fn(() => keys.shift()!);
  const first = resolveFleetMutationIntent(
    null,
    { name: "Example", type: "dev" },
    createIdempotencyKey
  );
  const changed = resolveFleetMutationIntent(
    first,
    { name: "Example", type: "prod" },
    createIdempotencyKey
  );

  expect(changed.idempotencyKey).toBe("intent-key-two");
  expect(createIdempotencyKey).toHaveBeenCalledTimes(2);
});
