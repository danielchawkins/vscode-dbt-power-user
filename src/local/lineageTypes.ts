import { ColumnMetaData } from "../core/manifest/types";

export type ModelNode = {
  database: string;
  schema: string;
  name: string;
  alias: string;
  uniqueId: string;
  columns: { [columnName: string]: ColumnMetaData };
  path: string | undefined;
};
