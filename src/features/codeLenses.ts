import { Disposable, languages } from "vscode";
import {
  DBT_SQL_SELECTOR,
  DBT_YAML_SELECTOR,
} from "../fusion/documentSelectors";
import { Projects } from "../projects/projects";
import { SourceModelCreationCodeLensProvider } from "./codegen/sourceModelCreationCodeLensProvider";
import { SqlActionsCodeLensProvider } from "./sqlActions/sqlActionsCodeLensProvider";
import { VirtualSqlCodeLensProvider } from "./sqlActions/virtualSqlCodeLensProvider";

export class CodeLensProviders implements Disposable {
  private disposables: Disposable[] = [];
  constructor(
    private projects: Projects,
    private sourceModelCreationCodeLensProvider: SourceModelCreationCodeLensProvider,
    private virtualSqlCodeLensProvider: VirtualSqlCodeLensProvider,
    private sqlActionsCodeLensProvider: SqlActionsCodeLensProvider,
  ) {
    this.disposables.push(
      this.sourceModelCreationCodeLensProvider,
      this.virtualSqlCodeLensProvider,
      this.projects.onDidInitialize(() => this.registerProviders()),
    );
  }

  private registerProviders(): void {
    this.disposables.push(
      languages.registerCodeLensProvider(
        DBT_YAML_SELECTOR,
        this.sourceModelCreationCodeLensProvider,
      ),
      languages.registerCodeLensProvider(
        DBT_SQL_SELECTOR,
        this.virtualSqlCodeLensProvider,
      ),
      languages.registerCodeLensProvider(
        DBT_SQL_SELECTOR,
        this.sqlActionsCodeLensProvider,
      ),
      languages.registerCodeLensProvider(
        DBT_YAML_SELECTOR,
        this.sqlActionsCodeLensProvider,
      ),
    );
  }

  dispose() {
    this.sqlActionsCodeLensProvider.dispose();
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}
