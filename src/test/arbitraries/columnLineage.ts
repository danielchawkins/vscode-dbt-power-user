import fc from "fast-check";
import { segment } from "./index";

const nodeId = fc
  .tuple(fc.constantFrom("model", "source", "seed"), segment, segment)
  .map((parts) => parts.join("."));

/** A column name; some contain `.`, which `dbt.listNodes` does not escape in column ids. */
const columnName = fc.oneof(
  segment,
  fc.tuple(segment, segment).map(([a, b]) => `${a}.${b}`),
);

/** A column id as `dbt.listNodes` spells it at column grain: `<node unique_id>.<column>`, with its name. */
const columnId = fc
  .tuple(nodeId, columnName)
  .map(([node, column]) => ({ id: `${node}.${column}`, name: column }));

/** One column-grain node; its parents are drawn from `ids` so parents may or may not be nodes themselves. */
const listNode = (columns: { id: string; name: string }[]) =>
  fc.record({
    column: fc.constantFrom(...columns),
    parents: fc.array(fc.constantFrom(...columns.map((c) => c.id)), {
      maxLength: 4,
    }),
    op: fc.constantFrom("copy", "mod", "scan", "unknown", undefined),
  });

/** A `dbt.listNodes` column-grain result over a small pool of column ids; `name` agrees with `unique_id`. */
export const listNodesResult = fc
  .uniqueArray(columnId, {
    minLength: 1,
    maxLength: 8,
    selector: (column) => column.id,
  })
  .chain((columns) => fc.array(listNode(columns), { maxLength: 10 }))
  .map((nodes) => ({
    error: null,
    grain: "column",
    nodes: nodes.map(({ column, parents, op }) => ({
      unique_id: column.id,
      name: column.name,
      parents,
      op,
    })),
  }));
