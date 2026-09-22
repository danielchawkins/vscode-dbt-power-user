import { existsSync, readFileSync } from "fs";
import path from "path";
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
