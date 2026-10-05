import { afterEach, describe, expect, it } from "vitest";
import {
  beginWebviewResolve,
  completeWebviewReady,
  getWebviewRuntimeTimings,
} from "../../benchmark/runtimeTimings";

describe("runtime timings", () => {
  const originalBenchmark = process.env.FPU_RUNTIME_BENCHMARK;

  afterEach(() => {
    if (originalBenchmark === undefined) {
      delete process.env.FPU_RUNTIME_BENCHMARK;
    } else {
      process.env.FPU_RUNTIME_BENCHMARK = originalBenchmark;
    }
  });

  it("does nothing unless the benchmark is enabled", () => {
    delete process.env.FPU_RUNTIME_BENCHMARK;

    beginWebviewResolve("queryResults");
    completeWebviewReady("queryResults");

    expect(getWebviewRuntimeTimings()).toEqual([]);
  });

  it("records resolve-to-ready on the host clock", () => {
    process.env.FPU_RUNTIME_BENCHMARK = "1";

    beginWebviewResolve("queryResults");
    completeWebviewReady("queryResults");

    expect(getWebviewRuntimeTimings()).toEqual([
      expect.objectContaining({
        entry: "queryResults",
        duration: expect.any(Number),
      }),
    ]);
  });
});
