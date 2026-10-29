import { describe, expect, it } from "vitest";

// The unit-test workers run with --throw-deprecation (vitest.config.ts), so a deprecated API fails the test.
describe("unit-test workers", () => {
  // The trace run (TRACE_DEPRECATIONS=1) sets --trace-deprecation instead, so this case is skipped there.
  it.skipIf(process.env.TRACE_DEPRECATIONS === "1")(
    "throw on deprecation warnings",
    () => {
      expect(process.throwDeprecation).toBe(true);
    },
  );
});
