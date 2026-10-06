import * as path from "path";
import { TextDocument, TextEditor } from "vscode";
import { isMap, isScalar, isSeq, parseDocument, type YAMLMap } from "yaml";
import {
  RESOURCE_TYPE_SOURCE,
  SourceMetaMap,
  SourceTable,
} from "../../core/manifest/types";
import type { Manifest } from "../../projects/manifestTypes";

/** A source table resolved to the dbt unique_id key the lineage should root at (`source.<pkg>.<source>.<table>`). */
export interface ResolvedSourceTable {
  key: string;
  sourceName: string;
  table: SourceTable;
}

/** The YAML extensions that opt a file into the cursor-aware source resolution. */
export const SOURCE_YAML_EXTENSIONS = [".yml", ".yaml"];

// 0-based line of `offset` within `text`.
function lineAtOffset(text: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
    }
  }
  return line;
}

/**
 * All source tables whose definition file is `filePath`. One YAML can declare several sources, each with several
 * tables, so this can return many matches.
 */
function getSourceTablesForFile(
  sourceMetaMap: SourceMetaMap,
  filePath: string,
): ResolvedSourceTable[] {
  const target = path.normalize(filePath);
  const matches: ResolvedSourceTable[] = [];
  for (const source of sourceMetaMap.values()) {
    for (const table of source.tables) {
      if (!table.path || path.normalize(table.path) !== target) {
        continue;
      }
      matches.push({
        key: `${RESOURCE_TYPE_SOURCE}.${source.package_name}.${source.name}.${table.name}`,
        sourceName: source.name,
        table,
      });
    }
  }
  return matches;
}

/**
 * Line numbers of the `- name: <table>` declarations inside each source's `tables:` block, keyed by
 * `<source>.<table>`. Walks the YAML AST so a source-level `name:`, a model name in a mixed-purpose schema file, or a
 * column that happens to share a table's name is never mistaken for a table declaration, and the same table name
 * under two sources in one file maps to two distinct lines.
 */
function findSourceTableLines(document: TextDocument): Map<string, number> {
  const declLines = new Map<string, number>();
  const text = document.getText();
  let parsed;
  try {
    parsed = parseDocument(text);
  } catch {
    // Mid-edit YAML can be arbitrarily broken; "no declarations found" lets the caller use its first-match default.
    return declLines;
  }
  const sources = parsed.get("sources");
  for (const source of isSeq(sources) ? sources.items : []) {
    if (!isMap(source)) {
      continue;
    }
    const sourceName = source.get("name");
    if (typeof sourceName !== "string") {
      continue;
    }
    for (const [name, offset] of tableDeclarations(source)) {
      declLines.set(`${sourceName}.${name}`, lineAtOffset(text, offset));
    }
  }
  return declLines;
}

/** The name and character offset of each `- name:` under a source's `tables:`. */
function tableDeclarations(source: YAMLMap): [string, number][] {
  const tables = source.get("tables");
  const found: [string, number][] = [];
  for (const table of isSeq(tables) ? tables.items : []) {
    const nameNode = isMap(table) ? table.get("name", true) : undefined;
    const offset = isScalar(nameNode) ? nameNode.range?.[0] : undefined;
    if (
      isScalar(nameNode) &&
      typeof nameNode.value === "string" &&
      offset !== undefined
    ) {
      found.push([nameNode.value, offset]);
    }
  }
  return found;
}

/**
 * Of the candidate tables in the file, the one whose `name:` declaration is the closest line at or above the cursor,
 * the table the cursor sits within. `undefined` when the cursor is above every declaration.
 */
function pickSourceTableByCursor(
  matches: ResolvedSourceTable[],
  editor: TextEditor,
): ResolvedSourceTable | undefined {
  const cursorLine = editor.selection.active.line;
  const declLines = findSourceTableLines(editor.document);
  let best: ResolvedSourceTable | undefined;
  let bestLine = -1;
  for (const match of matches) {
    const declLine =
      declLines.get(`${match.sourceName}.${match.table.name}`) ?? -1;
    if (declLine >= 0 && declLine <= cursorLine && declLine > bestLine) {
      best = match;
      bestLine = declLine;
    }
  }
  return best;
}

/**
 * The source table the active YAML file should root the lineage at: the table the cursor is on, else the file's only
 * table, else the first declared table for determinism.
 */
export function resolveSourceStartingNode(
  event: Manifest,
  editor: TextEditor,
): ResolvedSourceTable | undefined {
  const matches = getSourceTablesForFile(
    event.sourceMetaMap,
    editor.document.uri.fsPath,
  );
  if (matches.length <= 1) {
    return matches[0];
  }
  return pickSourceTableByCursor(matches, editor) ?? matches[0];
}
