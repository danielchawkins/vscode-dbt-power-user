import { describe, expect, it } from "vitest";
import { StartupGate } from "../../startupGate";

describe("StartupGate", () => {
  it("holds waiters until settled", async () => {
    const gate = new StartupGate();
    let released = false;
    const waiter = gate.whenSettled().then(() => (released = true));

    await new Promise((resolve) => setImmediate(resolve));
    expect(released).toBe(false);

    gate.settle();
    await waiter;
    expect(released).toBe(true);
  });

  it("resolves waiters that arrive after settling, and settles idempotently", async () => {
    const gate = new StartupGate();
    gate.settle();
    gate.settle();

    await expect(gate.whenSettled()).resolves.toBeUndefined();
  });
});
