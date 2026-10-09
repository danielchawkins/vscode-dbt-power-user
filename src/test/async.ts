/** Lets promise continuations queued by the code under test run. */
export async function flushAsync(rounds = 16): Promise<void> {
  for (let round = 0; round < rounds; round++) {
    await Promise.resolve();
  }
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
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  assertion();
}
