import type { documentationEditor } from "@fusion-power-user/webview-contract";

export enum Source {
  DATABASE = "DATABASE",
  YAML = "YAML",
}

export interface MetadataColumn {
  name: string;
  type?: string;
}

export interface DBTDocumentationColumn extends MetadataColumn {
  description?: string;
  generated: boolean;
  source: Source;
}

/** The editor's copy of the host's `Documentation`, with absent and `null` fields filled in. */
export interface DBTDocumentation {
  name: string;
  description: string;
  columns: DBTDocumentationColumn[];
  generated: boolean;
  /** The model's SQL file; the host sends it and `saveDocumentation` returns it. */
  filePath: string;
  patchPath?: string;
  uniqueId?: string;
  resource_type?: string;
}

export interface TestMetadataKwArgs {
  column_name: string;
  model: string;
}

export enum DbtTestTypes {
  EXTERNAL_PACKAGE = "external",
  GENERIC = "generic",
  MACRO = "macro",
  SINGULAR = "singular", // sql queries in dbt tests directory
  UNKNOWN = "unknown",
}

export enum DbtGenericTests {
  ACCEPTED_VALUES = "accepted_values",
  NOT_NULL = "not_null",
  RELATIONSHIPS = "relationships",
  UNIQUE = "unique",
}

// for accepted_values
export interface TestMetadataAcceptedValuesKwArgs extends TestMetadataKwArgs {
  values?: string[];
}

// for relationship
export interface TestMetadataRelationshipsKwArgs extends TestMetadataKwArgs {
  field?: string;
  to?: string;
}

export interface DocBlock {
  name: string;
  path: string;
}

export type DBTUnitTest = documentationEditor.UnitTest;

export interface DocumentationStateProps {
  incomingDocsData?: { docs?: DBTDocumentation; tests?: DBTModelTest[] };
  currentDocsData?: DBTDocumentation;
  currentDocsTests?: DBTModelTest[];
  currentUnitTests?: DBTUnitTest[];
  project?: string;
  missingDocumentationMessage?: { message: string; type: "warning" | "error" };
  searchQuery: string;
  docBlocks: DocBlock[];
}

export type DBTModelTest = documentationEditor.ModelTest;
