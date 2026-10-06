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
      return [];
    }
    return this.provideYamlCodeLenses(document);
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
                position.col - 1,
                position.line - 1,
                position.col - 1,
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
