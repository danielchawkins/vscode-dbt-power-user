import { existsSync, readFileSync } from "fs";
import * as path from "path";
import { Catalog } from "../dbt_integration/domain";
import { DBTTerminal } from "../dbt_integration/terminal";

interface ManifestNodeEntry {
  name: string;
  database: string;
  schema: string;
}

interface ManifestSourceEntry extends ManifestNodeEntry {
  source_name: string;
  identifier: string;
}

interface Manifest {
  nodes?: Record<string, unknown>;
  sources?: Record<string, unknown>;
}

interface ModelColumnRow {
  ref_name: string;
  column_name: string;
  column_type: string;
}

interface SourceColumnRow {
  source_name: string;
  identifier: string;
  column_name: string;
  column_type: string;
}

export const CATALOG_BATCH_SIZE = 50;

const SKIPPED_RESOURCE_TYPES = ["test", "analysis", "sql_operation"];
/** `ephemeral` is never materialised; `inline` is left in the manifest by `compile --inline`. */
const SKIPPED_MATERIALIZATIONS = ["ephemeral", "inline"];

function readManifest(
  targetPath: string,
  terminal: DBTTerminal,
): Manifest | undefined {
  const manifestPath = path.join(targetPath, "manifest.json");
  if (!existsSync(manifestPath)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  } catch (e) {
    terminal.warn(
      "FusionCatalog",
      "Failed to parse target/manifest.json: " + (e as Error).message,
      false,
    );
    return undefined;
  }
}

export function collectModelEntries(manifest: Manifest): ManifestNodeEntry[] {
  const entries: ManifestNodeEntry[] = [];
  for (const raw of Object.values(manifest.nodes ?? {})) {
    const node = raw as
      | {
          name?: string;
          database?: string;
          schema?: string;
          resource_type?: string;
          config?: { materialized?: string };
        }
      | undefined;
    if (
      !node?.name ||
      SKIPPED_RESOURCE_TYPES.includes(node.resource_type ?? "") ||
      SKIPPED_MATERIALIZATIONS.includes(node.config?.materialized ?? "")
    ) {
      continue;
    }
    entries.push({
      name: node.name,
      database: node.database ?? "",
      schema: node.schema ?? "",
    });
  }
  return entries;
}

export function collectSourceEntries(
  manifest: Manifest,
): ManifestSourceEntry[] {
  const entries: ManifestSourceEntry[] = [];
  for (const raw of Object.values(manifest.sources ?? {})) {
    const src = raw as
      | {
          name?: string;
          database?: string;
          schema?: string;
          source_name?: string;
          identifier?: string;
        }
      | undefined;
    if (!src?.source_name || !src.identifier) {
      continue;
    }
    entries.push({
      name: src.name ?? src.identifier,
      database: src.database ?? "",
      schema: src.schema ?? "",
      source_name: src.source_name,
      identifier: src.identifier,
    });
  }
  return entries;
}

const oneLine = (template: string) => template.trim().split("\n").join("");

function modelColumnsQuery(names: string[]): string {
  const namesList = names.map((n) => JSON.stringify(n)).join(", ");
  return oneLine(`
{% set result = [] %}
{% for name in [${namesList}] %}
  {% set columns = adapter.get_columns_in_relation(ref(name)) %}
  {% for column in columns %}
    {% do result.append({"ref_name": name, "column_name": column.name, "column_type": column.dtype}) %}
  {% endfor %}
{% endfor %}
{{ tojson(result) }}`);
}

function sourceColumnsQuery(
  refs: Array<{ source_name: string; identifier: string }>,
): string {
  return oneLine(`
{% set result = [] %}
{% for src in ${JSON.stringify(refs)} %}
  {% set columns = adapter.get_columns_in_relation(source(src["source_name"], src["identifier"])) %}
  {% for column in columns %}
    {% do result.append({"source_name": src["source_name"], "identifier": src["identifier"], "column_name": column.name, "column_type": column.dtype}) %}
  {% endfor %}
{% endfor %}
{{ tojson(result) }}`);
}

function batches<T>(items: T[]): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += CATALOG_BATCH_SIZE) {
    result.push(items.slice(i, i + CATALOG_BATCH_SIZE));
  }
  return result;
}

/**
 * Warehouse columns of every materialised model and every source in `targetPath/manifest.json`, fetched with one
 * inline compile per batch of explicit `ref()`/`source()` calls. Empty when the manifest is missing or unreadable.
 */
export async function fusionCatalog(
  targetPath: string,
  compileInline: (sql: string) => Promise<string>,
  terminal: DBTTerminal,
): Promise<Catalog> {
  const manifest = readManifest(targetPath, terminal);
  if (!manifest) {
    terminal.warn(
      "FusionCatalog",
      "target/manifest.json not found or unreadable; returning empty catalog",
      false,
    );
    return [];
  }
  const catalog: Catalog = [];
  const push = (
    entry: ManifestNodeEntry,
    row: { column_name: string; column_type: string },
  ) =>
    catalog.push({
      table_database: entry.database,
      table_schema: entry.schema,
      table_name: entry.name,
      column_name: row.column_name,
      column_type: row.column_type,
    });

  for (const batch of batches(collectModelEntries(manifest))) {
    const rows = JSON.parse(
      await compileInline(modelColumnsQuery(batch.map((e) => e.name))),
    ) as ModelColumnRow[];
    const byName = new Map(batch.map((e) => [e.name, e]));
    for (const row of rows) {
      const entry = byName.get(row.ref_name);
      if (entry) {
        push(entry, row);
      }
    }
  }

  for (const batch of batches(collectSourceEntries(manifest))) {
    const refs = batch.map(({ source_name, identifier }) => ({
      source_name,
      identifier,
    }));
    const rows = JSON.parse(
      await compileInline(sourceColumnsQuery(refs)),
    ) as SourceColumnRow[];
    const byKey = new Map(
      batch.map((e) => [`${e.source_name}.${e.identifier}`, e]),
    );
    for (const row of rows) {
      const entry = byKey.get(`${row.source_name}.${row.identifier}`);
      if (entry) {
        push(entry, row);
      }
    }
  }
  return catalog;
}
