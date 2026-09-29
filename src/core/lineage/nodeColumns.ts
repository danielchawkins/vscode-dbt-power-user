/** A `dbt.getCurrentNode` result as Fusion 2.0.6 sends it, restricted to the fields read here; `null` when unknown. */
export type CurrentNodeResult = {
  node?: { columns?: Record<string, unknown> | null } | null;
} | null;

/** A column as the language server infers it. */
export interface InferredColumn {
  name: string;
  datatype: string;
}

/** A column as the manifest declares it in YAML. */
export interface DeclaredColumn {
  name: string;
  data_type?: string;
  description?: string;
}

/** A column in the lineage panel's `getColumns` body. */
export interface PanelColumn {
  table: string;
  name: string;
  datatype: string;
  can_lineage_expand: boolean;
  description: string;
}

/** The node's inferred columns in server order, or `undefined` when the result names no node. */
export function inferredColumns(
  result: CurrentNodeResult | undefined,
): InferredColumn[] | undefined {
  const columns = result?.node?.columns;
  if (typeof columns !== "object" || columns === null) {
    return undefined;
  }
  return Object.entries(columns).map(([name, column]) => {
    const dataType = (column as { data_type?: unknown } | null)?.data_type;
    return {
      name,
      datatype: typeof dataType === "string" ? dataType.toLowerCase() : "",
    };
  });
}

/**
 * The panel's columns of `table`: inferred columns in server order, then declared columns the server does not
 * infer, by name. Names match case-insensitively; a declared description and data type win over inferred ones.
 */
export function panelColumns(
  table: string,
  declared: readonly DeclaredColumn[],
  inferred: readonly InferredColumn[] = [],
): PanelColumn[] {
  const byName = new Map(declared.map((c) => [c.name.toLowerCase(), c]));
  const fromServer = inferred.map((column) => {
    const yaml = byName.get(column.name.toLowerCase());
    byName.delete(column.name.toLowerCase());
    return toPanelColumn(table, column.name, column.datatype, yaml);
  });
  const onlyDeclared = [...byName.values()]
    .map((c) => toPanelColumn(table, c.name, "", c))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...fromServer, ...onlyDeclared];
}

function toPanelColumn(
  table: string,
  name: string,
  inferredType: string,
  declared: DeclaredColumn | undefined,
): PanelColumn {
  return {
    table,
    name,
    datatype: declared?.data_type?.toLowerCase() || inferredType,
    can_lineage_expand: false,
    description: declared?.description ?? "",
  };
}
