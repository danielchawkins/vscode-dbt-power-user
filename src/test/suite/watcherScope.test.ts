import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "fs";
import * as path from "path";
import { esmDirname } from "../esmDirname";

const srcRoot = path.resolve(esmDirname(import.meta.url), "../../");

describe("project watcher scope", () => {
  it("limits production file watchers to the known non-recursive owners", () => {
    const callers = sourceFiles()
      .filter((file) =>
        readFileSync(file, "utf8").includes("createFileSystemWatcher"),
      )
      .map((file) => path.relative(srcRoot, file))
      .sort();

    expect(callers).toEqual([
      "dbt_client/dbtProjectLog.ts",
      "projects/projectRegistry.ts",
    ]);
  });

  it("has no recursive dbt_project.yml discovery", () => {
    const recursiveGlob = /\*\*\/(?:dbt_project\.yml|\$\{DBT_PROJECT_FILE\})/;
    const recursiveSearch =
      /findFiles\([\s\S]{0,200}(?:dbt_project\.yml|DBT_PROJECT_FILE)/;
    const offenders = sourceFiles()
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return recursiveGlob.test(source) || recursiveSearch.test(source);
      })
      .map((file) => path.relative(srcRoot, file));

    expect(offenders).toEqual([]);
  });
});

function sourceFiles(root = srcRoot): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "test" || entry.name === "node_modules"
        ? []
        : sourceFiles(file);
    }
    return entry.name.endsWith(".ts") ? [file] : [];
  });
}
