import {
  beginWebviewResolve,
  clearWebviewRuntimeTimings,
  completeWebviewReady,
  getWebviewRuntimeTimings,
} from "../../benchmark/runtimeTimings";

describe("runtime timings", () => {
  const originalBenchmark = process.env.FPU_RUNTIME_BENCHMARK;

  afterEach(() => {
    clearWebviewRuntimeTimings();
    if (originalBenchmark === undefined) {
      delete process.env.FPU_RUNTIME_BENCHMARK;
    } else {
      process.env.FPU_RUNTIME_BENCHMARK = originalBenchmark;
    }
  });

  it("does nothing unless the benchmark is enabled", () => {
    delete process.env.FPU_RUNTIME_BENCHMARK;

    beginWebviewResolve("/query-panel");
    completeWebviewReady("/query-panel");

    expect(getWebviewRuntimeTimings()).toEqual([]);
  });

  it("records resolve-to-ready on the host clock", () => {
    process.env.FPU_RUNTIME_BENCHMARK = "1";

    beginWebviewResolve("/query-panel");
    completeWebviewReady("/query-panel");

    expect(getWebviewRuntimeTimings()).toEqual([
      expect.objectContaining({
        viewPath: "/query-panel",
        duration: expect.any(Number),
      }),
    ]);
  });
});
