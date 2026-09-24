import { ColumnMetaData } from "../dbt_integration";

export type ModelNode = {
  database: string;
  schema: string;
  name: string;
  alias: string;
  uniqueId: string;
  columns: { [columnName: string]: ColumnMetaData };
  path: string | undefined;
};

export type ModelInfo = {
  model_node: ModelNode;
  compiled_sql?: string;
};
