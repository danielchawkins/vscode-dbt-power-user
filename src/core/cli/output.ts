/** One `--log-format json` stderr record that `parse` reports as a diagnostic. */
export interface LogEntry {
  level: "error" | "warning";
  message: string;
}

/** The rows `show --output json --log-format json` prints, with every value as dbt returned it. */
export interface ShowPreview {
  columns: string[];
  rows: unknown[][];
  /** The last `data.sql` record; empty when none was printed. */
  compiledSql: string;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

const hasOwn = (record: JsonRecord, key: string) =>
  Object.prototype.hasOwnProperty.call(record, key);

/** Parses every line of `text` as JSON; throws on the first line that is not. */
function jsonLines(text: string): unknown[] {
  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line.trim()) as unknown);
}

function dataWith(line: unknown, key: string): JsonRecord | undefined {
  const data = asRecord(asRecord(line)?.data);
  return data && hasOwn(data, key) ? data : undefined;
}

/**
 * The `msg` of every `error` or `fatal` record in `--log-format json` stderr. Output that is not JSON lines becomes
 * one `Could not process` entry.
 */
export function jsonLogErrors(stderr: string): string[] {
  if (!stderr) {
    return [];
  }
  try {
    return jsonLines(stderr).flatMap((line) => {
      const info = asRecord(line)?.info;
      if (info === undefined || info === null) {
        throw new TypeError("record has no info");
      }
      const level = asRecord(info)?.level;
      const msg = asRecord(info)?.msg;
      return level === "error" || level === "fatal"
        ? [msg === undefined || msg === null ? "" : String(msg)]
        : [];
    });
  } catch (error) {
    return [`Could not process ${stderr}: ${String(error)}`];
  }
}

/** Errors (`error`, `fatal`), then warnings (`warn`), from `--log-format json` stderr; other lines are skipped. */
export function parseLogEntries(stderr: string): LogEntry[] {
  const errors: LogEntry[] = [];
  const warnings: LogEntry[] = [];
  for (const raw of stderr.trim().split("\n")) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    let info: JsonRecord | undefined;
    try {
      info = asRecord(asRecord(JSON.parse(line))?.info);
    } catch {
      continue;
    }
    if (!info || !hasOwn(info, "level") || !hasOwn(info, "msg")) {
      continue;
    }
    const message = String(info.msg);
    if (info.level === "error" || info.level === "fatal") {
      errors.push({ level: "error", message });
    } else if (info.level === "warn") {
      warnings.push({ level: "warning", message });
    }
  }
  return [...errors, ...warnings];
}

/**
 * `data.compiled` of the first compile record in JSON stdout. With `prefer: "model"`, the model's record wins over
 * the test nodes compiled with it. Throws when stdout is not JSON lines or holds no compile record.
 */
export function compiledOutput(stdout: string, prefer?: "model"): string {
  const lines = jsonLines(stdout).filter((line) => dataWith(line, "compiled"));
  const isModel = (line: unknown) => {
    const uniqueId = dataWith(line, "compiled")?.unique_id;
    return typeof uniqueId === "string" && uniqueId.startsWith("model.");
  };
  const isModelNode = (line: unknown) =>
    asRecord(asRecord(line)?.node_info)?.resource_type === "model";
  const chosen =
    prefer === "model"
      ? (lines.find(isModel) ?? lines.find(isModelNode) ?? lines[0])
      : lines[0];
  const data = dataWith(chosen, "compiled");
  if (!data) {
    throw new Error("Could not find compiled output in " + stdout);
  }
  return String(data.compiled);
}

/** The preview rows of `show` JSON stdout. Throws when stdout is not JSON lines or holds no preview record. */
export function showPreview(stdout: string): ShowPreview {
  const lines = jsonLines(stdout);
  const previewData = lines
    .map((line) => dataWith(line, "preview"))
    .find((data) => data !== undefined);
  if (!previewData) {
    throw new Error("Could not find previewLine in " + stdout);
  }
  const sqlLines = lines.flatMap((line): JsonRecord[] => {
    const data = dataWith(line, "sql");
    return data ? [data] : [];
  });
  const preview = JSON.parse(String(previewData.preview)) as JsonRecord[];
  return {
    columns: preview.length > 0 ? Object.keys(preview[0]) : [],
    rows: preview.map((row) => Object.values(row)),
    compiledSql:
      sqlLines.length > 0 ? String(sqlLines[sqlLines.length - 1].sql) : "",
  };
}
