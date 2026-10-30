import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Planted-violation checks for the Rust ast-grep rules (checklist 6). Each plant copies the rule set and sgconfig.yml
// into a scratch folder under .cache/, writes one violating file at the path the rule covers, and runs
// `ast-grep scan` there. The rule must report itself. The rule tests in ast-grep/rule-tests cover the matching;
// this covers the `files` globs, which only a real scan exercises.
const root = path.resolve(import.meta.dirname, "../../../..");
const plantsDir = path.join(root, ".cache/ast-grep-plants");

type Plant = { rule: string; file: string; code: string };

/** One violation per Rust ast-grep rule, at a path the rule's `files` glob covers. */
const plants: Plant[] = [
  {
    rule: "rust-solve-no-crate-imports",
    file: "crates/graph-layout/src/solve/mod.rs",
    code: "use crate::model::Graph;\n",
  },
  {
    rule: "rust-graph-layout-deterministic",
    file: "crates/graph-layout/src/engine/mod.rs",
    code: "fn tick() { let t = std::time::Instant::now(); }\n",
  },
  {
    rule: "rust-binding-imports-engine-only",
    file: "crates/graph-layout-napi/src/lib.rs",
    code: "use graph_layout::order::order;\n",
  },
  ...[
    ["model", "order"],
    ["budget", "model"],
    ["rand", "model"],
    ["hash", "model"],
    ["index", "order"],
    ["layering", "place"],
    ["order", "place"],
    ["across", "route"],
    ["place", "route"],
    ["route", "engine"],
    ["metrics", "place"],
    ["overview", "place"],
    ["pack", "place"],
  ].map(([group, forbidden]) => ({
    rule: `rust-core-layer-imports-${group}`,
    file: `crates/graph-layout/src/${group}/mod.rs`,
    code: `use crate::${forbidden}::Thing;\n`,
  })),
];

type Run = { status: number | null; output: string };

/** Copies the rule set into .cache/ast-grep-plants/<name>, writes `file` with `code`, and scans that copy. */
function scanPlant(name: string, file: string, code: string): Run {
  const dir = path.join(plantsDir, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
  cpSync(path.join(root, "sgconfig.yml"), path.join(dir, "sgconfig.yml"));
  cpSync(path.join(root, "ast-grep/rules"), path.join(dir, "ast-grep/rules"), {
    recursive: true,
  });
  writeFileSync(path.join(dir, file), code);
  const result = spawnSync("ast-grep", ["scan"], {
    cwd: dir,
    encoding: "utf8",
  });
  expect(
    result.error,
    "ast-grep not found; run `mise install` in the repository root",
  ).toBeUndefined();
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

describe("Rust ast-grep rules (checklist 6)", () => {
  it.each(plants)("$rule reports its planted violation", (plant) => {
    const run = scanPlant(plant.rule, plant.file, plant.code);
    expect(run.status, run.output).not.toBe(0);
    expect(run.output).toContain(`[${plant.rule}]`);
  });

  it("stays silent on the allowed form of the solver", () => {
    const run = scanPlant(
      "clean-solve",
      "crates/graph-layout/src/solve/mod.rs",
      "pub(crate) fn sweep() {}\nuse super::Scratch;\n",
    );
    expect(run.status, run.output).toBe(0);
  });
});
