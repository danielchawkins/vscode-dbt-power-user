import type {
  CancellationToken,
  CodeLensProvider,
  Disposable,
  ProviderResult,
  TextDocument,
} from "vscode";
import { CodeLens, Range } from "vscode";
import { modelNameKeys, positionAt } from "../../core/yaml/schemaYaml";

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
    const text = document.getText();
    return modelNameKeys(text).flatMap(({ name, offset }) => {
      const { line, character } = positionAt(text, offset);
      const lensRange = new Range(line, character, line, character);
      return [
        new CodeLens(lensRange, {
          title: "$(play) Run",
          tooltip: `Run model ${name}`,
          command: "fusionPowerUser.yamlRunModel",
          arguments: [document.uri, name],
        }),
        new CodeLens(lensRange, {
          title: "$(beaker) Test",
          tooltip: `Run tests for model ${name}`,
          command: "fusionPowerUser.yamlTestModel",
          arguments: [document.uri, name],
        }),
      ];
    });
  }

  dispose() {}
}
