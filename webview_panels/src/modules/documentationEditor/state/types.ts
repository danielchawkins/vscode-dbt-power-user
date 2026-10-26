import type { documentationEditor } from "@fusion-power-user/webview-contract";

export const Source = {
  DATABASE: "DATABASE",
  YAML: "YAML",
} as const;
export type Source = (typeof Source)[keyof typeof Source];

export interface MetadataColumn {
  name: string;
  type?: string | undefined;
}

export interface DBTDocumentationColumn extends MetadataColumn {
  description?: string | undefined;
  generated: boolean;
  source: Source;
  /** An accepted type proposal that overwrites the YAML `data_type` on save. */
  replaceType?: boolean | undefined;
}

/** The editor's copy of the host's `Documentation`, with absent and `null` fields filled in. */
export interface DBTDocumentation {
  name: string;
  description: string;
  columns: DBTDocumentationColumn[];
  generated: boolean;
  /** The model's SQL file, as the host sends it. */
  filePath: string;
  patchPath?: string | undefined;
  uniqueId?: string | undefined;
  resource_type?: string | undefined;
}

interface TestMetadataKwArgs {
  column_name: string;
  model: string;
}

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

// for accepted_values
export interface TestMetadataAcceptedValuesKwArgs extends TestMetadataKwArgs {
  values?: string[] | undefined;
}

// for relationship
export interface TestMetadataRelationshipsKwArgs extends TestMetadataKwArgs {
  field?: string | undefined;
  to?: string | undefined;
}

export interface DocBlock {
  name: string;
  path: string;
}

export type DBTUnitTest = documentationEditor.UnitTest;

export interface DocumentationStateProps {
  incomingDocsData?:
    | {
        docs?: DBTDocumentation | undefined;
        tests?: DBTModelTest[] | undefined;
        unitTests?: DBTUnitTest[] | undefined;
      }
    | undefined;
  currentDocsData?: DBTDocumentation | undefined;
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
