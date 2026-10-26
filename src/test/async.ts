/** Lets promise continuations queued by the code under test run. */
export async function flushAsync(rounds = 16): Promise<void> {
  for (let round = 0; round < rounds; round++) {
    await Promise.resolve();
  }
}

/** Resolves after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retries `assertion` every 10 ms until it passes or `timeoutMs` passes, then runs it once more. */
export async function waitFor(
  assertion: () => void,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch {
      await sleep(10);
    }
  }
  assertion();
}

/** The failure `pollUntil` throws when its timeout passes, so callers can tell it from a read that threw. */
export class PollTimeoutError extends Error {}

/**
 * Reads a value, then keeps reading every `intervalMs` until `done` accepts one. Once `timeoutMs` passes, fails after
 * one last read, naming the wait by `describe`, which may be built from that last value.
 */
export async function pollUntil<T>(
  read: () => T | PromiseLike<T>,
  done: (value: T) => boolean,
  options: {
    timeoutMs: number;
    intervalMs: number;
    describe: string | ((last: T) => string);
  },
): Promise<T> {
  const deadline = Date.now() + options.timeoutMs;
  let value = await read();
  while (!done(value)) {
    if (Date.now() >= deadline) {
      const { describe } = options;
      const what = typeof describe === "string" ? describe : describe(value);
      throw new PollTimeoutError(`Timed out waiting for: ${what}`);
    }
    await sleep(options.intervalMs);
    value = await read();
  }
  return value;
}
