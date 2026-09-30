export enum Source {
  YAML = "YAML",
  DATABASE = "DATABASE",
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
