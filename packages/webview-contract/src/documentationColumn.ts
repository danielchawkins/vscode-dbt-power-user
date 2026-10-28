/** Where a column's documentation came from: the model's YAML, or a database fetch. */
export type Source = "YAML" | "DATABASE";

/** A column of the model being documented; `source` says whether it came from YAML or a database fetch. */
export interface DocumentationColumn {
  name: string;
  type?: string | null | undefined;
  description?: string | null | undefined;
  generated?: boolean | undefined;
  source?: Source | undefined;
  /** On save, overwrite the column's YAML `data_type` with `type`; otherwise an existing `data_type` is kept. */
  replaceType?: boolean | undefined;
}
