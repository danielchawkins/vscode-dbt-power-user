import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import {
  CodeLens,
  commands,
  Disposable,
  env,
  extensions,
  ProgressLocation,
  TextEditor,
  Uri,
  version,
  ViewColumn,
  window,
  workspace,
} from "vscode";
import { previewSql, type FusionCte } from "../core/cte/ctePreview";
import type { Log } from "../core/log";
import { DBT_PROJECT_FILE, readDbtProjectFile } from "../core/project";
import {
  CATALOG_FILE,
  MANIFEST_FILE,
  RunModelType,
} from "../dbt_integration/domain";
import { ExtensionContextStore } from "../extensionContext";
import { activeModelUri, previewUriFor } from "../projects/previewUri";
import { Project } from "../projects/project";
import { ProjectQuickPickItem } from "../projects/projectQuickPick";
import { Projects } from "../projects/projects";
import { RunHistoryService } from "../projects/runHistoryService";
import { inspectSettings, readEnvironment } from "../settings";
import { StartupGate } from "../startupGate";
import { getFirstWorkspacePath } from "../utils";
import { CteProfilerDecorationProvider } from "./cte/cteProfilerDecorationProvider";
import { CteProfilerService } from "./cte/cteProfilerService";
import { DeferToProductionStatusBar } from "./defer/deferToProductionStatusBar";
import { DiagnosticsOutputChannel } from "./diagnostics/diagnosticsOutputChannel";
import { ProjectSetupCommands } from "./projectSetup/projectSetupCommands";
import { RunModel } from "./run/runModel";
import { RunTest } from "./run/runTest";
import { rerunFromHistory } from "./runHistory/rerunFromHistory";
import { RunTreeItem } from "./runHistory/runHistoryTreeItems";

export class VSCodeCommands implements Disposable {
  private disposables: Disposable[] = [];

  constructor(
    private projects: Projects,
    private extensionContext: ExtensionContextStore,
    private runModel: RunModel,
    private runTest: RunTest,
    private projectSetupCommands: ProjectSetupCommands,
    private dbtTerminal: Log,
    private diagnosticsOutputChannel: DiagnosticsOutputChannel,
    private runHistoryService: RunHistoryService,
    private cteProfilerService: CteProfilerService,
    private cteProfilerDecorationProvider: CteProfilerDecorationProvider,
    private deferToProductionStatusBar: DeferToProductionStatusBar,
    private startupGate: Pick<StartupGate, "whenSettled">,
  ) {
    this.disposables.push(
      this.diagnosticsOutputChannel,
      this.cteProfilerService,
      this.cteProfilerDecorationProvider,
      this.register("fusionPowerUser.runCurrentModel", () => {
        // `dbt run` on a singular test file is never meaningful; route it
        // to `dbt test --select <test>` instead.
        if (this.runTest.runSingularTestOnActiveWindowIfApplicable()) {
          return;
        }
        this.runModel.runModelOnActiveWindow();
      }),
      this.register("fusionPowerUser.rerunFromHistory", (item: RunTreeItem) => {
        rerunFromHistory(item.entry, (name) => this.projects.byName(name));
      }),
      this.register("fusionPowerUser.clearRunHistory", async () => {
        const confirm = await window.showWarningMessage(
          "Clear all run history entries?",
          { modal: true },
          "Clear",
        );
        if (confirm === "Clear") {
          this.runHistoryService.clear();
        }
      }),
      this.register(
        "fusionPowerUser.profileCtes",
        async (uri?: Uri, ctes?: FusionCte[]) => {
          // When called from command palette, args are undefined — use active editor
          const activeEditor = window.activeTextEditor;
          const docUri = uri ?? activeEditor?.document.uri;
          if (!docUri) {
            window.showErrorMessage("No active SQL file to profile.");
            return;
          }

          // Called from the command palette: read the CTEs from the server's lenses.
          if (!ctes) {
            const lenses =
              (await commands.executeCommand<CodeLens[]>(
                "vscode.executeCodeLensProvider",
                docUri,
              )) ?? [];
            ctes = lenses.find(
              (lens) => lens.command?.command === "fusionPowerUser.profileCtes",
            )?.command?.arguments?.[1] as FusionCte[] | undefined;
            if (!ctes || ctes.length === 0) {
              window.showInformationMessage(
                "No CTEs found in this file to profile. Save the file first.",
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
                await this.cteProfilerService.profileModel(docUri, ctes);
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
      this.register("fusionPowerUser.cancelCteProfiling", () => {
        this.cteProfilerService.cancel();
      }),
      this.register("fusionPowerUser.clearProfileResults", () =>
        this.cteProfilerService.clearResults(),
      ),
      this.register("fusionPowerUser.toggleProfileDecorations", () =>
        this.cteProfilerDecorationProvider.toggle(),
      ),
      this.register("fusionPowerUser.testCurrentModel", () => {
        // Singular data tests must be selected by their own test name, not
        // the surrounding model.
        if (this.runTest.runSingularTestOnActiveWindowIfApplicable()) {
          return;
        }
        this.runModel.runTestsOnActiveWindow();
      }),
      this.register("fusionPowerUser.compileCurrentModel", () =>
        this.runModel.compileModelOnActiveWindow(),
      ),
      commands.registerTextEditorCommand(
        "fusionPowerUser.sqlPreview",
        (editor: TextEditor) => {
          void this.openCompiledPreview(editor.document.uri, true);
        },
      ),
      this.register("fusionPowerUser.goToDocumentationEditor", async () => {
        await commands.executeCommand(
          "workbench.view.extension.docs_edit_view",
        );
      }),
      this.register("fusionPowerUser.runTest", (model) => {
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
      this.register("fusionPowerUser.runChildrenModels", (model) =>
        this.runModel.runModelOnNodeTreeItem(RunModelType.RUN_CHILDREN)(model),
      ),
      this.register(
        "fusionPowerUser.yamlRunModel",
        (uri: Uri, modelName: string) => {
          const project = this.projects.get(uri);
          if (!project) {
            return;
          }
          void project.runModel({
            plusOperatorLeft: "",
            modelName,
            plusOperatorRight: "",
          });
        },
      ),
      this.register(
        "fusionPowerUser.yamlTestModel",
        (uri: Uri, modelName: string) => {
          const project = this.projects.get(uri);
          if (!project) {
            return;
          }
          void project.runModelTest(modelName);
        },
      ),
      this.register("fusionPowerUser.runParentModels", (model) =>
        this.runModel.runModelOnNodeTreeItem(RunModelType.RUN_PARENTS)(model),
      ),
      this.register("fusionPowerUser.copyModelName", (model) =>
        env.clipboard.writeText(model.label.toString()),
      ),
      this.register("fusionPowerUser.showRunSQL", () =>
        this.runModel.showRunSQLOnActiveWindow(),
      ),
      this.register("fusionPowerUser.showCompiledSQL", () => {
        const uri = window.activeTextEditor?.document.uri;
        return uri ? this.openCompiledPreview(uri, false) : undefined;
      }),
      this.register("fusionPowerUser.generateSchemaYML", () =>
        this.runModel.generateSchemaYMLOnActiveWindow(),
      ),
      this.register("fusionPowerUser.executeSQL", () =>
        this.runModel.executeQueryOnActiveWindow(),
      ),
      this.register(
        "fusionPowerUser.runCteWithDependencies",
        (target: { uri: Uri; cte: FusionCte }) =>
          this.runCte(target.uri, target.cte),
      ),
      this.register(
        "fusionPowerUser.createModelBasedonSourceConfig",
        (params) => {
          this.runModel.createModelBasedonSourceConfig(params);
        },
      ),
      this.register("fusionPowerUser.buildCurrentModel", () =>
        this.runModel.buildModelOnActiveWindow(),
      ),
      this.register("fusionPowerUser.buildCurrentProject", () => {
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

        const project = this.projects.get(activeFileUri);
        if (!project) {
          this.dbtTerminal.debug(
            "buildCurrentProject",
            `buildCurrentProject unable to find dbtproject by active file: ${activeFileUri.path}`,
          );
          return;
        }
        this.dbtTerminal.debug(
          "buildCurrentProject",
          `building current project: ${project.getProjectName()} with active file: ${
            activeFileUri.path
          }`,
        );

        void project.buildProject();
      }),
      this.register("fusionPowerUser.cleanCurrentProject", () => {
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

        const project = this.projects.get(activeFileUri);
        if (!project) {
          this.dbtTerminal.debug(
            "cleanCurrentProject",
            `cleanCurrentProject unable to find dbtproject by active file: ${activeFileUri.path}`,
          );
          return;
        }
        this.dbtTerminal.debug(
          "cleanCurrentProject",
          `cleaning current project: ${project.getProjectName()} with active file: ${
            activeFileUri.path
          }`,
        );

        void project.clean();
      }),
      this.register("fusionPowerUser.buildChildrenModels", () =>
        this.runModel.buildModelOnActiveWindow(RunModelType.BUILD_CHILDREN),
      ),
      this.register("fusionPowerUser.buildParentModels", () =>
        this.runModel.buildModelOnActiveWindow(RunModelType.BUILD_PARENTS),
      ),
      this.register("fusionPowerUser.buildChildrenParentModels", () =>
        this.runModel.buildModelOnActiveWindow(
          RunModelType.BUILD_CHILDREN_PARENTS,
        ),
      ),
      this.register("fusionPowerUser.validateProject", async () => {
        const pickedProject: ProjectQuickPickItem | undefined =
          this.extensionContext.getFromWorkspaceState(
            "fusionPowerUser.projectSelected",
          );

        await this.projectSetupCommands.validateProjects(pickedProject);
      }),
      this.register("fusionPowerUser.installDeps", async () => {
        const pickedProject: ProjectQuickPickItem | undefined =
          this.extensionContext.getFromWorkspaceState(
            "fusionPowerUser.projectSelected",
          );
        await this.projectSetupCommands.installDeps(pickedProject);
      }),
      this.register("fusionPowerUser.viewInDocEditor", () =>
        commands.executeCommand("fusionPowerUser.DocsEdit.focus"),
      ),
      this.register("fusionPowerUser.diagnostics", async () => {
        try {
          this.diagnosticsOutputChannel.show();
          this.diagnosticsOutputChannel.logLine("Diagnostics started...");
          this.diagnosticsOutputChannel.logNewLine();

          this.diagnosticsOutputChannel.logBlockWithHeader(
            [
              "Printing extension host environment variables...",
              "* Please remove any sensitive information before sending it to us",
            ],
            Object.entries(readEnvironment()).map(
              ([key, value]) => `${key}=${value}`,
            ),
          );
          this.diagnosticsOutputChannel.logNewLine();

          // Printing extension settings
          this.diagnosticsOutputChannel.logBlockWithHeader(
            [
              "Printing extension settings...",
              "* Please remove any sensitive information before sending it to us",
            ],
            inspectSettings().map(({ key, value, overriddenIn }) => {
              const overridenText = overriddenIn
                ? `${key} is overridden in ${overriddenIn} settings`
                : "";
              const valueText =
                typeof value === "string" ? value : JSON.stringify(value);
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

          const projects = this.projects.all();
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
      // Commands read defer settings when they run; this only refreshes the status bar.
      this.register("fusionPowerUser.applyDeferConfig", () => {
        this.deferToProductionStatusBar.updateStatusBar();
        window.showInformationMessage("Applied defer configuration");
      }),
    );
  }

  /** Registers a command whose handler runs once extension startup has settled. */
  private register(
    command: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors `commands.registerCommand`
    handler: (...args: any[]) => unknown,
  ): Disposable {
    return commands.registerCommand(command, async (...args: unknown[]) => {
      await this.startupGate.whenSettled();
      return handler(...args);
    });
  }

  /**
   * Shows the model's single live compiled preview beside it as SQL, reusing a visible preview's group and
   * keeping focus on the model. With `toggle`, a visible preview closes instead.
   */
  async openCompiledPreview(modelUri: Uri, toggle: boolean): Promise<void> {
    const uri = previewUriFor(activeModelUri(modelUri));
    const visible = window.visibleTextEditors.find(
      (e) => e.document.uri.toString() === uri.toString(),
    );
    if (visible && toggle) {
      await window.showTextDocument(
        visible.document,
        visible.viewColumn,
        false,
      );
      await commands.executeCommand("workbench.action.closeActiveEditor");
      return;
    }
    const doc = await workspace.openTextDocument(uri);
    await window.showTextDocument(doc, {
      viewColumn: visible?.viewColumn ?? ViewColumn.Beside,
      preserveFocus: true,
      preview: false,
    });
  }

  private async printProjectInfo(project: Project) {
    this.diagnosticsOutputChannel.logLine(
      `Project Name=${project.getProjectName()}`,
    );
    this.diagnosticsOutputChannel.logLine(
      `Adapter Type=${project.getAdapterType()}`,
    );

    const fusionVersion = project.getFusionVersion();
    this.diagnosticsOutputChannel.logLine(
      fusionVersion
        ? `Fusion version=${fusionVersion.raw.trim()}`
        : "Fusion is not initialized properly",
    );

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

    const projectFile = readDbtProjectFile(
      dirname(project.getDBTProjectFilePath()),
    );
    if (projectFile.kind === "unreadable") {
      throw new Error(projectFile.message);
    }
    if (projectFile.kind !== "missing") {
      this.diagnosticsOutputChannel.logNewLine();
      this.diagnosticsOutputChannel.logNewLine();
      this.diagnosticsOutputChannel.logLine(DBT_PROJECT_FILE);
      this.diagnosticsOutputChannel.logHorizontalRule();
      this.diagnosticsOutputChannel.logLine(
        projectFile.text.replace(/\n/g, "\r\n"),
      );
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
    await project.debug();
  }

  private async runCte(uri: Uri, cte: FusionCte): Promise<void> {
    try {
      const query = previewSql(readFileSync(cte.compiledPath), cte);
      const hash = Date.now().toString(36).slice(-6);
      await this.runModel.executeSQL(uri, query, `cte_${cte.name}_${hash}`);
    } catch (error) {
      this.dbtTerminal.error("CteExecution", "Unable to execute CTE", error);
      window.showErrorMessage(
        `Failed to execute CTE: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
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
