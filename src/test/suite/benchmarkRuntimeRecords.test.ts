import { describe, expect, it } from "vitest";
import {
  launchRecord,
  median,
  percentile,
  runtimeSummary,
  summarize,
  warmUpRecord,
} from "../../../scripts/benchmark/runtime-records.mjs";

const HOST_METADATA = { app: "Code", version: "1.99.0" };
const RUNTIME = { platform: "darwin-arm64" };
const ACTIVATION_METADATA = {
  eager: true,
  event: "onStartupFinished",
  by: "dbt-power-user",
};

const PHASES = {
  "main:code/didStartMain": 0,
  "renderer:code/didStartWorkbench": 501,
};

/** A runtime sample shaped like the smoke's FPU_RUNTIME_SAMPLE, with every value offset by the launch number `i`. */
function sampleFor(i: number) {
  return {
    host: "vscode",
    activation: {
      loadCode: 10 + i,
      callActivate: 20 + i,
      finishActivate: 30 + i,
      startupReady: 40 + i,
      eager: true,
      event: "onStartupFinished",
      by: "dbt-power-user",
    },
    startupPhases: PHASES,
    webviews: [
      { entry: "documentationEditor", firstContentfulPaint: 100 + i },
      { entry: "queryResults", firstContentfulPaint: 200 + i },
      { entry: "lineage", firstContentfulPaint: 300 + i },
    ],
    hostTimings: [
      { entry: "documentationEditor", duration: 50 + i },
      { entry: "queryResults", duration: 60 + i },
      { entry: "lineage", duration: 70 + i },
    ],
  };
}

/** Ten launches whose extension host start is 500 + 10 * i ms. */
function tenLaunches() {
  return Array.from({ length: 10 }, (_, i) =>
    launchRecord(
      i + 1,
      `FPU_SMOKE_EXTHOST_START_MS=${500 + 10 * i}\n`,
      sampleFor(i),
    ),
  );
}

const CONTEXT = {
  host: "vscode",
  hostMetadata: HOST_METADATA,
  runtime: RUNTIME,
  activationMetadata: ACTIVATION_METADATA,
};

describe("median", () => {
  it("gives the middle value for an odd length", () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([7])).toBe(7);
  });

  it("averages the two middle values for an even length", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("percentile", () => {
  it("gives the nearest-rank value", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 0.9)).toBe(9);
    expect(percentile(sorted, 0.5)).toBe(5);
    expect(percentile([1, 2, 3, 4], 0.9)).toBe(4);
  });

  it("gives the smallest value at quantile 0", () => {
    expect(percentile([1, 2, 3], 0)).toBe(1);
  });
});

describe("summarize", () => {
  it("keeps the values in launch order and sorts only for median and p90", () => {
    const values = [3, 1, 2];
    expect(summarize(values)).toStrictEqual({
      raw: [3, 1, 2],
      median: 2,
      p90: 3,
    });
    expect(values).toEqual([3, 1, 2]);
  });
});

describe("launchRecord", () => {
  it("carries startupPhases and the parsed FPU_SMOKE_EXTHOST_START_MS", () => {
    const stdout = "FPU_HOST_METADATA={}\nFPU_SMOKE_EXTHOST_START_MS=850\n";
    const record = launchRecord(3, stdout, sampleFor(0));
    expect(record.index).toBe(3);
    expect(record.extHostStartMs).toBe(850);
    expect(record.startupPhases).toStrictEqual(PHASES);
    expect(record.host).toBe("vscode");
  });

  it("gives startupPhases null when the sample lacks it", () => {
    const sample: Record<string, unknown> = { ...sampleFor(0) };
    delete sample.startupPhases;
    const record = launchRecord(1, "", sample);
    expect(record.startupPhases).toBeNull();
    expect(record.extHostStartMs).toBeUndefined();
  });
});

describe("runtimeSummary", () => {
  it("equals the hand-written summary of ten launches, in today's shape and key order", () => {
    const summary = runtimeSummary(tenLaunches(), CONTEXT);
    const expected = {
      host: "vscode",
      hostMetadata: HOST_METADATA,
      runtime: RUNTIME,
      activationMetadata: ACTIVATION_METADATA,
      activation: {
        loadCode: {
          raw: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
          median: 14.5,
          p90: 18,
        },
        callActivate: {
          raw: [20, 21, 22, 23, 24, 25, 26, 27, 28, 29],
          median: 24.5,
          p90: 28,
        },
        finishActivate: {
          raw: [30, 31, 32, 33, 34, 35, 36, 37, 38, 39],
          median: 34.5,
          p90: 38,
        },
        startupReady: {
          raw: [40, 41, 42, 43, 44, 45, 46, 47, 48, 49],
          median: 44.5,
          p90: 48,
        },
      },
      webviews: {
        documentationEditor: {
          firstContentfulPaint: {
            raw: [100, 101, 102, 103, 104, 105, 106, 107, 108, 109],
            median: 104.5,
            p90: 108,
          },
          resolveToReady: {
            raw: [50, 51, 52, 53, 54, 55, 56, 57, 58, 59],
            median: 54.5,
            p90: 58,
          },
        },
        queryResults: {
          firstContentfulPaint: {
            raw: [200, 201, 202, 203, 204, 205, 206, 207, 208, 209],
            median: 204.5,
            p90: 208,
          },
          resolveToReady: {
            raw: [60, 61, 62, 63, 64, 65, 66, 67, 68, 69],
            median: 64.5,
            p90: 68,
          },
        },
        lineage: {
          firstContentfulPaint: {
            raw: [300, 301, 302, 303, 304, 305, 306, 307, 308, 309],
            median: 304.5,
            p90: 308,
          },
          resolveToReady: {
            raw: [70, 71, 72, 73, 74, 75, 76, 77, 78, 79],
            median: 74.5,
            p90: 78,
          },
        },
      },
      extHostStartMs: { min: 500, median: 545, max: 590, launches: 10 },
    };
    expect(summary).toStrictEqual(expected);
    expect(Object.keys(summary)).toEqual([
      "host",
      "hostMetadata",
      "runtime",
      "activationMetadata",
      "activation",
      "webviews",
      "extHostStartMs",
    ]);
    expect(Object.keys(summary.webviews)).toEqual([
      "documentationEditor",
      "queryResults",
      "lineage",
    ]);
  });

  it("gives extHostStartMs null when no launch reports a start time", () => {
    const records = Array.from({ length: 10 }, (_, i) =>
      launchRecord(i + 1, "", sampleFor(i)),
    );
    const summary = runtimeSummary(records, CONTEXT);
    expect(summary.extHostStartMs).toBeNull();
    expect(summary.activation).toStrictEqual(
      runtimeSummary(tenLaunches(), CONTEXT).activation,
    );
  });

  it("summarises only the launches that report a start time", () => {
    const records = Array.from({ length: 10 }, (_, i) => {
      const starts: Record<number, number> = { 0: 900, 4: 700, 9: 800 };
      const stdout =
        i in starts ? `FPU_SMOKE_EXTHOST_START_MS=${starts[i]}\n` : "";
      return launchRecord(i + 1, stdout, sampleFor(i));
    });
    const summary = runtimeSummary(records, CONTEXT);
    expect(summary.extHostStartMs).toStrictEqual({
      min: 700,
      median: 800,
      max: 900,
      launches: 3,
    });
    expect(summary.activation.loadCode.raw).toHaveLength(10);
  });
});

describe("warmUpRecord", () => {
  const WARM_UP_LINES = [
    ["extHostStartMs", "FPU_SMOKE_EXTHOST_START_MS", "640", 640],
    [
      "startupPhases",
      "FPU_SMOKE_STARTUP_PHASES",
      JSON.stringify(PHASES),
      PHASES,
    ],
    ["hostNotices", "FPU_SMOKE_HOST_NOTICE", '["Slow start"]', ["Slow start"]],
    [
      "notifications",
      "FPU_SMOKE_WARMUP_NOTIFICATIONS",
      '["Unexpected toast"]',
      ["Unexpected toast"],
    ],
  ] as const;

  /** The warm-up stdout with one marker's line left out, or every line when `omit` is absent. */
  function warmUpStdout(omit?: string): string {
    return WARM_UP_LINES.filter(([key]) => key !== omit)
      .map(([, prefix, json]) => `${prefix}=${json}\n`)
      .join("");
  }

  it("parses all four keys from the warm-up output, in order", () => {
    expect(warmUpRecord(warmUpStdout())).toStrictEqual(
      Object.fromEntries(WARM_UP_LINES.map(([key, , , value]) => [key, value])),
    );
    expect(Object.keys(warmUpRecord(warmUpStdout()))).toEqual([
      "extHostStartMs",
      "startupPhases",
      "hostNotices",
      "notifications",
    ]);
  });

  it.each(WARM_UP_LINES.map(([key]) => key))(
    "gives null for %s when its line is missing",
    (missing) => {
      expect(warmUpRecord(warmUpStdout(missing))).toStrictEqual({
        ...Object.fromEntries(
          WARM_UP_LINES.map(([key, , , value]) => [key, value]),
        ),
        [missing]: null,
      });
    },
  );

  it("gives null for every key when the output has none of them", () => {
    expect(warmUpRecord("FPU_HOST_METADATA={}\n")).toStrictEqual({
      extHostStartMs: null,
      startupPhases: null,
      hostNotices: null,
      notifications: null,
    });
  });
});
