import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../..");

function productionSources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "test" ? [] : productionSources(full);
    }
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

describe("panel view state", () => {
  it("only the lineage panel keeps its page alive while hidden", () => {
    const panels = fs.readFileSync(
      path.join(SRC, "features/panels.ts"),
      "utf8",
    );
    const retaining = productionSources(SRC).filter((file) =>
      /retainContextWhenHidden\s*:/.test(fs.readFileSync(file, "utf8")),
    );
    expect(retaining.map((file) => path.relative(SRC, file))).toEqual([
      path.join("features", "panels.ts"),
    ]);
    expect(panels.match(/retainContextWhenHidden\s*:/g)).toHaveLength(1);
    expect(panels).toMatch(
      /LineageViewProvider\.viewType,\s*this\.lineageViewProvider,\s*\{\s*webviewOptions:\s*\{\s*retainContextWhenHidden:\s*true/,
    );
  });
});
