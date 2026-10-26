import type {
  CancellationToken,
  CodeLensProvider,
  Disposable,
  Event,
  TextDocument,
} from "vscode";
import { CodeLens, EventEmitter, Range } from "vscode";
import { lineIndex, sourceTables } from "../../core/yaml/schemaYaml";
import type { GenerateModelFromSourceParams } from "../../projects/project/projectCodegen";

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
    const text = document.getText();
    const positionAt = lineIndex(text);
    this.codeLenses = sourceTables(text).map((table) => {
      const params: GenerateModelFromSourceParams = {
        currentDoc: document.uri,
        sourceName: table.source,
        database: table.database,
        schema: table.schema,
        tableName: table.table,
        tableIdentifier: table.identifier,
      };
      const { line, character } = positionAt(table.offset);
      return new CodeLens(new Range(line, character, line, character), {
        title: "Generate model",
        tooltip: "Generate model based on source configuration",
        command: "fusionPowerUser.createModelBasedonSourceConfig",
        arguments: [params],
      });
    });
    return this.codeLenses;
  }
}
