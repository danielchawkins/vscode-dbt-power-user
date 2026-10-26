import {
  parseDocument,
  stringify,
  YAMLMap,
  YAMLSeq,
  type Document,
} from "yaml";
import {
  getColumnNameByCase,
  isColumnNameEqual,
  isQuotedIdentifier,
} from "../../projects/project/columnNames";
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
  description?: string | null | undefined;
  columns: {
    name: string;
    description?: string | null | undefined;
    type?: string | null | undefined;
    replaceType?: boolean | undefined;
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
  return (found as YAMLMap | undefined) ?? null;
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
    description: (column.description?.trim() ?? "") || undefined,
    data_type: column.type?.toLowerCase(),
    // A column without a `tests` key gets `data_tests`.
    ...getTestDataByColumn({
      message,
      columnNameFromWebview: column.name,
      existingColumn: { name: column.name },
      deps,
    }),
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
  // A `replaceType` column takes its new type over the YAML's; otherwise an existing `data_type` is kept.
  setOrDelete(
    existing,
    "data_type",
    [column.replaceType ? column.type : undefined, rest.data_type, column.type]
      .find(Boolean)
      ?.toLowerCase(),
  );
  const allTests = getTestDataByColumn({
    message,
    columnNameFromWebview: column.name,
    existingColumn: existing.toJSON(),
    deps,
  });
  setOrDelete(existing, "tests", allTests?.tests);
  setOrDelete(existing, "data_tests", allTests?.data_tests);
}

function mergeIntoModel(context: WriteContext, model: YAMLMap) {
  const { message, deps } = context;
  setOrDelete(model, "description", message.description?.trim());
  const modelTests = getTestDataByModel({
    message,
    modelName: model.get("name") as string,
    existingModel: model.toJSON(),
    deps,
  });
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
    description: (message.description?.trim() ?? "") || undefined,
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
export function withDocumentation({
  docFile,
  message,
  adapterType,
  deps,
}: {
  docFile: string;
  message: SaveInput;
  adapterType: string;
  deps: TestDataDeps;
}): string {
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
