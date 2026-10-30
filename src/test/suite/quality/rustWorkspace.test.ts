import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Planted-violation checks for the Rust workspace lint table (checklist 3). Each plant copies crates/ to a scratch
// folder under .cache/, appends one violation, and runs the same command as `just crates::lint`. Build output goes to
// one target directory, so the dependency graph compiles once across plants.
const root = path.resolve(import.meta.dirname, "../../../..");
const cratesDir = path.join(root, "crates");
const plantsDir = path.join(root, ".cache/rust-plants");
const targetDir =
  process.env.CARGO_TARGET_DIR ?? path.join(plantsDir, "target");

type Run = { status: number | null; output: string };

// rustc prints a lint name with hyphens in some messages (`-D unsafe-code`) and underscores in others.
const lintName = (lint: string) => new RegExp(lint.replaceAll("_", "[_-]"));

/** Copies crates/ into .cache/rust-plants/<name>, appends `appended` to the files named by path, and returns the copy. */
function stage(name: string, appended: Record<string, string>): string {
  const dir = path.join(plantsDir, name, "crates");
  rmSync(path.join(plantsDir, name), { recursive: true, force: true });
  mkdirSync(path.dirname(dir), { recursive: true });
  cpSync(cratesDir, dir, {
    recursive: true,
    filter: (src) => path.basename(src) !== "target",
  });
  for (const [file, text] of Object.entries(appended)) {
    appendFileSync(path.join(dir, file), text);
  }
  return dir;
}

function run(cwd: string, bin: string, args: string[]): Run {
  const result = spawnSync(bin, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CARGO_TARGET_DIR: targetDir },
  });
  expect(
    result.error,
    `${bin} not found; run \`mise install\` in the repository root`,
  ).toBeUndefined();
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/** The clippy command of `just crates::lint`, run in a staged copy. */
function clippyPlant(name: string, appended: Record<string, string>): Run {
  const dir = stage(name, appended);
  return run(dir, "cargo", [
    "clippy",
    "--workspace",
    "--all-targets",
    "--locked",
    "--",
    "-D",
    "warnings",
  ]);
}

/** The rustdoc command of `just crates::lint`, run in a staged copy. */
function docPlant(name: string, appended: Record<string, string>): Run {
  const dir = stage(name, appended);
  return run(dir, "rustdoc", [
    "--edition",
    "2024",
    "--crate-type",
    "lib",
    "-D",
    "warnings",
    "-D",
    "rustdoc::broken_intra_doc_links",
    "--out-dir",
    path.join(targetDir, "rustdoc"),
    "graph-layout/src/lib.rs",
  ]);
}

describe("Rust workspace lints (checklist 3)", () => {
  it(
    "control: the unmodified workspace passes clippy and rustdoc",
    { timeout: 600_000 },
    () => {
      const lint = clippyPlant("control", {});
      expect(lint.status, lint.output).toBe(0);
      const doc = docPlant("control-doc", {});
      expect(doc.status, doc.output).toBe(0);
    },
  );

  it("plant: unsafe in a binding is denied", { timeout: 300_000 }, () => {
    const run = clippyPlant("unsafe-binding", {
      "graph-layout-wasm/src/lib.rs":
        "\npub fn planted() -> u8 {\n    unsafe { std::mem::zeroed() }\n}\n",
    });
    expect(run.status).not.toBe(0);
    expect(run.output).toMatch(lintName("unsafe_code"));
  });

  it("plant: unsafe in the core is forbidden", { timeout: 300_000 }, () => {
    const run = clippyPlant("unsafe-core", {
      "graph-layout/src/engine/mod.rs":
        "\npub fn planted() -> u8 {\n    unsafe { std::mem::zeroed() }\n}\n",
    });
    expect(run.status).not.toBe(0);
    expect(run.output).toMatch(lintName("unsafe_code"));
  });

  it("plant: an allow attribute fails", { timeout: 300_000 }, () => {
    const run = clippyPlant("allow-attribute", {
      "graph-layout/src/engine/mod.rs":
        "\n#[allow(dead_code)]\nfn planted() {}\n",
    });
    expect(run.status).not.toBe(0);
    expect(run.output).toMatch(lintName("allow_attributes"));
  });

  it("plant: a float-to-integer cast fails", { timeout: 300_000 }, () => {
    const run = clippyPlant("float-cast", {
      "graph-layout/src/engine/mod.rs":
        "\n/// Doc.\npub fn planted(x: f64) -> i64 {\n    x as i64\n}\n",
    });
    expect(run.status).not.toBe(0);
    expect(run.output).toMatch(lintName("cast_possible_truncation"));
  });

  it("plant: a public item without docs fails", { timeout: 300_000 }, () => {
    const run = clippyPlant("missing-docs", {
      "graph-layout/src/engine/mod.rs": "\npub fn planted() {}\n",
    });
    expect(run.status).not.toBe(0);
    expect(run.output).toMatch(lintName("missing_docs"));
  });

  it(
    "plant: a broken intra-doc link fails rustdoc",
    { timeout: 300_000 },
    () => {
      const run = docPlant("broken-link", {
        "graph-layout/src/engine/mod.rs":
          "\n/// Doc linking [`nowhere`].\npub fn planted() {}\n",
      });
      expect(run.status).not.toBe(0);
      expect(run.output).toMatch(lintName("broken_intra_doc_links"));
    },
  );
});

describe("Rust determinism lints (checklist 4)", () => {
  // Aliases do not hide a banned item: clippy resolves the path to its definition.
  it("plant: an aliased HashMap fails", { timeout: 300_000 }, () => {
    const run = clippyPlant("aliased-hashmap", {
      "graph-layout/src/engine/mod.rs":
        "\nuse std::collections::HashMap as Map;\n/// Doc.\npub fn planted() -> usize {\n    let m: Map<u8, u8> = Map::new();\n    m.len()\n}\n",
    });
    expect(run.status).not.toBe(0);
    expect(run.output).toContain("std::collections::HashMap");
  });

  it("plant: a stored Instant::now fails", { timeout: 300_000 }, () => {
    const run = clippyPlant("stored-instant", {
      "graph-layout/src/engine/mod.rs":
        "\n/// Doc.\npub fn planted() -> bool {\n    let f = std::time::Instant::now;\n    let _ = f();\n    true\n}\n",
    });
    expect(run.status).not.toBe(0);
    expect(run.output).toContain("std::time::Instant::now");
  });

  it("plant: a platform sin fails", { timeout: 300_000 }, () => {
    const run = clippyPlant("platform-sin", {
      "graph-layout/src/engine/mod.rs":
        "\n/// Doc.\npub fn planted(x: f64) -> f64 {\n    x.sin()\n}\n",
    });
    expect(run.status).not.toBe(0);
    expect(run.output).toContain("f64::sin");
  });
});
