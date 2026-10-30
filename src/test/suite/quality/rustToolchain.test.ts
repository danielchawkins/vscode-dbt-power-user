import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  lockedRustVersion,
  toolchainProblems,
} from "../../../../scripts/quality/rust-toolchain.mjs";

const root = path.resolve(import.meta.dirname, "../../../..");
const lock = readFileSync(path.join(root, "mise.lock"), "utf8");
const toolchain = readFileSync(path.join(root, "rust-toolchain.toml"), "utf8");
const rustc = "rustc 1.99.1 (58cf8f9c3 2026-10-13)";

describe("rust toolchain pin (checklist 1)", () => {
  it("the repository pin passes against the rustc mise installs", () => {
    expect(toolchainProblems({ lock, toolchain, rustc })).toEqual([]);
  });

  it("the lint script passes on the installed toolchain", () => {
    const script = path.join(root, "scripts/quality/rust-toolchain.mjs");
    const out = execFileSync(process.execPath, [script], {
      encoding: "utf8",
      cwd: root,
    });
    expect(out).toContain("is pinned and installed");
  });

  it("plant: a channel name instead of a version fails", () => {
    const problems = toolchainProblems({
      lock,
      toolchain: toolchain.replace('"1.99.1"', '"stable"'),
      rustc,
    });
    expect(problems.join("\n")).toMatch(/channel "stable" is not a concrete/);
  });

  it("plant: a toolchain file that disagrees with the lock fails", () => {
    const problems = toolchainProblems({
      lock,
      toolchain: toolchain.replace("1.99.1", "1.98.0"),
      rustc,
    });
    expect(problems.join("\n")).toMatch(
      /says 1\.98\.0 but mise\.lock records 1\.99\.1/,
    );
  });

  it("plant: a lock without a core:rust entry fails", () => {
    const withoutRust = lock.split("[[tools.rust]]")[0];
    expect(lockedRustVersion(withoutRust)).toBeUndefined();
    const problems = toolchainProblems({ lock: withoutRust, toolchain, rustc });
    expect(problems.join("\n")).toMatch(/records no core:rust version/);
  });

  it("plant: an installed rustc that differs from the lock fails", () => {
    const problems = toolchainProblems({
      lock,
      toolchain,
      rustc: "rustc 1.98.0 (aaaaaaaaa 2026-01-01)",
    });
    expect(problems.join("\n")).toMatch(/rustc --version reports 1\.98\.0/);
  });
});
