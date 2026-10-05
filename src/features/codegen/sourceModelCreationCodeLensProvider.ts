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

interface Position {
  line: number;
  col: number;
}

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
    this.codeLenses = [];
    const lineCounter = new LineCounter();
    let currentSource: string | undefined = undefined;
    let currentDatabase: string | undefined = undefined;
    let currentSchema: string | undefined = undefined;
    let currentTables: {
      tableName: string;
      tableIdentifier?: string;
      pos: Position;
    }[];

    for (const token of new Parser(lineCounter.addNewLine).parse(
      document.getText(),
    )) {
      if (token.type === "document" && CST.isCollection(token.value)) {
        for (const item of token.value.items) {
          if (
            CST.isScalar(item.key) &&
            item.key.source === "sources" &&
            CST.isCollection(item.value)
          ) {
            // inside sources
            for (const source of item.value.items) {
              // inside a source
              currentTables = [];
              if (CST.isCollection(source.value)) {
                //
                for (const sourceProperty of source.value.items) {
                  if (
                    CST.isScalar(sourceProperty.key) &&
                    CST.isScalar(sourceProperty.value)
                  ) {
                    if (sourceProperty.key.source === "name") {
                      currentSource = sourceProperty.value.source;
                    }
                    if (sourceProperty.key.source === "database") {
                      currentDatabase = sourceProperty.value.source;
                    }
                    if (sourceProperty.key.source === "schema") {
                      currentSchema = sourceProperty.value.source;
                    }
                  }
                  if (
                    CST.isScalar(sourceProperty.key) &&
                    CST.isCollection(sourceProperty.value) &&
                    sourceProperty.key.source === "tables"
                  ) {
                    // inside tables
                    let tableName: string | undefined = undefined;
                    let tableIdentifier: string | undefined = undefined;
                    let position: Position | undefined = undefined;
                    for (const table of sourceProperty.value.items) {
                      if (CST.isCollection(table.value)) {
                        for (const tableProperty of table.value.items) {
                          position = lineCounter.linePos(table.value.offset);
                          if (
                            CST.isScalar(tableProperty.value) &&
                            CST.isScalar(tableProperty.key)
                          ) {
                            if (tableProperty.key.source === "name") {
                              tableName = tableProperty.value.source;
                            }
                            if (tableProperty.key.source === "identifier") {
                              tableIdentifier = tableProperty.value.source;
                            }
                          }
                        }
                      }
                      if (tableName !== undefined && position !== undefined) {
                        currentTables.push({
                          tableName: tableName,
                          tableIdentifier: tableIdentifier,
                          pos: position,
                        });
                        tableName = undefined;
                        tableIdentifier = undefined;
                        position = undefined;
                      }
                    }
                  }
                }
              }

              // add all tables
              for (const table of currentTables) {
                const params: GenerateModelFromSourceParams = {
                  currentDoc: document.uri,
                  sourceName: currentSource!,
                  database: currentDatabase!,
                  schema: currentSchema!,
                  tableName: table.tableName,
                  tableIdentifier: table.tableIdentifier,
                };
                this.codeLenses.push(
                  new CodeLens(
                    new Range(
                      table.pos.line - 1,
                      table.pos.col,
                      table.pos.line - 1,
                      table.pos.col,
                    ),
                    {
                      title: "Generate model",
                      tooltip: "Generate model based on source configuration",
                      command: "fusionPowerUser.createModelBasedonSourceConfig",
                      arguments: [params],
                    },
                  ),
                );
              }
              currentDatabase = undefined;
              currentSchema = undefined;
              currentSource = undefined;
            }
          }
        }
      }
    }
    return this.codeLenses;
  }
}
