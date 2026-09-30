import { Disposable, languages } from "vscode";
import { DBTPowerUserExtension } from "../dbtPowerUserExtension";
import { Projects } from "../projects/projects";
import { CteCodeLensProvider } from "./cteCodeLensProvider";
import { SourceModelCreationCodeLensProvider } from "./sourceModelCreationCodeLensProvider";
import { SqlActionsCodeLensProvider } from "./sqlActionsCodeLensProvider";
import { VirtualSqlCodeLensProvider } from "./virtualSqlCodeLensProvider";

export class CodeLensProviders implements Disposable {
  private disposables: Disposable[] = [];
  constructor(
    private projects: Projects,
    private sourceModelCreationCodeLensProvider: SourceModelCreationCodeLensProvider,
    private virtualSqlCodeLensProvider: VirtualSqlCodeLensProvider,
    private cteCodeLensProvider: CteCodeLensProvider,
    private sqlActionsCodeLensProvider: SqlActionsCodeLensProvider,
  ) {
    this.disposables.push(
      this.sourceModelCreationCodeLensProvider,
      this.virtualSqlCodeLensProvider,
      this.cteCodeLensProvider,
      this.projects.onDidInitialize(() => this.registerProviders()),
    );
  }

  private registerProviders(): void {
    this.disposables.push(
      languages.registerCodeLensProvider(
        DBTPowerUserExtension.DBT_YAML_SELECTOR,
        this.sourceModelCreationCodeLensProvider,
      ),
      languages.registerCodeLensProvider(
        DBTPowerUserExtension.DBT_SQL_SELECTOR,
        this.virtualSqlCodeLensProvider,
      ),
      languages.registerCodeLensProvider(
        DBTPowerUserExtension.DBT_SQL_SELECTOR,
        this.cteCodeLensProvider,
      ),
      languages.registerCodeLensProvider(
        DBTPowerUserExtension.DBT_SQL_SELECTOR,
        this.sqlActionsCodeLensProvider,
      ),
      languages.registerCodeLensProvider(
        DBTPowerUserExtension.DBT_YAML_SELECTOR,
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
