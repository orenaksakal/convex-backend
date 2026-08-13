export type ApplicationImpersonationHandoff = {
  enabled: boolean;
  trustedOrigin: string | null;
  path: "/operator/impersonate" | null;
};

const HANDOFF_PATH = "/operator/impersonate";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function safeApplicationHandoff(
  value: unknown,
  capability: unknown,
): string | null {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !isEnabledCapability(capability)
  ) {
    return null;
  }

  try {
    const expected = new URL(capability.trustedOrigin);
    const candidate = new URL(value);
    const entries = [...candidate.searchParams.entries()];
    const token = entries[0]?.[1];
    if (
      expected.protocol !== "https:" ||
      expected.username ||
      expected.password ||
      expected.pathname !== "/" ||
      expected.search ||
      expected.hash ||
      capability.trustedOrigin !== expected.origin ||
      capability.path !== HANDOFF_PATH ||
      candidate.protocol !== "https:" ||
      candidate.username ||
      candidate.password ||
      candidate.origin !== expected.origin ||
      candidate.pathname !== HANDOFF_PATH ||
      candidate.hash ||
      entries.length !== 1 ||
      entries[0][0] !== "token" ||
      typeof token !== "string" ||
      !TOKEN_PATTERN.test(token) ||
      candidate.search !== `?token=${token}`
    ) {
      return null;
    }
    return `${expected.origin}${HANDOFF_PATH}?token=${token}`;
  } catch {
    return null;
  }
}

function isEnabledCapability(
  value: unknown,
): value is ApplicationImpersonationHandoff & {
  enabled: true;
  trustedOrigin: string;
  path: "/operator/impersonate";
} {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const capability = value as Record<string, unknown>;
  return (
    capability.enabled === true &&
    typeof capability.trustedOrigin === "string" &&
    capability.path === HANDOFF_PATH
  );
}
