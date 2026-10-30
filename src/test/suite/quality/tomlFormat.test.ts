import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Checklist 5: taplo is the one TOML formatter. `just lint-toml` runs `taplo fmt --check`; these tests run the same
// command on the repository and on a planted file in a staged folder that carries the same .taplo.toml.
const root = path.resolve(import.meta.dirname, "../../../..");
const plantDir = path.join(root, ".cache/toml-plant");

function taplo(cwd: string) {
  const result = spawnSync("taplo", ["fmt", "--check"], {
    cwd,
    encoding: "utf8",
  });
  expect(
    result.error,
    "taplo not found; run `mise install` in the repository root",
  ).toBeUndefined();
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("TOML formatting (checklist 5)", () => {
  it("the repository's TOML files pass taplo", () => {
    const run = taplo(root);
    expect(run.status, run.output).toBe(0);
  });

  it("plant: a misformatted Cargo.toml fails taplo", () => {
    rmSync(plantDir, { recursive: true, force: true });
    mkdirSync(plantDir, { recursive: true });
    copyFileSync(
      path.join(root, ".taplo.toml"),
      path.join(plantDir, ".taplo.toml"),
    );
    writeFileSync(
      path.join(plantDir, "Cargo.toml"),
      '[package]\nname   =    "planted"\nversion="0.0.0"\n',
    );
    const run = taplo(plantDir);
    expect(run.status).not.toBe(0);
    expect(run.output).toContain("Cargo.toml");
  });

  it("control: a formatted Cargo.toml in the same folder passes", () => {
    writeFileSync(
      path.join(plantDir, "Cargo.toml"),
      '[package]\nname = "planted"\nversion = "0.0.0"\n',
    );
    const run = taplo(plantDir);
    expect(run.status, run.output).toBe(0);
  });
});
