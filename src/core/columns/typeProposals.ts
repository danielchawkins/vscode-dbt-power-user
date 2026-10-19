import type { DBColumn } from "../types";

/** Where a type answer came from. */
export type TypeSource = "target" | "deferred" | "inferred";

/** A column of a model's YAML, as the documentation editor holds it. `type` is its `data_type`. */
export interface DocColumn {
  name: string;
  type?: string;
}

/** The `{column, dtype}` list one source answered with, and where it came from. */
export interface AnsweredTypes {
  source: TypeSource;
  target?: string;
  relation?: string;
  state?: string;
  columns: DBColumn[];
}

/** A change to one column's `data_type`: `fill` an empty one, `add` a missing column or `overwrite` a different one. */
interface TypeProposal {
  column: string;
  type: string;
  change: "fill" | "add" | "overwrite";
  /** The YAML type that an `overwrite` replaces. */
  current?: string;
}

export interface TypeProposals {
  proposals: TypeProposal[];
  /** YAML columns that the answering source does not list. They are reported and never edited. */
  notFound: string[];
}

const hasText = (value: string | undefined): value is string =>
  value !== undefined && value.trim() !== "";

const key = (name: string) => name.toLowerCase();

/**
 * The changes that bring YAML `data_type`s in line with an answer. Names and types match ignoring case. Fill and
 * overwrite use the YAML spelling of the column, add uses the relation's. Proposals follow the relation's order.
 */
export function typeProposals(
  current: readonly DocColumn[],
  answered: AnsweredTypes,
): TypeProposals {
  const documented = new Map(
    current.map((column) => [key(column.name), column]),
  );
  const relation = new Set(answered.columns.map(({ column }) => key(column)));
  const proposals: TypeProposal[] = [];
  for (const { column, dtype } of answered.columns) {
    if (!hasText(dtype)) {
      continue;
    }
    const yaml = documented.get(key(column));
    if (yaml === undefined) {
      proposals.push({ column, type: dtype, change: "add" });
    } else if (!hasText(yaml.type)) {
      proposals.push({ column: yaml.name, type: dtype, change: "fill" });
    } else if (key(yaml.type) !== key(dtype)) {
      proposals.push({
        column: yaml.name,
        type: dtype,
        change: "overwrite",
        current: yaml.type,
      });
    }
  }
  const notFound = current
    .map(({ name }) => name)
    .filter((name) => !relation.has(key(name)));
  return { proposals, notFound };
}
