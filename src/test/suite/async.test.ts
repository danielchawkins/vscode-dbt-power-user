import { describe, expect, it } from "vitest";
import { PollTimeoutError, pollUntil } from "../async";

describe("pollUntil", () => {
  it("returns the first value the done check accepts", async () => {
    let reads = 0;
    const value = await pollUntil(
      () => ++reads,
      (read) => read >= 3,
      { timeoutMs: 1000, intervalMs: 1, describe: "three reads" },
    );
    expect(value).toBe(3);
    expect(reads).toBe(3);
  });

  it("awaits a read that returns a promise", async () => {
    const value = await pollUntil(
      async () => "ready",
      (read) => read === "ready",
      { timeoutMs: 1000, intervalMs: 1, describe: "ready" },
    );
    expect(value).toBe("ready");
  });

  it("fails with the description once the timeout passes", async () => {
    await expect(
      pollUntil(
        () => 0,
        (read) => read > 0,
        {
          timeoutMs: 20,
          intervalMs: 1,
          describe: "a positive read",
        },
      ),
    ).rejects.toThrow("Timed out waiting for: a positive read");
  });

  it("rejects a timeout with a PollTimeoutError", async () => {
    const failure = await pollUntil(
      () => 0,
      (read) => read > 0,
      { timeoutMs: 20, intervalMs: 1, describe: "a positive read" },
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PollTimeoutError);
  });

  it("rejects with the read's own error, not a timeout", async () => {
    const readError = new Error("probe failed");
    let reads = 0;
    const failure = await pollUntil(
      () => {
        reads++;
        if (reads > 1) {
          throw readError;
        }
        return 0;
      },
      (read) => read > 0,
      { timeoutMs: 1000, intervalMs: 1, describe: "a positive read" },
    ).catch((error: unknown) => error);
    expect(failure).toBe(readError);
    expect(failure).not.toBeInstanceOf(PollTimeoutError);
  });

  it("builds the failure description from the last value read", async () => {
    await expect(
      pollUntil(
        () => 7,
        (read) => read > 9,
        {
          timeoutMs: 20,
          intervalMs: 1,
          describe: (last) => `a read above 9; last was ${last}`,
        },
      ),
    ).rejects.toThrow("Timed out waiting for: a read above 9; last was 7");
  });
});
