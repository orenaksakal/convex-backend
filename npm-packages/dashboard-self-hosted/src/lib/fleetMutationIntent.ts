export type FleetMutationIntent = Readonly<{
  fingerprint: string;
  idempotencyKey: string;
}>;

export function resolveFleetMutationIntent(
  previous: FleetMutationIntent | null,
  payload: unknown,
  createIdempotencyKey: () => string = () => crypto.randomUUID()
): FleetMutationIntent {
  const fingerprint = JSON.stringify(canonicalize(payload));
  if (previous?.fingerprint === fingerprint) return previous;
  return { fingerprint, idempotencyKey: createIdempotencyKey() };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)])
  );
}
