import type { documentationEditor } from "@fusion-power-user/webview-contract";

export interface MetadataColumn {
  name: string;
  type?: string | undefined;
}

/** A column as the editor keeps it, with absent and `null` fields filled in. */
export type EditorDocumentationColumn = Omit<
  documentationEditor.DocumentationColumn,
  "type" | "description" | "generated" | "source"
> & {
  type?: string | undefined;
  description?: string | undefined;
  generated: boolean;
  source: documentationEditor.Source;
};

/** The editor's copy of the host's `Documentation`, with absent and `null` fields filled in. */
export type EditorDocumentation = Omit<
  documentationEditor.Documentation,
  "description" | "generated" | "columns" | "patchPath"
> & {
  description: string;
  generated: boolean;
  columns: EditorDocumentationColumn[];
  patchPath?: string | undefined;
};

export const DbtTestTypes = {
  EXTERNAL_PACKAGE: "external",
  GENERIC: "generic",
  MACRO: "macro",
  SINGULAR: "singular",
  UNKNOWN: "unknown",
} as const;
export type DbtTestTypes = (typeof DbtTestTypes)[keyof typeof DbtTestTypes];

export const DbtGenericTests = {
  ACCEPTED_VALUES: "accepted_values",
  NOT_NULL: "not_null",
  RELATIONSHIPS: "relationships",
  UNIQUE: "unique",
} as const;
export type DbtGenericTests =
  (typeof DbtGenericTests)[keyof typeof DbtGenericTests];

export interface DocBlock {
  name: string;
  path: string;
}

export type DBTUnitTest = documentationEditor.UnitTest;

export interface DocumentationStateProps {
  incomingDocsData?:
    | {
        docs?: EditorDocumentation | undefined;
        tests?: DBTModelTest[] | undefined;
        unitTests?: DBTUnitTest[] | undefined;
      }
    | undefined;
  currentDocsData?: EditorDocumentation | undefined;
  currentDocsTests?: DBTModelTest[] | undefined;
  currentUnitTests?: DBTUnitTest[] | undefined;
  project?: string | undefined;
  missingDocumentationMessage?:
    | { message: string; type: "warning" | "error" }
    | undefined;
  searchQuery: string;
  docBlocks: DocBlock[];
  /** The manifest publication the host read the current documentation from. */
  publication?: string | undefined;
}

export type DBTModelTest = documentationEditor.ModelTest;
