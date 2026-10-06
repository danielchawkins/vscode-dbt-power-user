import { readFileSync } from "fs";
import * as path from "path";
import {
  parse,
  parseDocument,
  stringify,
  YAMLMap,
  YAMLSeq,
  type Document,
} from "yaml";
import { removeProtocol } from "../../core/text";
import {
  getColumnNameByCase,
  isColumnNameEqual,
  isQuotedIdentifier,
} from "../../projects/columnNames";
import type {
  DocumentationSchema,
  DocumentationSchemaColumn,
} from "./docGenService";
import {
  getTestDataByColumn,
  getTestDataByModel,
  type TestDataDeps,
  type UpdatedTests,
} from "./docsTestData";

/** The panel's documentation of one model, as sent on save. */
export interface SaveInput extends UpdatedTests {
  name: string;
  description?: string | null;
  columns: {
    name: string;
    description?: string | null;
    type?: string | null;
  }[];
}

type ModelSeq = YAMLSeq<DocumentationSchema["models"]["0"]>;
type ColumnSeq = YAMLSeq<DocumentationSchemaColumn>;

function setOrDelete(
  doc: YAMLMap<unknown, unknown>,
  key: string,
  value: unknown,
) {
  if (value) {
    doc.set(key, value);
  } else {
    doc.delete(key);
  }
}

function findEntity(
  entities: ModelSeq | ColumnSeq | undefined,
  predicate: (name: string) => boolean,
): YAMLMap | null {
  const found = entities?.items?.find(
    (item: DocumentationSchema["models"]["0"] | DocumentationSchemaColumn) => {
      if (item instanceof YAMLMap) {
        const name = item.get("name");
        return name && predicate(name as string);
      }
      return false;
    },
  );
  return (found as YAMLMap | undefined) || null;
}

/**
 * `columns` with the spelling of the same column in `existingColumnNames`, matched ignoring case.
 */
function modifyColumnNames<T extends { name: string }>(
  columns: T[],
  existingColumnNames: string[],
): T[] {
  return columns.map((column) => {
    const existing = existingColumnNames.find(
      (name) => name.toLowerCase() === column.name.toLowerCase(),
    );
    return existing ? { ...column, name: existing } : column;
  });
}

/** `columns` spelled as the model's schema YAML spells them; unchanged for a new model or without a schema file. */
export function convertColumnNamesByCaseConfig<T extends { name: string }>(
  columns: T[],
  modelName: string,
  patchPath: string | undefined,
  projectRoot: string,
): T[] {
  if (!columns.length || !patchPath) {
    return columns;
  }
  const docFile = readFileSync(
    path.join(projectRoot, removeProtocol(patchPath)),
  ).toString("utf8");
  const parsedDocFile =
    parse(docFile, { strict: false, uniqueKeys: false, maxAliasCount: -1 }) ||
    {};
  const model = (
    parsedDocFile.models as
      { name: string; columns?: { name: string }[] }[] | undefined
  )?.find((candidate) => candidate.name === modelName);
  if (!model) {
    return columns;
  }
  return modifyColumnNames(columns, model.columns?.map((c) => c.name) ?? []);
}

interface WriteContext {
  message: SaveInput;
  adapterType: string;
  deps: TestDataDeps;
}

/** A column as a new YAML entry. */
function newColumnEntry(
  { message, adapterType, deps }: WriteContext,
  column: SaveInput["columns"][number],
) {
  return {
    name: getColumnNameByCase(column.name, adapterType),
    description: column.description?.trim() || undefined,
    data_type: column.type?.toLowerCase(),
    // A column without a `tests` key gets `data_tests`.
    ...getTestDataByColumn(message, column.name, { name: column.name }, deps),
    ...(isQuotedIdentifier(column.name, adapterType)
      ? { quote: true }
      : undefined),
  };
}

/** Merges `column` into its existing YAML entry, which keeps its other keys. */
function updateColumnEntry(
  { message, deps }: WriteContext,
  existing: YAMLMap,
  column: SaveInput["columns"][number],
) {
  // Tests are recreated from the panel's tests below, so the existing ones are not read as a base.
  const { tests: _tests, data_tests: _dataTests, ...rest } = existing.toJSON();
  setOrDelete(existing, "description", column.description?.trim());
  setOrDelete(
    existing,
    "data_type",
    (rest.data_type || column.type)?.toLowerCase(),
  );
  const allTests = getTestDataByColumn(
    message,
    column.name,
    existing.toJSON(),
    deps,
  );
  setOrDelete(existing, "tests", allTests?.tests);
  setOrDelete(existing, "data_tests", allTests?.data_tests);
}

function mergeIntoModel(context: WriteContext, model: YAMLMap) {
  const { message, deps } = context;
  setOrDelete(model, "description", message.description?.trim());
  const modelTests = getTestDataByModel(
    message,
    model.get("name") as string,
    model.toJSON(),
    deps,
  );
  setOrDelete(model, "tests", modelTests?.tests);
  setOrDelete(model, "data_tests", modelTests?.data_tests);
  if (!model.get("columns")) {
    model.set("columns", new YAMLSeq<DocumentationSchemaColumn>());
  }
  for (const column of message.columns) {
    const existing = findEntity(
      model.get("columns") as ColumnSeq | undefined,
      (name) => isColumnNameEqual(name, column.name),
    );
    if (existing) {
      updateColumnEntry(context, existing, column);
    } else {
      model.addIn(["columns"], newColumnEntry(context, column));
    }
  }
  // Empty columns would write `[]`.
  if ((model.get("columns") as ColumnSeq | undefined)?.items.length === 0) {
    model.delete("columns");
  }
}

function addModel(
  context: WriteContext,
  parsed: Document<YAMLSeq<DocumentationSchema>, true>,
  existingModels: ModelSeq | undefined,
) {
  const { message } = context;
  const newModelData = {
    name: message.name,
    description: message.description?.trim() || undefined,
    columns: message.columns.length
      ? message.columns.map((column) => newColumnEntry(context, column))
      : undefined,
  };
  if (existingModels?.items.length) {
    parsed.addIn(["models"], newModelData);
  } else {
    parsed.set("models", [newModelData]);
  }
}

/** `docFile` with the model documentation and tests of `message` merged in. */
export function withDocumentation(
  docFile: string,
  message: SaveInput,
  adapterType: string,
  deps: TestDataDeps,
): string {
  const parsed = parseDocument<YAMLSeq<DocumentationSchema>>(docFile, {
    strict: false,
    uniqueKeys: false,
  });
  const existingModels = parsed.get("models") as ModelSeq | undefined;
  const model = findEntity(existingModels, (name) => name === message.name);
  const context = { message, adapterType, deps };
  if (model) {
    mergeIntoModel(context, model);
  } else {
    addModel(context, parsed, existingModels);
  }
  return stringify(parsed, { lineWidth: 0 });
}
