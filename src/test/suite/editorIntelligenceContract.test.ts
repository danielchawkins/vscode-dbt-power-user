import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "fs";
import * as path from "path";
import { esmDirname } from "../esmDirname";

const srcRoot = path.resolve(esmDirname(import.meta.url), "../../");

describe("editor intelligence project resolution", () => {
  it("limits projectSelected references to explicit user-invoked paths", () => {
    const callers = sourceFiles()
      .filter((file) =>
        readFileSync(file, "utf8").includes("fusionPowerUser.projectSelected"),
      )
      .map((file) => path.relative(srcRoot, file))
      .sort();

    expect(callers).toEqual([
      "features/commands.ts",
      "features/projectPicker/actionsCenter.ts",
      "features/projectSetup/projectSetupCommands.ts",
    ]);
  });

  it("routes SQL commands through Current Project", () => {
    const directCallers = sourceFiles()
      .filter((file) =>
        readFileSync(file, "utf8").includes(".executeSQLOnQueryPanel("),
      )
      .map((file) => path.relative(srcRoot, file))
      .sort();

    expect(directCallers).toEqual([
      "features/queryResults/queryResultPanel.ts",
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
