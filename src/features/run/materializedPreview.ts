import type { NodeMetaData } from "../../core/manifest/types";

/** What a materialized preview runs, or why the model has nothing to read. */
export type MaterializedPreview =
  | { kind: "query"; query: string; label: string }
  | { kind: "ephemeral"; name: string };

const quoted = (value: string) => `'${value.replaceAll("'", "\\'")}'`;

/**
 * The `dbt show` query that reads model `name` as it is materialized. `ref()` follows the project's defer flags, so
 * it reads the relation the rest of the project would read. `node` is the manifest's entry, when it has one.
 */
export function materializedPreview(
  name: string,
  node: Pick<NodeMetaData, "name" | "package_name" | "config"> | undefined,
): MaterializedPreview {
  if (node?.config.materialized === "ephemeral") {
    return { kind: "ephemeral", name };
  }
  const ref = node
    ? `ref(${quoted(node.package_name)}, ${quoted(node.name)})`
    : `ref(${quoted(name)})`;
  return {
    kind: "query",
    query: `select * from {{ ${ref} }}`,
    label: `${node?.name ?? name} (materialized)`,
  };
}
