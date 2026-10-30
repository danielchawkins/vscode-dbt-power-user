import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Checklist 2: each Rust CLI comes from an aqua or GitHub backend that mise.lock pins, never from cargo:, so CI
// downloads it with a checksum instead of compiling it. `just lint-mise-lock` checks the lock itself.
const root = path.resolve(import.meta.dirname, "../../../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const RUST_CLIS = [
  "aqua:tamasfe/taplo",
  "aqua:EmbarkStudios/cargo-deny",
  "aqua:nextest-rs/nextest/cargo-nextest",
  "github:taiki-e/cargo-hack",
  "github:bnjbvr/cargo-machete",
  "aqua:crate-ci/typos",
  "github:wasm-bindgen/wasm-bindgen",
  "aqua:WebAssembly/binaryen",
];

/** The keys of the [tools] table in mise.toml. */
function toolKeys(miseToml: string): string[] {
  const section = miseToml.split(/^\[tools\]$/m)[1]?.split(/^\[/m)[0] ?? "";
  return Array.from(section.matchAll(/^"?([^"=\s]+)"?\s*=/gm), (m) => m[1]);
}

/** The problems with the Rust CLI backends; an empty list passes. */
function rustCliProblems(miseToml: string, lock: string): string[] {
  const keys = toolKeys(miseToml);
  const problems: string[] = [];
  for (const cli of RUST_CLIS) {
    if (!keys.includes(cli)) {
      problems.push(`${cli} is not in mise.toml [tools]`);
    } else if (!lock.includes(`[[tools."${cli}"]]`)) {
      problems.push(`${cli} is not pinned in mise.lock; run 'mise lock'`);
    }
  }
  for (const key of keys.filter((k) => k.startsWith("cargo:"))) {
    problems.push(
      `${key} compiles from source in CI; use an aqua or github backend`,
    );
  }
  for (const key of keys.filter((k) => k === "rust" || k === "core:rust")) {
    problems.push(
      `${key} in mise.toml; rust-toolchain.toml is the one owner of the Rust version`,
    );
  }
  return problems;
}

/** The wasm-bindgen CLI pin in mise.toml must equal the crate version in the binding. */
function wasmBindgenProblems(
  miseToml: string,
  bindingCargoToml: string,
): string[] {
  const cli = miseToml.match(
    /^"github:wasm-bindgen\/wasm-bindgen" = "([^"]+)"/m,
  )?.[1];
  const crate = bindingCargoToml.match(/^wasm-bindgen = "=([^"]+)"/m)?.[1];
  return cli === crate
    ? []
    : [`wasm-bindgen CLI ${cli} in mise.toml differs from the crate ${crate}`];
}

describe("Rust CLIs in mise (checklist 2)", () => {
  const miseToml = read("mise.toml");
  const lock = read("mise.lock");
  const bindingCargo = read("crates/graph-layout-wasm/Cargo.toml");

  it("every Rust CLI is pinned from an aqua or GitHub backend", () => {
    expect(rustCliProblems(miseToml, lock)).toEqual([]);
  });

  it("the wasm-bindgen CLI equals the crate version", () => {
    expect(wasmBindgenProblems(miseToml, bindingCargo)).toEqual([]);
  });

  it("plant: a cargo: backend fails", () => {
    const planted = miseToml.replace(
      "[settings]",
      '"cargo:cargo-deny" = "latest"\n\n[settings]',
    );
    expect(rustCliProblems(planted, lock).join("\n")).toMatch(
      /cargo:cargo-deny compiles from source/,
    );
  });

  it("plant: a rust entry in mise.toml fails", () => {
    const planted = miseToml.replace(
      "[settings]",
      '"core:rust" = "1.99.1"\n\n[settings]',
    );
    expect(rustCliProblems(planted, lock).join("\n")).toMatch(
      /core:rust in mise\.toml; rust-toolchain\.toml is the one owner/,
    );
  });

  it("plant: a CLI missing from mise.toml fails", () => {
    const planted = miseToml.replace(/^"aqua:crate-ci\/typos" = .*\n/m, "");
    expect(rustCliProblems(planted, lock).join("\n")).toMatch(
      /aqua:crate-ci\/typos is not in mise\.toml/,
    );
  });

  it("plant: a CLI missing from mise.lock fails", () => {
    const planted = lock.replace(
      '[[tools."aqua:tamasfe/taplo"]]',
      '[[tools."aqua:tamasfe/taplo-unpinned"]]',
    );
    expect(rustCliProblems(miseToml, planted).join("\n")).toMatch(
      /aqua:tamasfe\/taplo is not pinned in mise\.lock/,
    );
  });

  it("plant: a wasm-bindgen CLI that differs from the crate fails", () => {
    const planted = miseToml.replace(
      '"github:wasm-bindgen/wasm-bindgen" = "0.2.129"',
      '"github:wasm-bindgen/wasm-bindgen" = "0.2.128"',
    );
    expect(wasmBindgenProblems(planted, bindingCargo).join("\n")).toMatch(
      /CLI 0\.2\.128 in mise\.toml differs from the crate 0\.2\.129/,
    );
  });
});
