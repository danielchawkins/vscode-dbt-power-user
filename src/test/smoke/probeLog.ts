import * as fs from "node:fs";
import * as path from "node:path";

/** One read of a polled condition: when it ran, what it saw and what it skipped. */
export interface ProbeRecord {
  at: number;
  label: string;
  attempt: number;
  value?: unknown;
  frames?: number;
  skipped?: string[];
  outcome?: "matched" | "polling" | "timeout";
}

/** Records kept for the running test; the failure hook writes them out and then clears them. */
const records: ProbeRecord[] = [];
const RECORD_LIMIT = 2_000;

export function recordProbe(record: ProbeRecord): void {
  records.push(record);
  if (records.length > RECORD_LIMIT) {
    records.splice(0, records.length - RECORD_LIMIT);
  }
}

export function takeProbes(): ProbeRecord[] {
  return records.splice(0, records.length);
}

/** Directory from `FPU_SMOKE_DIAGNOSTICS`, where failure bundles go; undefined when the launcher set none. */
export function diagnosticsDirectory(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const dir = env.FPU_SMOKE_DIAGNOSTICS?.trim();
  return (dir ?? "") || undefined;
}

/** File-safe name for a test title. */
export function testSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-|-$/g, "")
      .slice(0, 100) || "test"
  );
}

export function writeProbes(dir: string, probes: ProbeRecord[]): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "probe.jsonl"),
    probes.map((probe) => JSON.stringify(probe)).join("\n") + "\n",
  );
}

/** A predicate with the poll's limits: `attempts` reads, `intervalMs` apart. */
export interface WaitOptions<T> {
  until: (value: T) => boolean;
  attempts?: number;
  intervalMs?: number;
}

/**
 * Polls `read` every `intervalMs` until `done` holds, up to `attempts` reads. Each read is recorded under `label`,
 * and the timeout error names `label` and the last value, so a failure says which wait failed and what it saw.
 */
export async function waitFor<T>(
  label: string,
  read: () => Promise<T>,
  done: ((value: T) => boolean) | WaitOptions<T>,
): Promise<T> {
  const {
    until,
    attempts = 120,
    intervalMs = 250,
  } = typeof done === "function" ? { until: done } : done;
  let last: T | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await read();
    const matched = until(last);
    recordProbe({
      at: Date.now(),
      label,
      attempt,
      value: last,
      outcome: matched ? "matched" : "polling",
    });
    if (matched) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  recordProbe({
    at: Date.now(),
    label,
    attempt: attempts,
    value: last,
    outcome: "timeout",
  });
  throw new Error(
    `${label} never matched after ${attempts} reads: ${JSON.stringify(last)}`,
  );
}
