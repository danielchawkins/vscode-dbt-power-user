export const Source = {
  YAML: "YAML",
} as const;
export type Source = (typeof Source)[keyof typeof Source];

interface MetadataColumn {
  name: string;
  type?: string | undefined;
}

interface DBTDocumentationColumn extends MetadataColumn {
  description?: string;
  generated: boolean;
  source: Source;
}

export interface DBTDocumentation {
  name: string;
  description: string;
  columns: DBTDocumentationColumn[];
  generated: boolean;
  filePath: string;
  patchPath?: string;
  uniqueId?: string;
  resource_type?: string;
}
