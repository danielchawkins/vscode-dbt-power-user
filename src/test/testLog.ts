import { vi } from "vitest";
import type { Log } from "../core/log";

/** A `Log` that drops every message. */
export function silentLog(): Log {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    dispose: () => undefined,
  };
}

/** A `Log` whose methods are spies, for tests that assert on what was logged. */
export function spyLog() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    dispose: vi.fn(),
  };
}
