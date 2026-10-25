import { afterEach, describe, expect, it, vi } from "vitest";
import { PageReadiness } from "../../webview/pageReadiness";

describe("PageReadiness", () => {
  afterEach(() => vi.useRealTimers());

  it("is not ready until a page reports ready", () => {
    const readiness = new PageReadiness<string>();
    expect(readiness.isReady("bottom")).toBe(false);
    readiness.markReady("bottom");
    expect(readiness.isReady("bottom")).toBe(true);
  });

  it("resolves true at once for a page that is already ready", async () => {
    const readiness = new PageReadiness<string>();
    readiness.markReady("bottom");
    await expect(readiness.whenReady("bottom")).resolves.toBe(true);
  });

  it("resolves every waiter when the page reports ready", async () => {
    const readiness = new PageReadiness<string>();
    const first = readiness.whenReady("bottom");
    const second = readiness.whenReady("bottom", 10_000);
    readiness.markReady("bottom");
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
  });

  it("keeps waiters waiting across a reset until the page reports again", async () => {
    vi.useFakeTimers();
    const readiness = new PageReadiness<string>();
    readiness.markReady("bottom");
    readiness.reset("bottom");
    let settled: boolean | undefined;
    void readiness.whenReady("bottom").then((ready) => (settled = ready));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBeUndefined();
    readiness.markReady("bottom");
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
  });

  it("resolves false at the deadline and clears its timer", async () => {
    vi.useFakeTimers();
    const readiness = new PageReadiness<string>();
    const waiting = readiness.whenReady("tab", 1_000);
    await vi.advanceTimersByTimeAsync(999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(waiting).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the deadline timer once the page reports ready", async () => {
    vi.useFakeTimers();
    const readiness = new PageReadiness<string>();
    const waiting = readiness.whenReady("tab", 10_000);
    readiness.markReady("tab");
    await expect(waiting).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts no timer when no deadline is given", () => {
    vi.useFakeTimers();
    const readiness = new PageReadiness<string>();
    void readiness.whenReady("tab");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves waiters false when the page is disposed, and forgets it", async () => {
    const readiness = new PageReadiness<string>();
    const waiting = readiness.whenReady("tab");
    readiness.dispose("tab");
    await expect(waiting).resolves.toBe(false);
    expect(readiness.isReady("tab")).toBe(false);
  });

  it("does nothing to other pages", async () => {
    const readiness = new PageReadiness<string>();
    readiness.markReady("bottom");
    readiness.dispose("tab");
    expect(readiness.isReady("bottom")).toBe(true);
    readiness.reset("bottom");
    expect(readiness.isReady("bottom")).toBe(false);
  });
});
