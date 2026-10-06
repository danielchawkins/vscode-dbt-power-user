import {
  CancellationToken,
  CodeLens,
  CodeLensProvider,
  Disposable,
  Event,
  EventEmitter,
  Range,
  TextDocument,
} from "vscode";
import { CST, LineCounter, Parser } from "yaml";
import { GenerateModelFromSourceParams } from "../../projects/projectCodegen";

export class SourceModelCreationCodeLensProvider
  implements CodeLensProvider, Disposable
{
  private codeLenses: CodeLens[] = [];
  private _onDidChangeCodeLenses: EventEmitter<void> = new EventEmitter<void>();
  public readonly onDidChangeCodeLenses: Event<void> =
    this._onDidChangeCodeLenses.event;

  dispose(): void {
    this._onDidChangeCodeLenses.dispose();
  }

  public provideCodeLenses(
    document: TextDocument,
    _token: CancellationToken,
  ): CodeLens[] | Thenable<CodeLens[]> {
    const lineCounter = new LineCounter();
    this.codeLenses = [];
    for (const token of new Parser(lineCounter.addNewLine).parse(
      document.getText(),
    )) {
      if (token.type !== "document" || !CST.isCollection(token.value)) {
        continue;
      }
      for (const item of token.value.items) {
        if (!isPair(item, "sources") || !CST.isCollection(item.value)) {
          continue;
        }
        for (const source of item.value.items) {
          this.codeLenses.push(
            ...sourceLenses(document, source.value, lineCounter),
          );
        }
      }
    }
    return this.codeLenses;
  }
}

const isPair = (item: CST.CollectionItem, key: string): boolean =>
  CST.isScalar(item.key) && item.key.source === key;

const scalarSource = (value: CST.CollectionItem["value"]) =>
  CST.isScalar(value) ? value.source : undefined;

/** The source's database, schema and name, from its scalar properties. */
function sourceProperties(items: CST.CollectionItem[]) {
  const properties: Partial<Record<string, string>> = {};
  for (const property of items) {
    if (!CST.isScalar(property.key)) {
      continue;
    }
    const value = scalarSource(property.value);
    if (value !== undefined) {
      properties[property.key.source] = value;
    }
  }
  return properties;
}

/** One table of a source: its name, identifier and the position of its mapping. */
function tableOf(table: CST.CollectionItem, lineCounter: LineCounter) {
  if (!CST.isCollection(table.value) || table.value.items.length === 0) {
    return undefined;
  }
  const properties = sourceProperties(table.value.items);
  if (properties.name === undefined) {
    return undefined;
  }
  return {
    tableName: properties.name,
    tableIdentifier: properties.identifier,
    pos: lineCounter.linePos(table.value.offset),
  };
}

function sourceLenses(
  document: TextDocument,
  sourceValue: CST.CollectionItem["value"],
  lineCounter: LineCounter,
): CodeLens[] {
  if (!CST.isCollection(sourceValue)) {
    return [];
  }
  const { name, database, schema } = sourceProperties(sourceValue.items) as {
    name: string;
    database: string;
    schema: string;
  };
  const tables = sourceValue.items
    .filter((property) => isPair(property, "tables"))
    .flatMap((property) =>
      CST.isCollection(property.value) ? property.value.items : [],
    )
    .map((table) => tableOf(table, lineCounter))
    .filter((table) => table !== undefined);
  return tables.map((table) => {
    const params: GenerateModelFromSourceParams = {
      currentDoc: document.uri,
      sourceName: name,
      database,
      schema,
      tableName: table.tableName,
      tableIdentifier: table.tableIdentifier,
    };
    const line = table.pos.line - 1;
    const col = table.pos.col - 1;
    return new CodeLens(new Range(line, col, line, col), {
      title: "Generate model",
      tooltip: "Generate model based on source configuration",
      command: "fusionPowerUser.createModelBasedonSourceConfig",
      arguments: [params],
    });
  });
}
