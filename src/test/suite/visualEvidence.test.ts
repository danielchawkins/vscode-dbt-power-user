import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkpointCount,
  checkpointStem,
  screenshotDirectory,
  writeCheckpoint,
} from "../smoke/visualEvidence";

describe("visual evidence", () => {
  const dirs: string[] = [];
  afterEach(() =>
    dirs
      .splice(0)
      .forEach((d) => fs.rmSync(d, { recursive: true, force: true })),
  );

  it("is off unless FPU_SMOKE_SCREENSHOTS names a directory", () => {
    expect(screenshotDirectory({})).toBeUndefined();
    expect(
      screenshotDirectory({ FPU_SMOKE_SCREENSHOTS: "  " }),
    ).toBeUndefined();
    expect(screenshotDirectory({ FPU_SMOKE_SCREENSHOTS: "/tmp/x" })).toBe(
      "/tmp/x",
    );
  });

  it("orders checkpoints by sequence with file-safe names", () => {
    expect(checkpointStem(3, "panel /query-panel")).toBe(
      "03-panel-query-panel",
    );
    expect(checkpointStem(1, "!!!")).toBe("01-checkpoint");
  });

  it("writes the image, its measurements, and an index entry per checkpoint", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fpu-visual-"));
    dirs.push(dir);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

    writeCheckpoint(
      dir,
      1,
      { name: "model editor", expect: "a", measured: { n: 1 } },
      png,
      { host: "vscode" },
    );
    writeCheckpoint(dir, 2, { name: "panel", expect: "b", measured: {} }, png, {
      host: "vscode",
    });

    expect(fs.readFileSync(path.join(dir, "01-model-editor.png"))).toEqual(png);
    const record = JSON.parse(
      fs.readFileSync(path.join(dir, "01-model-editor.json"), "utf-8"),
    );
    expect(record).toMatchObject({
      image: "01-model-editor.png",
      measured: { n: 1 },
      host: "vscode",
    });
    const index = JSON.parse(
      fs.readFileSync(path.join(dir, "index.json"), "utf-8"),
    ) as { image: string }[];
    expect(index.map((e) => e.image)).toEqual([
      "01-model-editor.png",
      "02-panel.png",
    ]);
    expect(checkpointCount(dir)).toBe(2);
    expect(checkpointCount(path.join(dir, "absent"))).toBe(0);
  });
});
