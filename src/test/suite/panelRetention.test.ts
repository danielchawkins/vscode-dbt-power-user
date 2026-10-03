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
  it("no panel keeps its page alive while hidden", () => {
    const retaining = productionSources(SRC).filter((file) =>
      /retainContextWhenHidden/.test(fs.readFileSync(file, "utf8")),
    );
    expect(retaining.map((file) => path.relative(SRC, file))).toEqual([]);
  });
});
