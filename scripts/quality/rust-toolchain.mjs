#!/usr/bin/env node
// Fails unless rust-toolchain.toml pins a concrete version that mise.lock records and the rustc on PATH reports.
// `stable` is a channel, not a pin: it moves, so the lock would record a different compiler after each update.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "../..");

/** The version mise.lock records for core:rust, or undefined when it records none. */
export function lockedRustVersion(lockText) {
  const block = lockText.split(/^\[\[tools\.rust\]\]$/m)[1];
  return block?.split(/^\[/m)[0].match(/^version = "([^"]+)"/m)?.[1];
}

/** The channel rust-toolchain.toml names, or undefined. */
export function channelOf(toolchainText) {
  return toolchainText.match(/^channel\s*=\s*"([^"]+)"/m)?.[1];
}

/** The problems with the toolchain pin; an empty list passes. */
export function toolchainProblems({ lock, toolchain, rustc }) {
  const problems = [];
  const recorded = lockedRustVersion(lock);
  const channel = channelOf(toolchain);
  if (recorded === undefined) {
    problems.push("mise.lock records no core:rust version; run `mise lock`");
  }
  if (channel === undefined) {
    problems.push("rust-toolchain.toml names no channel");
  } else if (!/^\d+\.\d+\.\d+$/.test(channel)) {
    problems.push(
      `rust-toolchain.toml channel "${channel}" is not a concrete version; pin one, e.g. 1.99.1`,
    );
  } else if (channel !== recorded) {
    problems.push(
      `rust-toolchain.toml says ${channel} but mise.lock records ${recorded}`,
    );
  }
  const actual = rustc.match(/^rustc (\S+)/)?.[1];
  if (recorded !== undefined && actual !== recorded) {
    problems.push(
      `rustc --version reports ${actual ?? "nothing"}, mise.lock records ${recorded}; run 'mise install'`,
    );
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const toolchain = readFileSync(
    path.join(root, "rust-toolchain.toml"),
    "utf8",
  );
  const problems = toolchainProblems({
    lock: readFileSync(path.join(root, "mise.lock"), "utf8"),
    toolchain,
    rustc: execFileSync("rustc", ["--version"], { encoding: "utf8" }),
  });
  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`rust toolchain: ${problem}`);
    }
    process.exitCode = 1;
  } else {
    console.log(
      `rust toolchain: ${channelOf(toolchain)} is pinned and installed`,
    );
  }
}
