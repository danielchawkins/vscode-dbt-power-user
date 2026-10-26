import { describe, expect, it } from "vitest";
import { Uri } from "vscode";
import {
  documentSelectorForProject,
  validateDocumentSelectorPatterns,
} from "../../fusion/documentSelector";

describe("fusionLanguageClient helpers", () => {
  it("uses string URI bases for protocol RelativePattern document selectors", () => {
    const root = Uri.file("/workspace/general");
    const selector = documentSelectorForProject(root);

    for (const filter of selector) {
      expect(filter.pattern.baseUri).toBe(root.toString());
      expect(filter.pattern.pattern).toBe("**/*");
    }
  });

  it("rejects Uri-object bases at validation", () => {
    expect(() =>
      validateDocumentSelectorPatterns([
        {
          language: "jinja-sql",
          pattern: {
            baseUri: Uri.file("/workspace/general") as unknown as string,
            pattern: "**/*",
          },
        },
      ]),
    ).toThrow(/baseUri must be a string URI/);
  });

  it("fails closed when a selector filter loses its pattern", () => {
    expect(() =>
      validateDocumentSelectorPatterns([
        { language: "jinja-sql", pattern: undefined as any },
      ]),
    ).toThrow(/missing pattern/);
  });

  it("fails closed when pattern string is empty", () => {
    expect(() =>
      validateDocumentSelectorPatterns([
        {
          language: "jinja-sql",
          pattern: { baseUri: "file:///x", pattern: "  " },
        },
      ]),
    ).toThrow(/pattern must be non-empty/);
  });
});
