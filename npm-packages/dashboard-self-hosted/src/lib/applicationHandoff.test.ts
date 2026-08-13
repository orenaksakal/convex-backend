import { safeApplicationHandoff } from "./applicationHandoff";

const token = "a".repeat(43);
const capability = {
  enabled: true,
  trustedOrigin: "https://app.example.test",
  path: "/operator/impersonate",
};

test("accepts only the exact trusted one-use application handoff", () => {
  expect(
    safeApplicationHandoff(
      `https://app.example.test/operator/impersonate?token=${token}`,
      capability,
    ),
  ).toBe(`https://app.example.test/operator/impersonate?token=${token}`);
});

test.each([
  [`http://app.example.test/operator/impersonate?token=${token}`, capability],
  [
    `https://other.example.test/operator/impersonate?token=${token}`,
    capability,
  ],
  [`https://app.example.test/app?token=${token}`, capability],
  [
    `https://app.example.test/operator/impersonate?token=${token}&next=/app`,
    capability,
  ],
  [
    `https://app.example.test/operator/impersonate?token=${token}&token=${token}`,
    capability,
  ],
  [`https://app.example.test/operator/impersonate?token=short`, capability],
  [
    `https://app.example.test/operator/impersonate?token=${token}#fragment`,
    capability,
  ],
  [
    `https://user@app.example.test/operator/impersonate?token=${token}`,
    capability,
  ],
  [
    `https://app.example.test/operator/impersonate?token=${token}`,
    { ...capability, enabled: false },
  ],
  [
    `https://app.example.test/operator/impersonate?token=${token}`,
    { ...capability, trustedOrigin: "https://app.example.test/" },
  ],
  [
    `https://app.example.test/operator/impersonate?token=${token}`,
    { ...capability, path: "/other" },
  ],
])("rejects an untrusted or malformed handoff", (value, advertised) => {
  expect(safeApplicationHandoff(value, advertised)).toBeNull();
});
