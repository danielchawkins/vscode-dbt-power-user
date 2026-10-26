import * as path from "node:path";
import type { TextEditor } from "vscode";
import type { SourceMetaMap, SourceTable } from "../../core/manifest/types";
import { lineIndex, sourceTables } from "../../core/yaml/schemaYaml";
import type { Manifest } from "../../projects/manifest/manifestTypes";

/** A source table resolved to the dbt unique_id key the lineage should root at (`source.<pkg>.<source>.<table>`). */
export interface ResolvedSourceTable {
  key: string;
  sourceName: string;
  table: SourceTable;
}

/** The YAML extensions that opt a file into the cursor-aware source resolution. */
export const SOURCE_YAML_EXTENSIONS = [".yml", ".yaml"];

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
        key: table.unique_id,
        sourceName: source.name,
        table,
      });
    }
  }
  return matches;
}

/**
 * Line numbers of the `- name: <table>` declarations inside each source's `tables:` block, keyed by
 * `<source>.<table>`. The walker reads the YAML tree, so a source-level `name:`, a model name in a mixed-purpose
 * schema file, or a column that happens to share a table's name is never mistaken for a table declaration, and the
 * same table name under two sources in one file maps to two distinct lines.
 */
function findSourceTableLines(text: string): Map<string, number> {
  const declLines = new Map<string, number>();
  const positionAt = lineIndex(text);
  for (const table of sourceTables(text)) {
    declLines.set(
      `${table.source}.${table.table}`,
      positionAt(table.nameOffset).line,
    );
  }
  return declLines;
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
  const declLines = findSourceTableLines(editor.document.getText());
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
