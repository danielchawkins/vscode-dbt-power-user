import { DocumentFilter, RelativePattern, Uri } from "vscode";

type LspRelativePattern = {
  baseUri: string;
  pattern: string;
};

type FusionDocumentFilter = {
  language: string;
  pattern: LspRelativePattern;
};

/**
 * Per-project LSP document filters using protocol RelativePattern bases.
 * Selectors isolate disjoint Declared Project roots; overlapping roots are not
 * isolated.
 */
export function documentSelectorForProject(root: Uri): FusionDocumentFilter[] {
  const baseUri = root.toString();
  const selector: FusionDocumentFilter[] = FUSION_DOCUMENT_LANGUAGES.map(
    (language) => ({ language, pattern: { baseUri, pattern: PROJECT_GLOB } }),
  );
  validateDocumentSelectorPatterns(selector);
  return selector;
}

/** The VS Code form of {@link documentSelectorForProject}, for editor surfaces scoped to one project. */
export function vscodeDocumentSelectorForProject(root: Uri): DocumentFilter[] {
  return FUSION_DOCUMENT_LANGUAGES.map((language) => ({
    language,
    pattern: new RelativePattern(root, PROJECT_GLOB),
  }));
}

const FUSION_DOCUMENT_LANGUAGES = ["jinja-sql", "sql", "yaml"] as const;
const PROJECT_GLOB = "**/*";

/** @internal */
export function validateDocumentSelectorPatterns(
  selector: readonly FusionDocumentFilter[],
): void {
  for (const filter of selector) {
    if (
      typeof filter !== "object" ||
      filter === null ||
      !("pattern" in filter) ||
      filter.pattern === undefined
    ) {
      throw new Error("Fusion LSP document selector filter missing pattern");
    }
    const pattern = filter.pattern;
    if (typeof pattern !== "object" || pattern === null) {
      throw new Error("Fusion LSP document selector pattern must be an object");
    }
    const baseUri = (pattern as { baseUri?: unknown }).baseUri;
    const glob = (pattern as { pattern?: unknown }).pattern;
    if (typeof baseUri !== "string" || baseUri.trim() === "") {
      throw new Error(
        "Fusion LSP document selector baseUri must be a string URI",
      );
    }
    if (typeof glob !== "string" || glob.trim() === "") {
      throw new Error("Fusion LSP document selector pattern must be non-empty");
    }
  }
}
