import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { esmDirname } from "../esmDirname";

const srcRoot = path.resolve(esmDirname(import.meta.url), "../../");

describe("editor intelligence project resolution", () => {
  it("keeps the picked project in Current Project, not in a workspace-state key", () => {
    const callers = sourceFiles()
      .filter((file) =>
        readFileSync(file, "utf8").includes("fusionPowerUser.projectSelected"),
      )
      .map((file) => path.relative(srcRoot, file))
      .sort();

    expect(callers).toEqual([]);
  });

  it("routes SQL commands through Current Project", () => {
    const directCallers = sourceFiles()
      .filter((file) =>
        readFileSync(file, "utf8").includes(".executeSQLOnQueryPanel("),
      )
      .map((file) => path.relative(srcRoot, file))
      .sort();

    expect(directCallers).toEqual([
      "features/queryResults/queryPanelSupport.ts",
      "features/run/runModel.ts",
    ]);
  });
});

function sourceFiles(root = srcRoot): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "test" ? [] : sourceFiles(file);
    }
    return entry.name.endsWith(".ts") ? [file] : [];
  });
}
