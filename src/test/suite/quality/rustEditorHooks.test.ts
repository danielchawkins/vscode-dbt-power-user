import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// Checklist 10: pre-commit runs the Rust format check and taplo on the files being committed, and the editor checks
// Rust the way `just crates::lint` does. Hooks and editor settings are not built, so these are structural checks.
const root = path.resolve(import.meta.dirname, "../../../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

/** A JSON file that may carry full-line `//` comments, as .vscode/*.json does. */
const readJsonc = (file: string) =>
  JSON.parse(
    read(file)
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n"),
  ) as Record<string, unknown>;

type Hook = { glob?: string; run: string };

describe("pre-commit hooks (checklist 10)", () => {
  const { commands } = (
    parse(read("lefthook.yml")) as {
      "pre-commit": { commands: Record<string, Hook> };
    }
  )["pre-commit"];

  it("checks the format of staged Rust files", () => {
    expect(commands["rust-format"]).toEqual({
      glob: "crates/**/*.rs",
      run: "mise exec -- just crates::fmt-check",
    });
  });

  it("runs taplo on staged TOML files, crate manifests included", () => {
    expect(commands.toml).toEqual({
      glob: "**/*.toml",
      run: "mise exec -- taplo fmt --check {staged_files}",
    });
  });

  it("keeps clippy out of pre-commit", () => {
    expect(JSON.stringify(commands)).not.toMatch(/clippy|crates::lint/);
  });
});

describe("editor setup (checklist 10)", () => {
  const settings = readJsonc(".vscode/settings.json");

  it("links the crates workspace and checks with clippy over every feature", () => {
    expect(settings["rust-analyzer.linkedProjects"]).toEqual([
      "crates/Cargo.toml",
    ]);
    expect(settings["rust-analyzer.check.command"]).toBe("clippy");
    expect(settings["rust-analyzer.cargo.features"]).toBe("all");
  });

  it("formats Rust with rust-analyzer", () => {
    expect(settings["[rust]"]).toEqual({
      "editor.defaultFormatter": "rust-lang.rust-analyzer",
    });
  });

  it("recommends the rust-analyzer extension", () => {
    expect(readJsonc(".vscode/extensions.json").recommendations).toContain(
      "rust-lang.rust-analyzer",
    );
  });
});
