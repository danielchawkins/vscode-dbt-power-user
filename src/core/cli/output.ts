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

/** A file position Fusion names in an error message, relative to the project root, 1-based. */
export interface LogLocation {
  file: string;
  line: number;
  column: number;
}

const LOCATION = /(?:-->\s+|\(in\s+)([^\s:()]+):(\d+):(\d+)/;

/** The first `--> file:line:col` or `(in file:line:col)` in `message`; `(in :1:1)` names no file. */
export function logLocation(message: string): LogLocation | undefined {
  const match = LOCATION.exec(message);
  return match
    ? {
        file: match[1] ?? "",
        line: Number(match[2]),
        column: Number(match[3]),
      }
    : undefined;
}

/** Files whose errors stop the whole project from loading, as opposed to one node. */
const PROJECT_FILES = new Set([
  "dbt_project.yml",
  "profiles.yml",
  "packages.yml",
  "dependencies.yml",
  "selectors.yml",
]);

/**
 * Whether `message` is a failure of the project's configuration rather than of one node: Fusion's `InvalidConfig`
 * code, or any error located in a project-level file.
 */
export function isConfigError(message: string): boolean {
  if (message.includes("[InvalidConfig ")) {
    return true;
  }
  const location = logLocation(message);
  return (
    location !== undefined &&
    PROJECT_FILES.has(location.file.split("/").pop() ?? "")
  );
}

/** Each `[error] …` block of Fusion's text output, with the indented lines that follow it. */
export function textLogErrors(output: string): string[] {
  const blocks: string[] = [];
  let current: string[] | undefined;
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (/^\[error\]/.test(line)) {
      current = [line];
      blocks.push("");
    } else if (current && line && !/^[[=]/.test(line)) {
      current.push(line);
    } else {
      current = undefined;
      continue;
    }
    blocks[blocks.length - 1] = current.join("\n");
  }
  return blocks;
}

/** The first non-empty line of `message` without Fusion's `[error] ` or `[warning] ` prefix. */
export function firstLogLine(message: string): string {
  const line =
    message
      .split(/\r?\n/)
      .map((part) => part.trim())
      .find((part) => part.length > 0) ?? "";
  return line.replace(/^\[(?:error|warning|warn)\]\s*/, "");
}

/** Errors (`error`, `fatal`), then warnings (`warn`), from `--log-format json` output; other lines are skipped. */
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
  const [firstRow] = preview;
  return {
    columns: firstRow ? Object.keys(firstRow) : [],
    rows: preview.map((row) => Object.values(row)),
    compiledSql: String((sqlLines.at(-1)?.["sql"] as string | undefined) ?? ""),
  };
}
