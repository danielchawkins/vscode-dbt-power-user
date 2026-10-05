import {
  documentationEditor,
  ShowNotification,
} from "@fusion-power-user/webview-contract";
import { existsSync, readFileSync } from "fs";
import * as path from "path";
import {
  CancellationToken,
  commands,
  Disposable,
  ProgressLocation,
  TextEditor,
  Uri,
  WebviewView,
  WebviewViewProvider,
  WebviewViewResolveContext,
  window,
} from "vscode";
import { parse, parseDocument, stringify, YAMLMap, YAMLSeq } from "yaml";
import {
  beginWebviewResolve,
  completeWebviewReady,
} from "../../benchmark/runtimeTimings";
import {
  DBTTerminal,
  TestMetaData,
  TestMetadataAcceptedValues,
  TestMetadataRelationships,
} from "../../dbt_integration";
import { ExtensionContextStore } from "../../extensionContext";
import { UserInputError } from "../../local/errors";
import { publicationId } from "../../projects/manifest";
import { activeModelUri } from "../../projects/previewUri";
import { Project } from "../../projects/project";
import { Projects } from "../../projects/projects";
import { QueryManifestService } from "../../projects/queryManifestService";
import { writeUserFile } from "../../projects/userFiles";
import {
  getColumnNameByCase,
  getColumnTestConfigFromYml,
  isAcceptedValues,
  isColumnNameEqual,
  isQuotedIdentifier,
  isRelationship,
  removeProtocol,
} from "../../utils";
import {
  dispatchMessage,
  Handlers,
  MessageOf,
} from "../../webview/messageRouter";
import { panelHtml, panelWebviewOptions } from "../../webview/panelHtml";
import { DbtTestService } from "./dbtTestService";
import {
  DocGenService,
  DocumentationSchema,
  DocumentationSchemaColumn,
} from "./docGenService";
import { DBTDocumentation, MetadataColumn } from "./docGenTypes";

type HostMessage = documentationEditor.HostMessage;
type PanelMessage = documentationEditor.PanelMessage;
type SaveMessage = MessageOf<PanelMessage, "saveDocumentation">;

export class DocsEditViewPanel implements WebviewViewProvider, Disposable {
  public static readonly viewType = "fusionPowerUser.DocsEdit";
  private readonly entry = "documentationEditor";
  private _panel: WebviewView | undefined = undefined;
  private documentation?: DBTDocumentation;
  /** Unsaved drafts by model file path; host memory only, never webview state. */
  private readonly drafts = new Map<
    string,
    documentationEditor.DocumentationDraft
  >();
  private loadedFromManifest = false;
  private _disposables: Disposable[] = [];
  private onMessageDisposable: Disposable | undefined;

  public constructor(
    private projects: Projects,
    private extensionContext: ExtensionContextStore,
    private docGenService: DocGenService,
    private dbtTestService: DbtTestService,
    private queryManifestService: QueryManifestService,
    private terminal: DBTTerminal,
  ) {
    this._disposables.push(
      projects.onDidChangeManifest(() => this.onManifestChanged()),
      projects.onDidRemoveProject((root) => {
        this.forgetDrafts(root);
        void this.onManifestChanged();
      }),
      window.onDidChangeActiveTextEditor(
        async (event: TextEditor | undefined) => {
          this.documentation = undefined;
          if (event === undefined) {
            return;
          }
          if (this._panel) {
            this.transmitData();
          }
        },
      ),
    );
  }

  dispose() {
    this.onMessageDisposable?.dispose();
    this.onMessageDisposable = undefined;
    while (this._disposables.length) {
      this._disposables.pop()?.dispose();
    }
  }

  private getProject(): Project | undefined {
    if (!window.activeTextEditor) {
      return undefined;
    }
    const currentFilePath = activeModelUri(
      window.activeTextEditor.document.uri,
    );
    return this.projects.get(currentFilePath);
  }

  private getDbtTestCode(test: TestMetaData, modelName: string) {
    return {
      sql: test.path?.endsWith(".sql")
        ? readFileSync(test.path, { encoding: "utf-8" })
        : undefined,
      config: this.dbtTestService.getConfigByTest(
        test,
        modelName,
        test.column_name,
      ),
    };
  }

  private async transmitError() {
    await this.post({ command: "renderError" });
  }

  private post(message: HostMessage): Thenable<boolean> | undefined {
    return this._panel?.webview.postMessage(message);
  }

  private forgetDrafts(root: Uri) {
    const prefix = root.fsPath.endsWith(path.sep)
      ? root.fsPath
      : root.fsPath + path.sep;
    for (const model of this.drafts.keys()) {
      if (model.startsWith(prefix)) {
        this.drafts.delete(model);
      }
    }
  }

  private saveDraft({ model, draft }: MessageOf<PanelMessage, "saveDraft">) {
    if (draft) {
      this.drafts.set(model, draft);
    } else {
      this.drafts.delete(model);
    }
  }

  private async transmitData() {
    const { documentation, message } =
      await this.docGenService.getUncompiledDocumentationForCurrentActiveFile();
    this.documentation = documentation;
    if (this._panel) {
      await this.post({
        command: "renderDocumentation",
        docs: this.documentation,
        missingDocumentationMessage: message,
        tests: await this.dbtTestService.getTestsForCurrentModel(),
        unitTests: await this.dbtTestService.getUnitTestsForCurrentModel(),
        project: this.getProject()?.getProjectName(),
        docBlocks: this.getDocBlocksForCurrentProject(),
        publication: publicationId(this.getProject()?.manifest),
        draft: this.documentation
          ? this.drafts.get(this.documentation.filePath)
          : undefined,
      });
    }
  }

  private getDocBlocksForCurrentProject(): Array<{
    name: string;
    path: string;
  }> {
    const project = this.getProject();
    if (!project) {
      return [];
    }

    const manifestEvent = project.manifest;
    if (!manifestEvent?.docMetaMap) {
      return [];
    }

    return Array.from(manifestEvent.docMetaMap.entries()).map(
      ([name, metaData]) => ({
        name,
        path: metaData.path,
      }),
    );
  }

  private async transmitColumns(columns: MetadataColumn[]) {
    await this.post({ command: "renderColumnsFromMetadataFetch", columns });
  }

  public async resolveWebviewView(
    panel: WebviewView,
    context: WebviewViewResolveContext,
    _token: CancellationToken,
  ) {
    beginWebviewResolve(this.entry);
    this._panel = panel;
    this.setupWebviewOptions(context);
    this.renderWebviewView(context);
    this.setupWebviewHooks();
    this.transmitData();
  }

  private renderWebviewView(context: WebviewViewResolveContext) {
    const webview = this._panel!.webview;
    webview.html = panelHtml(webview, this.extensionContext.extensionUri, {
      entry: this.entry,
      csp: {},
    });
  }

  private setupWebviewOptions(context: WebviewViewResolveContext) {
    this._panel!.title = "";
    this._panel!.description = "Edit model documentation";
    this._panel!.webview.options = panelWebviewOptions(
      this.extensionContext.extensionUri,
    );
  }

  private getTestDataByModel(
    message: any,
    modelName: string,
    existingModel?: any,
  ) {
    const tests = message.updatedTests as undefined | TestMetaData[];

    if (!tests?.length) {
      this.terminal.debug(
        "docsEditViewPanel:getTestDataByModel",
        "No test data passed",
      );
      return;
    }

    const updatedTests = tests.filter((test) => {
      const modelNameInTest = test.test_metadata?.kwargs.model;
      if (test.column_name || !modelNameInTest) {
        return false;
      }
      if (modelNameInTest === modelName) {
        return true;
      }
      // model name could be {{ get_where_subquery(ref('dim_hosts_cleansed')) }}
      if (modelNameInTest.match(/'([^']+)'/)?.[1] === modelName) {
        return true;
      }
      return false;
    });

    const finalTests = updatedTests
      .map((test) => {
        if (!test?.test_metadata) {
          return null;
        }
        const { name, namespace, kwargs } = test.test_metadata;
        const fullName: string = namespace ? `${namespace}.${name}` : name;
        // Add extra config from external packages or test macros
        const testMetaKwargs = this.getTestMetadataKwArgs(kwargs, fullName);
        return testMetaKwargs || fullName;
      })
      .filter((t) => Boolean(t));
    const filteredTests = this.dbtTestService.removeDuplicateTests(finalTests);
    if (!filteredTests.length) {
      return;
    }

    // Keeps `tests` when the model's YAML already uses that key.
    if (existingModel?.tests === undefined) {
      return { data_tests: filteredTests };
    }

    return { tests: filteredTests };
  }

  private getTestMetadataKwArgs(
    kwargs: TestMetadataAcceptedValues | TestMetadataRelationships,
    fullName: string,
  ) {
    if (kwargs) {
      const rest = Object.entries(kwargs).reduce(
        (acc: Record<string, unknown>, [key, value]) => {
          // Ignore these fields as it will be added by default
          if (key === "column_name" || key === "model") {
            return acc;
          }

          acc[key] = value;
          return acc;
        },
        {},
      );
      if (Object.keys(rest)?.length) {
        return {
          [fullName]: rest,
        };
      }
    }
  }
  private getTestDataByColumn(
    message: any,
    columnNameFromWebview: string,
    existingColumn?: any,
  ) {
    const tests = message.updatedTests as undefined | TestMetaData[];

    if (!tests?.length) {
      this.terminal.debug(
        "docsEditViewPanel:getTestDataByColumn",
        "No test data passed",
      );
      return;
    }

    const columnTests = tests.filter((test) =>
      isColumnNameEqual(test.column_name, columnNameFromWebview),
    );

    // No tests for this column - may be all deleted
    if (!columnTests.length) {
      return;
    }

    const data = columnTests.map((test) => {
      if (!test.test_metadata) {
        return null;
      }
      const { name, namespace, kwargs } = test.test_metadata;
      const testFullName: string = namespace ? `${namespace}.${name}` : name;

      const columnTestConfigFromYml = getColumnTestConfigFromYml(
        existingColumn?.tests,
        kwargs,
        testFullName,
      );
      // If relationships test, set field and to
      if (isRelationship(kwargs)) {
        const { to, field } = kwargs;
        return {
          relationships: {
            ...columnTestConfigFromYml,
            field,
            to,
          },
        };
      }

      // set values if test is accepted_values
      if (isAcceptedValues(kwargs)) {
        return {
          accepted_values: {
            ...columnTestConfigFromYml,
            values: kwargs.values,
          },
        };
      }

      if (columnTestConfigFromYml) {
        return columnTestConfigFromYml;
      }

      // Add extra config from external packages or test macros
      const testMetaKwargs = this.getTestMetadataKwArgs(kwargs, testFullName);
      return testMetaKwargs || testFullName;
    });

    this.terminal.debug(
      "docsEditViewPanel:getTestDataByColumn",
      "test data",
      false,
      data,
      columnNameFromWebview,
    );

    if (!data.length) {
      return;
    }

    const dataWithoutDupes = this.dbtTestService.removeDuplicateTests(data);
    if (
      existingColumn?.name === columnNameFromWebview &&
      existingColumn?.tests === undefined
    ) {
      return {
        data_tests: dataWithoutDupes,
      };
    }

    return {
      tests: dataWithoutDupes,
    };
  }

  private modifyColumnNames = (
    columns: { name: string }[],
    existingColumnNames: string[],
  ) => {
    return columns.map((c) => {
      // find a column from schema.yml with same name ignoring case
      const existingColumn = existingColumnNames.find(
        (name) => name.toLowerCase() === c.name.toLowerCase(),
      );
      // column exists with matching name, so use name from schema.yml
      if (existingColumn) {
        return { ...c, name: existingColumn };
      }

      // new column, save the name by checking the config
      return {
        ...c,
        name: c.name,
      };
    });
  };

  private convertColumnNamesByCaseConfig(
    columns: { name: string }[],
    modelName: string,
    project: Project,
  ) {
    if (!columns.length) {
      return [];
    }

    const patchPath = this.documentation?.patchPath;
    // if new project, and no schema.yml
    if (!patchPath) {
      return columns;
    }

    const docFile: string = readFileSync(
      path.join(project.projectRoot.fsPath, removeProtocol(patchPath)),
    ).toString("utf8");
    const parsedDocFile =
      parse(docFile, {
        strict: false,
        uniqueKeys: false,
        maxAliasCount: -1,
      }) || {};

    const model = parsedDocFile.models?.find(
      (model: any) => model.name === modelName,
    );

    // new model and does not exist in schema.yml
    if (!model) {
      return columns;
    }

    const existingColumnNames =
      (model.columns as { name: string }[])?.map((c) => c.name) || [];

    return this.modifyColumnNames(columns, existingColumnNames);
  }

  private setOrDeleteInParsedDocument(
    doc: YAMLMap<unknown, unknown>,
    key: string,
    value: any,
  ) {
    if (value) {
      doc.set(key, value);
    } else {
      doc.delete(key);
    }
  }

  private findEntityInParsedDoc(
    models:
      | YAMLSeq<DocumentationSchema["models"]["0"]>
      | YAMLSeq<DocumentationSchemaColumn>
      | undefined,
    predicate: (name: string) => boolean,
  ) {
    if (models && models.items) {
      return (
        // @ts-ignore
        (models.items.find(
          (
            item:
              DocumentationSchema["models"]["0"] | DocumentationSchemaColumn,
          ) => {
            if (item instanceof YAMLMap) {
              const name = item.get("name");
              return name && predicate(name as string);
            }
            return false;
          },
        ) as YAMLMap | undefined) || null
      );
    }
    return null;
  }

  private setupWebviewHooks() {
    this.onMessageDisposable?.dispose();
    this.onMessageDisposable = this._panel!.webview.onDidReceiveMessage(
      (message: unknown) => this.handleCommand(message),
      null,
      this._disposables,
    );
  }

  /** Routes an inbound message through the documentation-editor guard and handler map. */
  private async handleCommand(message: unknown): Promise<void> {
    this.terminal.debug(
      "docsEditPanel:handleCommand",
      "onDidReceiveMessage",
      message,
    );
    await dispatchMessage(
      DocsEditViewPanel.viewType,
      message,
      documentationEditor.isPanelMessage,
      this.handlers(),
      { log: this.terminal, reply: (response) => this.post(response) },
    );
  }

  /** Runs `handler` with the active editor's project, or answers the request with why there is none. */
  private withProject<M extends { syncRequestId?: string }>(
    handler: (message: M, project: Project, modelPath: Uri) => unknown,
  ): (message: M) => unknown {
    return (message) => {
      if (!window.activeTextEditor) {
        return this.sendResponseToWebview({
          syncRequestId: message.syncRequestId,
          error: "No active editor",
        });
      }
      const modelPath = activeModelUri(window.activeTextEditor.document.uri);
      const project = this.getProject();
      if (!project) {
        return this.sendResponseToWebview({
          syncRequestId: message.syncRequestId,
          error: "No dbt project found for the active editor",
        });
      }
      return handler(message, project, modelPath);
    };
  }

  private showNotification({
    command,
    infoMessage,
    items,
    syncRequestId,
  }: ShowNotification) {
    const show =
      command === "showWarningMessage"
        ? window.showWarningMessage
        : window.showInformationMessage;
    return this.handleSyncRequestFromWebview(
      syncRequestId,
      () => show(infoMessage, ...(items ?? [])),
      command,
    );
  }

  private getUnitTestCode(filePath?: string, testName?: string) {
    if (!filePath || !existsSync(filePath)) {
      return { error: "Unit test file not found" };
    }
    const raw = readFileSync(filePath, { encoding: "utf-8" });
    if (!testName) {
      return { yaml: raw };
    }
    try {
      const parsed = parse(raw) as Record<string, any>;
      const unitTests: any[] = parsed?.unit_tests ?? [];
      const test = unitTests.find((item) => item.name === testName);
      return { yaml: test ? stringify(test) : raw };
    } catch {
      return { yaml: raw };
    }
  }

  /** One handler per documentation-editor panel command. */
  private handlers(): Handlers<PanelMessage> {
    return {
      "webview:ready": () => completeWebviewReady(this.entry),
      getCurrentModelDocumentation: () => this.transmitData(),
      saveDraft: (message) => this.saveDraft(message),
      showWarningMessage: (message) => this.showNotification(message),
      showInformationMessage: (message) => this.showNotification(message),
      openProblemsTab: () =>
        commands.executeCommand("workbench.action.problems.focus"),
      getTestCode: this.withProject(({ syncRequestId, test, model }) =>
        this.handleSyncRequestFromWebview(
          syncRequestId,
          () => this.getDbtTestCode(test as unknown as TestMetaData, model),
          "getTestCode",
        ),
      ),
      getUnitTestCode: this.withProject(({ syncRequestId, path, name }) =>
        this.handleSyncRequestFromWebview(
          syncRequestId,
          () => this.getUnitTestCode(path, name),
          "getUnitTestCode",
        ),
      ),
      getDistinctColumnValues: this.withProject(
        ({ syncRequestId, model, column }, project) =>
          this.handleSyncRequestFromWebview(
            syncRequestId,
            () => {
              if (!model) {
                throw new UserInputError("No model is loaded");
              }
              return project.getColumnValues(model, column);
            },
            "getDistinctColumnValues",
            true,
          ),
      ),
      getColumnsOfSources: this.withProject(
        ({ syncRequestId, source, table }, project) =>
          this.handleSyncRequestFromWebview(
            syncRequestId,
            async () => {
              const columns = await project.getColumnsOfSource(source, table);
              return { columns: columns?.map((c) => c.column) ?? [] };
            },
            "getColumnsOfSources",
            true,
          ),
      ),
      getColumnsOfModel: this.withProject(({ syncRequestId, model }, project) =>
        this.handleSyncRequestFromWebview(
          syncRequestId,
          async () => {
            const columns = await project.getColumnsOfModel(model);
            return { columns: columns?.map((c) => c.column) ?? [] };
          },
          "getColumnsOfModel",
          true,
        ),
      ),
      getSourcesInProject: this.withProject(({ syncRequestId }) =>
        this.handleSyncRequestFromWebview(
          syncRequestId,
          () => ({
            sources: this.queryManifestService.getSourcesInProject(
              window.activeTextEditor?.document.uri,
            ),
          }),
          "getSourcesInProject",
          true,
        ),
      ),
      getModelsInProject: this.withProject(({ syncRequestId }) =>
        this.handleSyncRequestFromWebview(
          syncRequestId,
          () => ({
            models: this.queryManifestService.getModelsInProject(
              window.activeTextEditor?.document.uri,
            ),
          }),
          "getModelsInProject",
        ),
      ),
      fetchMetadataFromDatabase: this.withProject(
        ({ syncRequestId }, project, modelPath) =>
          this.fetchMetadataFromDatabase(project, modelPath, syncRequestId),
      ),
      saveDocumentation: this.withProject((message) =>
        window.withProgress(
          {
            title: "Saving documentation",
            location: ProgressLocation.Notification,
            cancellable: false,
          },
          async () => {
            const { syncRequestId } = message;
            if (!(await this.saveDocumentation(message))) {
              // The panel keeps its edits dirty until a save is confirmed.
              if (syncRequestId) {
                await this.post({
                  command: "response",
                  args: { syncRequestId, body: { saved: false }, status: true },
                });
              }
              return;
            }
            this.drafts.delete(message.filePath);
            await this.reloadDocumentationFromManifest();
            const tests = await this.dbtTestService.getTestsForCurrentModel();
            const unitTests =
              await this.dbtTestService.getUnitTestsForCurrentModel();
            if (syncRequestId) {
              await this.post({
                command: "response",
                args: {
                  syncRequestId,
                  body: {
                    saved: true,
                    tests,
                    unitTests,
                    documentation: this.documentation,
                  },
                  status: true,
                },
              });
            }
          },
        ),
      ),
    };
  }

  private fetchMetadataFromDatabase(
    project: Project,
    modelPath: Uri,
    syncRequestId: string | undefined,
  ) {
    return window.withProgress(
      {
        title: "Syncing columns with metadata from database",
        location: ProgressLocation.Notification,
        cancellable: false,
      },
      async () => {
        const modelName = path.basename(modelPath.fsPath, ".sql");
        try {
          const columnsInRelation = await project.getColumnsOfModel(modelName);
          const columns = this.convertColumnNamesByCaseConfig(
            columnsInRelation.map((column) => ({
              name: column.column,
              type: column.dtype.toLowerCase(),
            })),
            modelName,
            project,
          );
          await this.transmitColumns(columns);
          if (syncRequestId) {
            await this.post({
              command: "response",
              args: { syncRequestId, body: { columns }, status: true },
            });
          }
        } catch (exc) {
          await this.transmitError();
          window.showErrorMessage(
            `An error occured while fetching metadata for ${modelName} from the database: ` +
              (exc instanceof Error ? exc.message : String(exc)),
          );
          this.terminal.error(
            "docsEditPanelLoadError",
            `An error occured while fetching metadata for ${modelName} from the database`,
            exc,
            false,
          );
          if (syncRequestId) {
            await this.post({
              command: "response",
              args: { syncRequestId, body: {}, status: false },
            });
          }
        }
      },
    );
  }

  private async reloadDocumentationFromManifest() {
    // Force reload from manifest after manifest refresh
    this.loadedFromManifest = false;
    this.documentation = (
      await this.docGenService.getUncompiledDocumentationForCurrentActiveFile()
    ).documentation;
  }

  /** Writes `message` to its schema YAML; false when the user cancels the file dialog or the write fails. */
  private async saveDocumentation(message: SaveMessage): Promise<boolean> {
    let patchPath = message.patchPath;
    try {
      const projectByFilePath = this.projects.get(Uri.file(message.filePath));
      if (!projectByFilePath) {
        throw new Error("Unable to find project for saving documentation");
      }
      const project = this.getProject();
      if (project === undefined) {
        return false;
      }

      if (!patchPath) {
        switch (message.dialogType) {
          case "Existing file":
            const openDialog = await window.showOpenDialog({
              filters: { Yaml: ["yml"] },
              canSelectMany: false,
            });
            if (openDialog === undefined || openDialog.length === 0) {
              return false;
            }
            patchPath = openDialog[0].fsPath;
            break;
          case "New file":
            const saveDialog = await window.showSaveDialog({
              filters: { Yaml: ["yml"] },
            });
            if (!saveDialog) {
              return false;
            }
            patchPath = saveDialog.fsPath;
            break;
          case undefined:
            throw new Error("No schema file chosen for the documentation");
        }
      } else {
        // the location comes from the manifest, parse it
        patchPath = path.join(
          projectByFilePath.projectRoot.fsPath,
          removeProtocol(patchPath),
        );
      }
      const written = await writeUserFile(Uri.file(patchPath), (docFile) =>
        this.withDocumentation(docFile, message, projectByFilePath),
      );
      if (written === "rejected") {
        throw new Error("the editor rejected the change");
      }
      if (written === "applied-unsaved") {
        window.showWarningMessage(
          `${path.basename(patchPath)} has unsaved changes; your documentation was applied but not saved`,
        );
      }
      return true;
    } catch (error) {
      this.transmitError();
      window.showErrorMessage(
        `Could not save documentation to ${patchPath}: ${error}`,
      );
      this.terminal.error(
        "saveDocumentationError",
        `Could not save documentation to ${patchPath}`,
        error,
        false,
      );
      return false;
    }
  }

  /** `docFile` with `message`'s model documentation and tests merged in. */
  private withDocumentation(
    docFile: string,
    message: SaveMessage,
    projectByFilePath: Project,
  ): string {
    const parsedDocFile = parseDocument<YAMLSeq<DocumentationSchema>>(docFile, {
      strict: false,
      uniqueKeys: false,
    });
    const existingModels = parsedDocFile.get("models") as
      YAMLSeq<DocumentationSchema["models"]["0"]> | undefined;

    const model = this.findEntityInParsedDoc(
      existingModels,
      (name: string) => name === message.name,
    );

    if (!model) {
      // there is a models section but the model does not exist yet.
      const newModelData = {
        name: message.name,
        description: message.description?.trim() || undefined,
        columns: message.columns.length
          ? message.columns.map((column: any) => {
              const name = getColumnNameByCase(
                column.name,
                projectByFilePath.getAdapterType(),
              );
              return {
                name,
                description: column.description?.trim() || undefined,
                data_type: column.type?.toLowerCase(),
                ...this.getTestDataByColumn(
                  message,
                  column.name,
                  // A column without a `tests` key gets `data_tests`.
                  { name: column.name },
                ),
                ...(isQuotedIdentifier(
                  column.name,
                  projectByFilePath.getAdapterType(),
                )
                  ? { quote: true }
                  : undefined),
              };
            })
          : undefined,
      };
      // Models does not exist
      if (existingModels?.items.length) {
        parsedDocFile.addIn(["models"], newModelData);
      } else {
        // Models  exist, but current one is new model
        parsedDocFile.set("models", [newModelData]);
      }
    } else {
      // The model already exists
      this.setOrDeleteInParsedDocument(
        model,
        "description",
        message.description?.trim(),
      );
      const modelTests = this.getTestDataByModel(
        message,
        model.get("name") as string,
        model.toJSON(),
      );
      this.setOrDeleteInParsedDocument(model, "tests", modelTests?.tests);
      this.setOrDeleteInParsedDocument(
        model,
        "data_tests",
        modelTests?.data_tests,
      );
      if (!model.get("columns")) {
        model.set("columns", new YAMLSeq<DocumentationSchemaColumn>());
      }
      message.columns.forEach((column: any) => {
        const existingColumn = this.findEntityInParsedDoc(
          model.get("columns") as
            YAMLSeq<DocumentationSchemaColumn> | undefined,
          (name: string) => isColumnNameEqual(name, column.name),
        );

        if (existingColumn) {
          // ignore tests, data_tests from existing column, as it will be recreated in `getTestDataByColumn`
          const { tests, data_tests, ...rest } = existingColumn.toJSON();
          this.setOrDeleteInParsedDocument(
            existingColumn,
            "description",
            column.description?.trim(),
          );
          this.setOrDeleteInParsedDocument(
            existingColumn,
            "data_type",
            (rest.data_type || column.type)?.toLowerCase(),
          );
          const allTests = this.getTestDataByColumn(
            message,
            column.name,
            existingColumn.toJSON(),
          );
          this.setOrDeleteInParsedDocument(
            existingColumn,
            "tests",
            allTests?.tests,
          );
          this.setOrDeleteInParsedDocument(
            existingColumn,
            "data_tests",
            allTests?.data_tests,
          );
        } else {
          const name = getColumnNameByCase(
            column.name,
            projectByFilePath.getAdapterType(),
          );
          model.addIn(["columns"], {
            name,
            description: column.description?.trim() || undefined,
            data_type: column.type?.toLowerCase(),
            ...this.getTestDataByColumn(message, column.name, {
              name: column.name,
            }),
            ...(isQuotedIdentifier(
              column.name,
              projectByFilePath.getAdapterType(),
            )
              ? { quote: true }
              : undefined),
          });
        }
      });

      // delete columns if they are empty to avoid [] in the yaml file
      if (
        (model.get("columns") as YAMLSeq<DocumentationSchemaColumn> | undefined)
          ?.items.length === 0
      ) {
        model.delete("columns");
      }
    }

    return stringify(parsedDocFile, { lineWidth: 0 });
  }

  private async handleSyncRequestFromWebview(
    syncRequestId: string | undefined,
    callback: () => any,
    command: string,
    showErrorNotification?: boolean,
  ) {
    try {
      const response = await callback();

      this.sendResponseToWebview({ syncRequestId, data: response });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof UserInputError) {
        this.terminal.debug(command, message, error);
      } else {
        this.terminal.error(command, message, error);
      }
      if (showErrorNotification) {
        window.showErrorMessage(message);
      }
      this.sendResponseToWebview({ syncRequestId, error: message });
    }
  }

  private sendResponseToWebview({
    data,
    error,
    syncRequestId,
  }: {
    syncRequestId?: string;
    data?: unknown;
    error?: string;
  }) {
    void this.post({
      command: "response",
      args: { syncRequestId, body: data, status: !error, error },
    });
  }

  private async onManifestChanged() {
    if (this.documentation !== undefined && this.loadedFromManifest) {
      // don't reload doc panel if documentation is already set, otherwise the
      //  documentation will be overwritten by the one coming from the manifest
      return;
    }
    this.loadedFromManifest = true;
    if (this._panel) {
      this.transmitData();
    }
  }
}
