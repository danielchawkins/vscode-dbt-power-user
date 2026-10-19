/**
 * @typedef {{ min: number, median: number, max: number, launches: number }} StartSummary
 * @typedef {{ raw: number[], median: number, p90: number }} Series
 * @typedef {{ host: string, hostMetadata: unknown, runtime: unknown, activationMetadata: unknown }} SummaryContext
 */

/** The webview entries whose timings the summary reports, in report order. */
const ENTRIES = ["documentationEditor", "queryResults", "lineage"];

/**
 * The median of an ascending-sorted list. An even length averages its two middle values.
 * @param {number[]} sorted values in ascending order
 * @returns {number}
 */
export function median(sorted) {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * The nearest-rank percentile of an ascending-sorted list.
 * @param {number[]} sorted values in ascending order
 * @param {number} quantile between 0 and 1, for example 0.9 for the p90
 * @returns {number}
 */
export function percentile(sorted, quantile) {
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)];
}

/**
 * The values in their launch order, with the median and p90 of the sorted values.
 * @param {number[]} values one value per launch
 * @returns {Series}
 */
export function summarize(values) {
  const sorted = values.toSorted((left, right) => left - right);
  return {
    raw: values,
    median: median(sorted),
    p90: percentile(sorted, 0.9),
  };
}

/**
 * The JSON value of the line `prefix=<json>` in a launch's output, or undefined when the line is absent.
 * @param {string} output the launch's stdout
 * @param {string} prefix the marker before the `=`
 * @returns {unknown}
 */
export function readOptionalOutput(output, prefix) {
  const match = output.match(new RegExp(`^${prefix}=(.+)$`, "m"));
  return match ? JSON.parse(match[1]) : undefined;
}

/**
 * One record per launch: the runtime sample, its launch index, the milliseconds from the launcher's runTests call
 * to the extension host's first test-runner callback (FPU_SMOKE_EXTHOST_START_MS), and the startup phases from the
 * sample (null when the sample lacks them).
 * @param {number} index 1-based launch number
 * @param {string} stdout the launch's stdout
 * @param {Record<string, any>} sample the parsed FPU_SMOKE_RUNTIME_SAMPLE payload
 * @returns {Record<string, any>}
 */
export function launchRecord(index, stdout, sample) {
  return {
    index,
    extHostStartMs: readOptionalOutput(stdout, "FPU_SMOKE_EXTHOST_START_MS"),
    ...sample,
    startupPhases: sample.startupPhases ?? null,
  };
}

/**
 * The benchmark summary over every launch: activation phases, webview timings and the extension host start.
 * `extHostStartMs` is null when no launch reported a start time, and otherwise summarises only the launches that did.
 * @param {Record<string, any>[]} records the launch records from `launchRecord`
 * @param {SummaryContext} context identifies the host and the activation and runtime metadata
 * @returns {Record<string, any>}
 */
export function runtimeSummary(
  records,
  { host, hostMetadata, runtime, activationMetadata },
) {
  const extHostStarts = records
    .map((record) => record.extHostStartMs)
    .filter((value) => value !== undefined);
  /** @type {StartSummary | null} */
  const extHostStartMs =
    extHostStarts.length === 0
      ? null
      : {
          min: Math.min(...extHostStarts),
          median: median(extHostStarts.toSorted((left, right) => left - right)),
          max: Math.max(...extHostStarts),
          launches: extHostStarts.length,
        };
  return {
    host,
    hostMetadata,
    runtime,
    activationMetadata,
    activation: Object.fromEntries(
      ["loadCode", "callActivate", "finishActivate", "startupReady"].map(
        (phase) => [
          phase,
          summarize(records.map((record) => record.activation[phase])),
        ],
      ),
    ),
    webviews: Object.fromEntries(
      ENTRIES.map((entry) => [
        entry,
        {
          firstContentfulPaint: summarize(
            records.map(
              (record) =>
                record.webviews.find((webview) => webview.entry === entry)
                  .firstContentfulPaint,
            ),
          ),
          resolveToReady: summarize(
            records.map(
              (record) =>
                record.hostTimings.find((timing) => timing.entry === entry)
                  .duration,
            ),
          ),
        },
      ]),
    ),
    extHostStartMs,
  };
}
