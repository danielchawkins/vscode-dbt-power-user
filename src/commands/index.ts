import {
  CATALOG_FILE,
  DBTTerminal,
  MANIFEST_FILE,
  RunModelType,
} from "@altimateai/dbt-integration";
import { existsSync, readFileSync } from "fs";
import { inject } from "inversify";
import { join } from "path";
import {
  CancellationTokenSource,
  CodeLens,
  commands,
  Disposable,
  env,
  extensions,
  languages,
  ProgressLocation,
  TextEditor,
  Uri,
  version,
  ViewColumn,
  window,
  workspace,
} from "vscode";
import {
  CteCodeLensProvider,
  CteInfo,
} from "../code_lens_provider/cteCodeLensProvider";
import { SqlPreviewContentProvider } from "../content_provider/sqlPreviewContentProvider";
import { CteProfilerDecorationProvider } from "../cte_profiler/cteProfilerDecorationProvider";
import { CteProfilerService } from "../cte_profiler/cteProfilerService";
import { DBTClient } from "../dbt_client";
import { DBTProject } from "../dbt_client/dbtProject";
import { DBTProjectContainer } from "../dbt_client/dbtProjectContainer";
import { ProjectQuickPickItem } from "../quickpick/projectQuickPick";
import { DiagnosticsOutputChannel } from "../services/diagnosticsOutputChannel";
import { RunHistoryService } from "../services/runHistoryService";
import { RunTreeItem } from "../treeview_provider/runHistoryTreeItems";
import { deepEqual, getFirstWorkspacePath } from "../utils";
import { RunModel } from "./runModel";
import { RunTest } from "./runTest";
import { WalkthroughCommands } from "./walkthroughCommands";

export class VSCodeCommands implements Disposable {
  private disposables: Disposable[] = [];

  constructor(
    private dbtProjectContainer: DBTProjectContainer,
    private runModel: RunModel,
    private runTest: RunTest,
    private walkthroughCommands: WalkthroughCommands,
    @inject("DBTTerminal")
    private dbtTerminal: DBTTerminal,
    private diagnosticsOutputChannel: DiagnosticsOutputChannel,
    private dbtClient: DBTClient,
    private runHistoryService: RunHistoryService,
    private cteProfilerService: CteProfilerService,
    private cteProfilerDecorationProvider: CteProfilerDecorationProvider,
    private cteCodeLensProvider: CteCodeLensProvider,
  ) {
    this.disposables.push(
      this.cteProfilerService,
      this.cteProfilerDecorationProvider,
      commands.registerCommand("fusionPowerUser.runCurrentModel", () => {
        // `dbt run` on a singular test file is never meaningful; route it
        // to `dbt test --select <test>` instead.
        if (this.runTest.runSingularTestOnActiveWindowIfApplicable()) {
          return;
        }
        this.runModel.runModelOnActiveWindow();
      }),
      commands.registerCommand(
        "fusionPowerUser.rerunFromHistory",
        (item: RunTreeItem) => {
          this.dbtProjectContainer.rerunFromHistory(item.entry);
        },
      ),
      commands.registerCommand("fusionPowerUser.clearRunHistory", async () => {
        const confirm = await window.showWarningMessage(
          "Clear all run history entries?",
          { modal: true },
          "Clear",
        );
        if (confirm === "Clear") {
          this.runHistoryService.clear();
        }
      }),
      commands.registerCommand(
        "fusionPowerUser.profileCtes",
        async (uri?: Uri, ctes?: CteInfo[]) => {
          // When called from command palette, args are undefined — use active editor
          const source = uri ? "codeLens" : "commandPalette";
          const activeEditor = window.activeTextEditor;
          const docUri = uri ?? activeEditor?.document.uri;
          if (!docUri) {
            window.showErrorMessage("No active SQL file to profile.");
            return;
          }

          let document = workspace.textDocuments.find(
            (doc) => doc.uri.toString() === docUri.toString(),
          );
          if (!document) {
            try {
              document = await workspace.openTextDocument(docUri);
            } catch (error) {
              this.dbtTerminal.error(
                "CteProfiler",
                "Failed to open document",
                error,
              );
              window.showErrorMessage("Document not found");
              return;
            }
          }

          // If ctes not provided (command palette), re-detect from CodeLens provider
          if (!ctes) {
            const cts = new CancellationTokenSource();
            // `provideCodeLenses` returns `CodeLens[] | Thenable<CodeLens[]>`;
            // `await` handles all three (sync array, Promise, custom Thenable).
            const resolved = await this.cteCodeLensProvider.provideCodeLenses(
              document,
              cts.token,
            );
            cts.dispose();
            // Extract CteInfo from CodeLens arguments (index 1 is the ctes array)
            const profileLens = resolved.find(
              (cl: CodeLens) =>
                cl.command?.command === "fusionPowerUser.profileCtes",
            );
            ctes = profileLens?.command?.arguments?.[1] as
              CteInfo[] | undefined;

            if (!ctes || ctes.length === 0) {
              window.showInformationMessage(
                "No CTEs found in this file to profile.",
              );
              return;
            }
          }

          const totalCtes = ctes.length;

          await window.withProgress(
            {
              location: ProgressLocation.Notification,
              title: `Profiling ${totalCtes} CTE${totalCtes === 1 ? "" : "s"}`,
              cancellable: true,
            },
            async (progress, token) => {
              // Forward notification cancel to the service's own token.
              token.onCancellationRequested(() => {
                this.cteProfilerService.cancel();
              });

              // Report per-CTE increments as the service fires result updates.
              let lastCount = 0;
              const progressSub = this.cteProfilerService.onResultChanged(
                (result) => {
                  if (!result || result.uri !== docUri.toString()) {
                    return;
                  }
                  const done = result.ctes.length;
                  if (done <= lastCount) {
                    return;
                  }
                  const delta = done - lastCount;
                  lastCount = done;
                  progress.report({
                    increment: (delta / totalCtes) * 100,
                    message: `${done}/${totalCtes} — ${result.ctes[done - 1]?.name ?? ""}`,
                  });
                },
              );

              try {
                await this.cteProfilerService.profileModel(
                  docUri,
                  document!,
                  ctes!,
                );
              } catch (error) {
                this.dbtTerminal.error(
                  "profileCtesError",
                  "Unable to profile CTEs",
                  error,
                );
              } finally {
                progressSub.dispose();
              }
            },
          );
        },
      ),
      commands.registerCommand("fusionPowerUser.cancelCteProfiling", () => {
        this.cteProfilerService.cancel();
      }),
      commands.registerCommand("fusionPowerUser.clearProfileResults", () =>
        this.cteProfilerService.clearResults(),
      ),
      commands.registerCommand("fusionPowerUser.toggleProfileDecorations", () =>
        this.cteProfilerDecorationProvider.toggle(),
      ),
      commands.registerCommand("fusionPowerUser.testCurrentModel", () => {
        // Singular data tests must be selected by their own test name, not
        // the surrounding model.
        if (this.runTest.runSingularTestOnActiveWindowIfApplicable()) {
          return;
        }
        this.runModel.runTestsOnActiveWindow();
      }),
      commands.registerCommand("fusionPowerUser.compileCurrentModel", () =>
        this.runModel.compileModelOnActiveWindow(),
      ),
      commands.registerTextEditorCommand(
        "fusionPowerUser.sqlPreview",
        async (editor: TextEditor) => {
          const uri = editor.document.uri.with({
            scheme: SqlPreviewContentProvider.SCHEME,
          });
          const doc = await workspace.openTextDocument(uri);
          const isOpen = window.visibleTextEditors.some(
            (e) => e.document.uri === uri,
          );
          await window.showTextDocument(doc, ViewColumn.Beside, false);
          await languages.setTextDocumentLanguage(doc, "sql");
          if (!isOpen) {
            await commands.executeCommand("workbench.action.lockEditorGroup");
            await commands.executeCommand(
              "workbench.action.focusPreviousGroup",
            );
          } else {
            await commands.executeCommand("workbench.action.closeActiveEditor");
            return;
          }
        },
      ),
      commands.registerCommand(
        "fusionPowerUser.goToDocumentationEditor",
        async () => {
          await commands.executeCommand(
            "workbench.view.extension.docs_edit_view",
          );
        },
      ),
      commands.registerCommand("fusionPowerUser.runTest", (model) => {
        // Tree-item invocation (from the test treeview): run the selected
        // test node — never a singular test, always a generic test.
        if (model !== undefined) {
          this.runModel.runModelOnNodeTreeItem(RunModelType.TEST)(model);
          return;
        }
        // Command-palette invocation (no tree item): route singular test
        // files to `dbt test --select <test>`; otherwise fall back to
        // running the generic tests attached to the active model.
        if (this.runTest.runSingularTestOnActiveWindowIfApplicable()) {
          return;
        }
        this.runModel.runModelOnNodeTreeItem(RunModelType.TEST)(model);
      }),
      commands.registerCommand("fusionPowerUser.runChildrenModels", (model) =>
        this.runModel.runModelOnNodeTreeItem(RunModelType.RUN_CHILDREN)(model),
      ),
      commands.registerCommand(
        "fusionPowerUser.yamlRunModel",
        (uri: Uri, modelName: string) => {
          this.dbtProjectContainer.runModelByName(uri, modelName);
        },
      ),
      commands.registerCommand(
        "fusionPowerUser.yamlTestModel",
        (uri: Uri, modelName: string) => {
          this.dbtProjectContainer.runModelTest(uri, modelName);
        },
      ),
      commands.registerCommand("fusionPowerUser.runParentModels", (model) =>
        this.runModel.runModelOnNodeTreeItem(RunModelType.RUN_PARENTS)(model),
      ),
      commands.registerCommand("fusionPowerUser.copyModelName", (model) =>
        env.clipboard.writeText(model.label.toString()),
      ),
      commands.registerCommand("fusionPowerUser.showRunSQL", () =>
        this.runModel.showRunSQLOnActiveWindow(),
      ),
      commands.registerCommand("fusionPowerUser.showCompiledSQL", () =>
        this.runModel.showCompiledSQLOnActiveWindow(),
      ),
      commands.registerCommand("fusionPowerUser.generateSchemaYML", () =>
        this.runModel.generateSchemaYMLOnActiveWindow(),
      ),
      commands.registerCommand("fusionPowerUser.executeSQL", () =>
        this.runModel.executeQueryOnActiveWindow(),
      ),
      commands.registerCommand(
        "fusionPowerUser.runCteWithDependencies",
        (uri: Uri, cteIndex: number, ctes: CteInfo[]) =>
          this.runCteWithDependencies(uri, cteIndex, ctes),
      ),
      commands.registerCommand(
        "fusionPowerUser.createModelBasedonSourceConfig",
        (params) => {
          this.runModel.createModelBasedonSourceConfig(params);
        },
      ),
      commands.registerCommand("fusionPowerUser.buildCurrentModel", () =>
        this.runModel.buildModelOnActiveWindow(),
      ),
      commands.registerCommand("fusionPowerUser.buildCurrentProject", () => {
        if (!window.activeTextEditor) {
          return;
        }
        const activeFileUri = window.activeTextEditor.document.uri;
        if (!activeFileUri) {
          this.dbtTerminal.debug(
            "buildCurrentProject",
            "skipping buildCurrentProject without active file",
          );
          return;
        }

        const dbtProject =
          this.dbtProjectContainer.findDBTProject(activeFileUri);
        if (!dbtProject) {
          this.dbtTerminal.debug(
            "buildCurrentProject",
            `buildCurrentProject unable to find dbtproject by active file: ${activeFileUri.path}`,
          );
          return;
        }
        this.dbtTerminal.debug(
          "buildCurrentProject",
          `building current project: ${dbtProject.getProjectName()} with active file: ${
            activeFileUri.path
          }`,
        );

        dbtProject.buildProject();
      }),
      commands.registerCommand("fusionPowerUser.cleanCurrentProject", () => {
        if (!window.activeTextEditor) {
          return;
        }
        const activeFileUri = window.activeTextEditor.document.uri;
        if (!activeFileUri) {
          this.dbtTerminal.debug(
            "cleanCurrentProject",
            "skipping cleanCurrentProject without active file",
          );
          return;
        }

        const dbtProject =
          this.dbtProjectContainer.findDBTProject(activeFileUri);
        if (!dbtProject) {
          this.dbtTerminal.debug(
            "cleanCurrentProject",
            `cleanCurrentProject unable to find dbtproject by active file: ${activeFileUri.path}`,
          );
          return;
        }
        this.dbtTerminal.debug(
          "cleanCurrentProject",
          `cleaning current project: ${dbtProject.getProjectName()} with active file: ${
            activeFileUri.path
          }`,
        );

        dbtProject.clean();
      }),
      commands.registerCommand("fusionPowerUser.buildChildrenModels", () =>
        this.runModel.buildModelOnActiveWindow(RunModelType.BUILD_CHILDREN),
      ),
      commands.registerCommand("fusionPowerUser.buildParentModels", () =>
        this.runModel.buildModelOnActiveWindow(RunModelType.BUILD_PARENTS),
      ),
      commands.registerCommand(
        "fusionPowerUser.buildChildrenParentModels",
        () =>
          this.runModel.buildModelOnActiveWindow(
            RunModelType.BUILD_CHILDREN_PARENTS,
          ),
      ),
      commands.registerCommand("fusionPowerUser.validateProject", async () => {
        const pickedProject: ProjectQuickPickItem | undefined =
          this.dbtProjectContainer.getFromWorkspaceState(
            "fusionPowerUser.projectSelected",
          );

        await this.walkthroughCommands.validateProjects(pickedProject);
      }),
      commands.registerCommand("fusionPowerUser.installDeps", async () => {
        const pickedProject: ProjectQuickPickItem | undefined =
          this.dbtProjectContainer.getFromWorkspaceState(
            "fusionPowerUser.projectSelected",
          );
        await this.walkthroughCommands.installDeps(pickedProject);
      }),
      commands.registerCommand("fusionPowerUser.viewInDocEditor", () =>
        commands.executeCommand("fusionPowerUser.DocsEdit.focus"),
      ),
      commands.registerCommand("fusionPowerUser.diagnostics", async () => {
        try {
          this.diagnosticsOutputChannel.show();
          this.diagnosticsOutputChannel.logLine("Diagnostics started...");
          this.diagnosticsOutputChannel.logNewLine();

          this.diagnosticsOutputChannel.logBlockWithHeader(
            [
              "Printing extension host environment variables...",
              "* Please remove any sensitive information before sending it to us",
            ],
            Object.entries(process.env).map(
              ([key, value]) => `${key}=${value}`,
            ),
          );
          this.diagnosticsOutputChannel.logNewLine();

          // Printing extension settings
          const dbtSettings = workspace.getConfiguration().inspect("dbt");
          const globalValue: any = dbtSettings?.globalValue || {};
          const defaultValue: any = dbtSettings?.defaultValue || {};
          const workspaceValue: any = dbtSettings?.workspaceValue || {};
          const settingKeys = [
            ...Object.keys(globalValue),
            ...Object.keys(defaultValue),
            ...Object.keys(workspaceValue),
          ];
          this.diagnosticsOutputChannel.logBlockWithHeader(
            [
              "Printing extension settings...",
              "* Please remove any sensitive information before sending it to us",
            ],
            settingKeys.map((key) => {
              const value = workspace.getConfiguration("dbt").get(key);
              let overridenText = "";
              if (!deepEqual(value, defaultValue[key])) {
                if (deepEqual(value, workspaceValue[key])) {
                  overridenText = `${key} is overridden in workspace settings`;
                } else if (deepEqual(value, globalValue[key])) {
                  overridenText = `${key} is overridden in user settings`;
                }
              }

              const valueText =
                Array.isArray(value) || typeof value === "object"
                  ? JSON.stringify(value)
                  : value;
              return `${key}=${valueText}\t\t${overridenText}`;
            }),
          );
          this.diagnosticsOutputChannel.logNewLine();

          // Printing extension and setup info
          this.diagnosticsOutputChannel.logBlock([
            `VSCode version=${version}`,
            `Extension version=${
              extensions.getExtension("innoverio.vscode-dbt-power-user")
                ?.packageJSON?.version
            }`,
            "DBT integration mode=fusion",
            `First workspace path=${getFirstWorkspacePath()}`,
          ]);
          this.diagnosticsOutputChannel.logNewLine();

          if (!this.dbtClient.dbtInstalled) {
            this.diagnosticsOutputChannel.logLine("DBT is not installed");
            this.diagnosticsOutputChannel.logLine(
              "Can't proceed further without fixing dbt installation",
            );
            return;
          }
          this.diagnosticsOutputChannel.logLine("DBT is installed");

          const projects = this.dbtProjectContainer.getProjects();
          this.diagnosticsOutputChannel.logLine(
            `Number of projects=${projects.length}`,
          );
          if (projects.length === 0) {
            this.diagnosticsOutputChannel.logLine("No project detected");
            this.diagnosticsOutputChannel.logLine(
              "Can't proceed further without project",
            );
            return;
          }
          this.diagnosticsOutputChannel.logNewLine();

          for (const project of projects) {
            try {
              this.diagnosticsOutputChannel.logHorizontalRule();
              this.diagnosticsOutputChannel.logLine(
                `Printing information for ${project.getProjectName()}`,
              );
              this.diagnosticsOutputChannel.logHorizontalRule();
              await this.printProjectInfo(project);
            } catch (e) {
              this.diagnosticsOutputChannel.logNewLine();
              this.diagnosticsOutputChannel.logLine(
                "Failed to print all the info for the project...",
              );
              this.diagnosticsOutputChannel.logLine(`Error=${e}`);
            } finally {
              this.diagnosticsOutputChannel.logHorizontalRule();
            }
          }
          this.diagnosticsOutputChannel.logNewLine();
          this.diagnosticsOutputChannel.logLine(
            "Diagnostics completed successfully...",
          );
        } catch (e) {
          this.diagnosticsOutputChannel.logNewLine();
          this.diagnosticsOutputChannel.logLine(
            "Diagnostics ended with error...",
          );
          this.diagnosticsOutputChannel.logLine(`Error=${e}`);
        }
      }),
      commands.registerCommand("fusionPowerUser.applyDeferConfig", async () => {
        const projects = this.dbtProjectContainer.getProjects();
        try {
          await Promise.all(
            projects.map((project) => project.applyDeferConfig()),
          );
          window.showInformationMessage("Applied defer configuration");
        } catch (error) {
          this.dbtTerminal.error(
            "applyDeferConfig",
            "Failed to apply defer configuration",
            error,
          );
          window.showErrorMessage(
            `Failed to apply defer configuration: ${error}`,
          );
        }
      }),
    );
  }

  private async printProjectInfo(project: DBTProject) {
    this.diagnosticsOutputChannel.logLine(
      `Project Name=${project.getProjectName()}`,
    );
    this.diagnosticsOutputChannel.logLine(
      `Adapter Type=${project.getAdapterType()}`,
    );

    const dbtVersion = project.getDBTVersion();
    if (!dbtVersion) {
      this.diagnosticsOutputChannel.logLine("DBT is not initialized properly");
    } else {
      this.diagnosticsOutputChannel.logLine(
        `DBT version=${dbtVersion.join(".")}`,
      );
    }

    this.diagnosticsOutputChannel.logNewLine();

    const targetPath = project.getTargetPath();
    const paths = [
      {
        pathType: "DBT Project File",
        path: project.getDBTProjectFilePath(),
      },
      { pathType: "Target", path: targetPath },
      {
        pathType: "PackageInstall",
        path: project.getPackageInstallPath(),
      },
      {
        pathType: "Manifest",
        path: targetPath ? join(targetPath, MANIFEST_FILE) : undefined,
      },
      {
        pathType: "Catalog",
        path: targetPath ? join(targetPath, CATALOG_FILE) : undefined,
      },
      ...(project.getModelPaths() || []).map((path) => ({
        pathType: "Model",
        path,
      })),
      ...(project.getSeedPaths() || []).map((path) => ({
        pathType: "Seed",
        path,
      })),
      ...(project.getMacroPaths() || []).map((path) => ({
        pathType: "Macro",
        path,
      })),
    ];

    for (const p of paths) {
      if (!p.path) {
        this.diagnosticsOutputChannel.logLine(`${p.pathType} path not found`);
        continue;
      }
      let line = `${p.pathType} path=${p.path}\t\t`;
      if (!existsSync(p.path)) {
        line += "File doesn't exists at location";
      } else {
        line += "File exists at location";
      }
      this.diagnosticsOutputChannel.logLine(line);
    }

    const dbtProjectFilePath = project.getDBTProjectFilePath();
    if (existsSync(dbtProjectFilePath)) {
      this.diagnosticsOutputChannel.logNewLine();
      this.diagnosticsOutputChannel.logNewLine();
      this.diagnosticsOutputChannel.logLine("dbt_project.yml");
      this.diagnosticsOutputChannel.logHorizontalRule();
      const fileContent = readFileSync(dbtProjectFilePath, "utf8");
      this.diagnosticsOutputChannel.logLine(fileContent.replace(/\n/g, "\r\n"));
      this.diagnosticsOutputChannel.logHorizontalRule();
    }

    this.diagnosticsOutputChannel.logNewLine();
    const diagnostics = project.getAllDiagnostic();
    this.diagnosticsOutputChannel.logLine(
      `Number of diagnostics issues=${diagnostics.length}`,
    );
    for (const d of diagnostics) {
      this.diagnosticsOutputChannel.logLine(d.message);
    }
    await project.debug(false);
  }

  private async runCteWithDependencies(
    uri: Uri,
    cteIndex: number,
    ctes: CteInfo[],
  ): Promise<void> {
    this.dbtTerminal.debug(
      "CteExecution",
      `Starting CTE execution for index ${cteIndex} with ${ctes.length} total CTEs`,
    );

    try {
      // Get the document asynchronously
      let document = workspace.textDocuments.find(
        (doc) => doc.uri.toString() === uri.toString(),
      );

      if (!document) {
        // Try to open the document if not found in workspace
        try {
          document = await workspace.openTextDocument(uri);
        } catch (error) {
          this.dbtTerminal.error(
            "CteExecution",
            `Failed to open document: ${uri.toString()}`,
            error,
          );
          window.showErrorMessage("Document not found and could not be opened");
          return;
        }
      }

      const text = document.getText();

      // Find the target CTE and all its dependencies
      const targetCte = ctes[cteIndex];
      if (!targetCte) {
        this.dbtTerminal.warn(
          "CteExecution",
          `CTE not found at index ${cteIndex}, available CTEs: ${ctes.length}`,
        );
        window.showErrorMessage("CTE not found");
        return;
      }

      this.dbtTerminal.debug(
        "CteExecution",
        `Target CTE: ${targetCte.name} (index: ${targetCte.index})`,
      );

      // Get all CTEs from the same WITH clause that come before or at the target index
      const sameScopeCtesUpToTarget = ctes.filter(
        (cte) =>
          cte.withClauseStart === targetCte.withClauseStart &&
          cte.index <= targetCte.index,
      );

      this.dbtTerminal.debug(
        "CteExecution",
        `Found ${sameScopeCtesUpToTarget.length} CTEs in dependency chain: ${sameScopeCtesUpToTarget.map((c) => c.name).join(", ")}`,
      );

      // Build the complete query with dependencies
      const cteDefinitions: string[] = [];

      for (const cte of sameScopeCtesUpToTarget) {
        // Extract the full CTE definition (name + AS + query)
        const cteStart = cte.range.start;

        // Get from CTE name to end of its query
        const cteStartPos = document.offsetAt(cteStart);

        // Improved regex to handle quoted identifiers, dotted names, and complex column lists
        // Supports: identifier, "quoted identifier", schema.table, `backtick quoted`, [bracket quoted]
        const cteNameMatch = text
          .substring(cteStartPos)
          .match(
            /^((?:[a-zA-Z_][a-zA-Z0-9_]*|"[^"]+"|`[^`]+`|\[[^\]]+\])(?:\.(?:[a-zA-Z_][a-zA-Z0-9_]*|"[^"]+"|`[^`]+`|\[[^\]]+\]))*(?:\s*\([^)]*\))?)\s+as\s*\(/i,
          );

        if (cteNameMatch) {
          const cteQuery = document.getText(cte.queryRange);
          const fullCteDefinition = `${cteNameMatch[1]} AS (\n${cteQuery}\n)`;
          cteDefinitions.push(fullCteDefinition);

          this.dbtTerminal.debug(
            "CteExecution",
            `Added CTE to query: ${cteNameMatch[1]} (${cteQuery.length} chars)`,
          );
        } else {
          this.dbtTerminal.warn(
            "CteExecution",
            `Could not parse CTE definition for: ${cte.name}`,
          );
        }
      }

      // Check if we have any valid CTE definitions
      if (cteDefinitions.length === 0) {
        this.dbtTerminal.warn(
          "CteExecution",
          "No valid CTE definitions found, cannot build query",
        );
        window.showErrorMessage("Failed to extract CTE definitions");
        return;
      }

      // Build the complete query including preamble before WITH clause
      // Extract everything before the WITH clause (dbt configs, variables, etc.)
      const preamble = text.substring(0, targetCte.withClauseStart).trim();

      let query = "";
      if (preamble) {
        query += preamble + "\n\n";
        this.dbtTerminal.debug(
          "CteExecution",
          `Including preamble (${preamble.length} chars) before WITH clause`,
        );
      }

      query += "WITH ";
      query += cteDefinitions.join(",\n");

      // Add a simple SELECT to execute the target CTE with proper quoting
      const quotedTargetName = this.quoteSqlIdentifier(targetCte.name);
      query += `\nSELECT * FROM ${quotedTargetName}`;

      this.dbtTerminal.debug(
        "CteExecution",
        `Generated query length: ${query.length} characters`,
      );

      // Create a unique model name with timestamp to prevent collisions
      const timestamp = Date.now();
      const hash = this.generateShortHash(targetCte.name + timestamp);
      const modelName = `cte_${targetCte.name}_${hash}`;

      this.dbtTerminal.debug(
        "CteExecution",
        `Executing CTE query with model name: ${modelName}`,
      );

      await this.runModel.executeSQL(uri, query, modelName);
    } catch (error) {
      this.dbtTerminal.error(
        "CteExecution",
        "Unexpected error in runCteWithDependencies",
        error,
      );
      window.showErrorMessage(
        `Failed to execute CTE: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  private quoteSqlIdentifier(identifier: string): string {
    // If identifier is already quoted or contains dots, return as-is
    if (identifier.match(/^["'`\[]/) || identifier.includes(".")) {
      return identifier;
    }

    // If identifier contains special characters or spaces, quote it
    if (!identifier.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
      return `"${identifier}"`;
    }

    return identifier;
  }

  private generateShortHash(input: string): string {
    // Simple hash function to generate a short unique suffix
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36).substring(0, 6);
  }

  dispose() {
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}
