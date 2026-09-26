import { parseDocument } from "yaml";

/** One key a command may add to dbt_project.yml. */
export interface ProjectConfigInsertion {
  /** Key path from the document root, for example `["models", "jaffle", "+static_analysis"]`. */
  path: readonly string[];
  value: string;
}

export type ProjectConfigEditPlan =
  | { kind: "exists"; current: unknown }
  | { kind: "insert"; text: string; preview: string };

/**
 * Plans adding `insertion` to a dbt_project.yml, preserving comments and existing keys. Never overwrites: if
 * the key path already holds a value, the plan is `exists`. `preview` is the lines the user confirms.
 */
export function planProjectConfigInsertion(
  projectYaml: string,
  insertion: ProjectConfigInsertion,
): ProjectConfigEditPlan {
  const document = parseDocument(projectYaml);
  if (document.errors.length > 0) {
    throw new Error(
      `dbt_project.yml does not parse: ${document.errors[0].message}`,
    );
  }
  const current: unknown = document.getIn(insertion.path);
  if (current !== undefined) {
    return { kind: "exists", current };
  }
  document.setIn(insertion.path, insertion.value);
  return {
    kind: "insert",
    text: String(document),
    preview: previewLines(insertion),
  };
}

function previewLines({ path, value }: ProjectConfigInsertion): string {
  const quoted = /[{}:#'"]/.test(value) ? JSON.stringify(value) : value;
  return path
    .map((key, depth) =>
      depth === path.length - 1
        ? `${"  ".repeat(depth)}${key}: ${quoted}`
        : `${"  ".repeat(depth)}${key}:`,
    )
    .join("\n");
}
