import type { DBColumn } from "../types";

/** What `describeQuery` compiles to: the target that answered, the relation it resolved to, and its columns. */
export type Described = { target: string; relation: string; columns: DBColumn[] };

/** Lists the columns of a relation expression into `output`, as `{column, dtype}` objects. */
const columnsLoop = (relation: string) =>
  `{% set output = [] %}{% for result in adapter.get_columns_in_relation(${relation}) %} ` +
  `{% do output.append({"column": result.name, "dtype": result.dtype}) %} {% endfor %}`;

/** The compiled text of a relation's columns as a JSON array. */
export const columnsQuery = (relation: string) =>
  `${columnsLoop(relation)} {{ tojson(output) }}`;

/** A query that compiles to the JSON of a `Described`; `relationExpr` is a Jinja expression such as `ref('m')`. */
export const describeQuery = (relationExpr: string) =>
  `${columnsLoop(relationExpr)} ` +
  `{{ tojson({"target": target.name, "relation": ${relationExpr}|string, "columns": output}) }}`;

function isDBColumn(value: unknown): value is DBColumn {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { column, dtype } = value as Record<string, unknown>;
  return typeof column === "string" && typeof dtype === "string";
}

function isDescribed(value: unknown): value is Described {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { target, relation, columns } = value as Record<string, unknown>;
  return (
    typeof target === "string" &&
    typeof relation === "string" &&
    Array.isArray(columns) &&
    columns.every(isDBColumn)
  );
}

/** Reads the compiled JSON of `describeQuery`. Throws when the text is not JSON or does not have the `Described` shape. */
export function parseDescribed(compiled: string): Described {
  let value: unknown;
  try {
    value = JSON.parse(compiled);
  } catch {
    throw new Error("The describe output is not JSON.");
  }
  if (!isDescribed(value)) {
    throw new Error(
      "The describe output lacks a target, a relation or a list of {column, dtype} columns.",
    );
  }
  return value;
}
