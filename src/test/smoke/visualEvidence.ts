import * as fs from "fs";
import * as path from "path";

/**
 * One visual checkpoint in the smoke evidence package: a workbench screenshot and the text-derived measurements
 * the test recorded at the same moment, so a reviewer can confirm the two agree.
 */
export interface VisualCheckpoint {
  name: string;
  /** What the checkpoint should show; the reviewer compares this with the image. */
  expect: string;
  /** Text-derived measurements taken at the capture (webview body text, notification texts, and so on). */
  measured: Record<string, unknown>;
}

/** Directory from `FPU_SMOKE_SCREENSHOTS`, or undefined when screenshot evidence is off. */
export function screenshotDirectory(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const dir = env.FPU_SMOKE_SCREENSHOTS?.trim();
  return dir ? dir : undefined;
}

/** File-safe checkpoint stem, ordered by capture sequence. */
export function checkpointStem(sequence: number, name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${String(sequence).padStart(2, "0")}-${slug || "checkpoint"}`;
}

/** Writes `<stem>.png` and `<stem>.json` and appends the checkpoint to `index.json`. */
export function writeCheckpoint(
  dir: string,
  sequence: number,
  checkpoint: VisualCheckpoint,
  png: Buffer,
  context: Record<string, unknown>,
): string {
  fs.mkdirSync(dir, { recursive: true });
  const stem = checkpointStem(sequence, checkpoint.name);
  fs.writeFileSync(path.join(dir, `${stem}.png`), png);
  const record = { ...checkpoint, image: `${stem}.png`, ...context };
  fs.writeFileSync(
    path.join(dir, `${stem}.json`),
    JSON.stringify(record, null, 2),
  );
  const indexPath = path.join(dir, "index.json");
  const index = fs.existsSync(indexPath)
    ? (JSON.parse(fs.readFileSync(indexPath, "utf-8")) as unknown[])
    : [];
  index.push(record);
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  return path.join(dir, `${stem}.png`);
}
