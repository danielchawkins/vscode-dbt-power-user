import { existsSync, readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { esmDirname } from "../esmDirname";

const repositoryRoot = path.resolve(esmDirname(import.meta.url), "../../..");
const manifest = JSON.parse(
  readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
) as {
  extensionDependencies?: string[];
  contributes: {
    languages?: Array<{ id: string }>;
    snippets?: Array<{ language: string; path: string }>;
    grammars?: Array<{ language?: string; injectTo?: string[] }>;
  };
};

function contributedLanguageIds(): Set<string> {
  return new Set((manifest.contributes.languages ?? []).map(({ id }) => id));
}

describe("package manifest contracts", () => {
  it("declares no external extension dependencies", () => {
    expect(manifest.extensionDependencies ?? []).toEqual([]);
  });

  it("registers snippets only for contributed languages with existing files", () => {
    const contributed = contributedLanguageIds();
    for (const snippet of manifest.contributes.snippets ?? []) {
      expect(contributed.has(snippet.language)).toBe(true);
      expect(existsSync(path.join(repositoryRoot, snippet.path))).toBe(true);
    }
  });

  it("registers language-bound grammars only for contributed languages", () => {
    const contributed = contributedLanguageIds();
    for (const grammar of manifest.contributes.grammars ?? []) {
      if (grammar.language) {
        expect(contributed.has(grammar.language)).toBe(true);
      }
    }
  });

  it("registers injection grammars against built-in host scopes", () => {
    for (const grammar of manifest.contributes.grammars ?? []) {
      if (grammar.injectTo) {
        expect(grammar.injectTo.length).toBeGreaterThan(0);
        expect(grammar.language).toBeUndefined();
      }
    }
  });
});

describe("removed integrations stay out of configuration", () => {
  const forbidden: Array<{ label: string; pattern: RegExp }> = [
    { label: "ms-python.python dependency", pattern: /ms-python\.python/ },
    { label: "dbtPythonPathOverride", pattern: /dbtPythonPathOverride/ },
    { label: "dbtCustomRunnerImport", pattern: /dbtCustomRunnerImport/ },
    {
      label: "installDepsOnProjectInitialization",
      pattern: /installDepsOnProjectInitialization/,
    },
    { label: "sqlFmtPath", pattern: /sqlFmtPath/ },
    {
      label: "@altimateai/dbt-integration",
      pattern: /@altimateai\/dbt-integration/,
    },
    { label: "printEnvVars", pattern: /\bprintEnvVars\b/ },
    {
      label: "detectPythonFromTerminal",
      pattern: /\bdetectPythonFromTerminal\b/,
    },
  ];

  it("has no Python-bridge surfaces in package.json or launch.json", () => {
    const hits: string[] = [];
    for (const relativePath of ["package.json", ".vscode/launch.json"]) {
      const contents = readFileSync(
        path.join(repositoryRoot, relativePath),
        "utf8",
      );
      for (const { label, pattern } of forbidden) {
        if (pattern.test(contents)) {
          hits.push(`${relativePath}: ${label}`);
        }
      }
      if (
        relativePath === ".vscode/launch.json" &&
        /"type"\s*:\s*"python"/.test(contents)
      ) {
        hits.push(`${relativePath}: python launch configuration`);
      }
    }
    expect(hits).toEqual([]);
  });
});
