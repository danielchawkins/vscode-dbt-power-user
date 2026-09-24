import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "fs";
import * as path from "path";
import { esmDirname } from "../esmDirname";

const srcRoot = path.resolve(esmDirname(import.meta.url), "../../");

const secretStoragePattern = /\bSecretStorage\b|\bsecrets\b/;

describe("local-only extension host contract", () => {
  it("does not touch VS Code SecretStorage in production src", () => {
    const offenders = sourceFiles()
      .filter((file) => secretStoragePattern.test(readFileSync(file, "utf8")))
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
