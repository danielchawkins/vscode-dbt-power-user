import {
  CancellationToken,
  CodeLens,
  CodeLensProvider,
  Disposable,
  ProviderResult,
  Range,
  TextDocument,
} from "vscode";
import { CST, LineCounter, Parser } from "yaml";

export class SqlActionsCodeLensProvider
  implements CodeLensProvider, Disposable
{
  provideCodeLenses(
    document: TextDocument,
    _token: CancellationToken,
  ): ProviderResult<CodeLens[]> {
    if (document.fileName.endsWith(".sql")) {
      return this.provideSqlCodeLenses(document);
    }
    return this.provideYamlCodeLenses(document);
  }

  private provideSqlCodeLenses(document: TextDocument): CodeLens[] {
    const codeLenses: CodeLens[] = [
      new CodeLens(new Range(0, 0, 0, 0), {
        title: "$(play) Execute Query",
        tooltip: "Execute this SQL query",
        command: "fusionPowerUser.executeSQL",
        arguments: [],
      }),
      new CodeLens(new Range(0, 0, 0, 0), {
        title: "$(book) Document",
        tooltip: "Add documentation or tests for this model",
        command: "fusionPowerUser.DocsEdit.focus",
        arguments: [],
      }),
    ];
    return codeLenses;
  }

  private provideYamlCodeLenses(document: TextDocument): CodeLens[] {
    const codeLenses: CodeLens[] = [];
    const lineCounter = new LineCounter();
    for (const token of new Parser(lineCounter.addNewLine).parse(
      document.getText(),
    )) {
      if (!(token.type === "document" && CST.isCollection(token.value))) {
        continue;
      }
      for (const item of token.value.items) {
        if (!(
          CST.isScalar(item.key) &&
          item.key.source === "models" &&
          CST.isCollection(item.value)
        )) {
          continue;
        }
        for (const modelItem of item.value.items) {
          if (!CST.isCollection(modelItem.value)) {
            continue;
          }
          for (const properties of modelItem.value.items) {
            if (
              CST.isScalar(properties.key) &&
              CST.isScalar(properties.value) &&
              properties.key.source === "name"
            ) {
              const position = lineCounter.linePos(properties.key.offset);
              const lensRange = new Range(
                position.line - 1,
                position.col,
                position.line - 1,
                position.col,
              );
              codeLenses.push(
                new CodeLens(lensRange, {
                  title: "$(play) Run",
                  tooltip: `Run model ${properties.value.source}`,
                  command: "fusionPowerUser.yamlRunModel",
                  arguments: [document.uri, properties.value.source],
                }),
                new CodeLens(lensRange, {
                  title: "$(beaker) Test",
                  tooltip: `Run tests for model ${properties.value.source}`,
                  command: "fusionPowerUser.yamlTestModel",
                  arguments: [document.uri, properties.value.source],
                }),
              );
            }
          }
        }
      }
    }

    return codeLenses;
  }

  dispose() {}
}
