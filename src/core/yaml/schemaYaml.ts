import { isMap, isScalar, isSeq, parseAllDocuments, type YAMLMap } from "yaml";

/** A model's `name:` key: the model's name, and the key's offset and range in the text. */
export interface ModelNameKey {
  name: string;
  offset: number;
  range: [number, number];
}

/**
 * One table of a named source. `offset` starts the table's mapping; `nameOffset` starts its `name:` value. The
 * database, schema and identifier are `undefined` when the YAML omits them.
 */
export interface SchemaSourceTable {
  source: string;
  database: string | undefined;
  schema: string | undefined;
  table: string;
  identifier: string | undefined;
  offset: number;
  nameOffset: number;
}

interface ScalarEntry {
  text: string;
  key: [number, number];
  valueOffset: number;
}

/** A 0-based line and character of `offset` in `text`, counting lines by `\n` as the YAML parser does. */
export function positionAt(
  text: string,
  offset: number,
): { line: number; character: number } {
  const lines = text.slice(0, offset).split("\n");
  return { line: lines.length - 1, character: (lines.at(-1) ?? "").length };
}

/** The name key of every model under the top-level `models:` list, in document order. */
export function modelNameKeys(text: string): ModelNameKey[] {
  const keys: ModelNameKey[] = [];
  for (const model of modelMaps(text)) {
    const key = modelNameKey(model);
    if (key) {
      keys.push(key);
    }
  }
  return keys;
}

/** The name key of the model whose entry holds `offset`: the offset lies strictly between the entry's ends. */
export function modelAt(
  text: string,
  offset: number,
): ModelNameKey | undefined {
  for (const model of modelMaps(text)) {
    const key = modelNameKey(model);
    const range = model.range;
    if (key && range && range[0] < offset && offset < range[1]) {
      return key;
    }
  }
  return undefined;
}

/** Every table of every named source under the top-level `sources:` list, in document order. */
export function sourceTables(text: string): SchemaSourceTable[] {
  const tables: SchemaSourceTable[] = [];
  for (const source of sourceMaps(text)) {
    const name = scalarEntry(source, "name")?.text;
    if (name === undefined) {
      continue;
    }
    const database = scalarEntry(source, "database")?.text;
    const schema = scalarEntry(source, "schema")?.text;
    for (const table of mapsUnder(source, "tables")) {
      const tableName = scalarEntry(table, "name");
      if (!tableName) {
        continue;
      }
      tables.push({
        source: name,
        database,
        schema,
        table: tableName.text,
        identifier: scalarEntry(table, "identifier")?.text,
        offset: table.range?.[0] ?? 0,
        nameOffset: tableName.valueOffset,
      });
    }
  }
  return tables;
}

/** The top-level mappings of every document in `text`. Text that fails to parse yields no mappings. */
function documentMaps(text: string): YAMLMap[] {
  try {
    const maps: YAMLMap[] = [];
    for (const document of parseAllDocuments(text)) {
      if (isMap(document.contents)) {
        maps.push(document.contents);
      }
    }
    return maps;
  } catch {
    // Mid-edit YAML can be broken enough to fail; no models or sources are read from it then.
    return [];
  }
}

/** The mappings in the list under `key`, skipping any entry that is not a mapping. */
function mapsUnder(map: YAMLMap, key: string): YAMLMap[] {
  const list = map.get(key, true);
  const maps: YAMLMap[] = [];
  if (isSeq(list)) {
    for (const item of list.items) {
      if (isMap(item)) {
        maps.push(item);
      }
    }
  }
  return maps;
}

function modelMaps(text: string): YAMLMap[] {
  return documentMaps(text).flatMap((root) => mapsUnder(root, "models"));
}

function sourceMaps(text: string): YAMLMap[] {
  return documentMaps(text).flatMap((root) => mapsUnder(root, "sources"));
}

/**
 * The `key: scalar` entry of a mapping. `undefined` when the key is missing, or its value is null, a mapping or a
 * list.
 */
function scalarEntry(map: YAMLMap, key: string): ScalarEntry | undefined {
  const pair = map.items.find(
    (item) => isScalar(item.key) && item.key.value === key,
  );
  if (pair === undefined || !isScalar(pair.key) || !isScalar(pair.value)) {
    return undefined;
  }
  const value = pair.value.value;
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    return undefined;
  }
  return {
    text: String(value),
    key: [pair.key.range?.[0] ?? 0, pair.key.range?.[1] ?? 0],
    valueOffset: pair.value.range?.[0] ?? 0,
  };
}

function modelNameKey(model: YAMLMap): ModelNameKey | undefined {
  const entry = scalarEntry(model, "name");
  if (!entry) {
    return undefined;
  }
  return { name: entry.text, offset: entry.key[0], range: entry.key };
}
