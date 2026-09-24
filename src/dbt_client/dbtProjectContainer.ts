import * as fs from "fs";
import { inject } from "inversify";
import { basename } from "path";
import {
  Disposable,
  EventEmitter,
  ExtensionContext,
  Uri,
  window,
} from "vscode";
import type { RunResultsEventData } from "../dbt_integration";
import { DBTTerminal, RunModelParams, RunModelType } from "../dbt_integration";
import { ManifestMetadataSource } from "../metadata/manifestMetadataSource";
import { ProjectMetadataSource } from "../metadata/projectMetadataSource";
import { DeclaredProject, ProjectRegistry } from "../projects/projectRegistry";
import { extractDbtSubcommand } from "../utils";
import { DBTProject } from "./dbtProject";
import {
  ManifestCacheChangedEvent,
  RebuildManifestCombinedStatusChange,
} from "./event/manifestCacheChangedEvent";

export interface DBTProjectsInitializationEvent {}

interface ProjectEntry {
  project: DBTProject;
  metadataSource: ProjectMetadataSource;
  subscriptions: Disposable[];
}

export class DBTProjectContainer implements Disposable {
  private _onDBTProjectsInitializationEvent =
    new EventEmitter<DBTProjectsInitializationEvent>();
  public readonly onDBTProjectsInitialization =
    this._onDBTProjectsInitializationEvent.event;
  private _onManifestChanged = new EventEmitter<ManifestCacheChangedEvent>();
  public readonly onManifestChanged = this._onManifestChanged.event;
  private context?: ExtensionContext;
  private _onRebuildManifestStatusChange =
    new EventEmitter<RebuildManifestCombinedStatusChange>();
  readonly onRebuildManifestStatusChange =
    this._onRebuildManifestStatusChange.event;
  private rebuildManifestStatusChangeMap = new Map<string, boolean>();
  private disposables: Disposable[] = [
    this._onDBTProjectsInitializationEvent,
    this._onManifestChanged,
    this._onRebuildManifestStatusChange,
  ];

  private readonly projectsByRoot = new Map<string, ProjectEntry>();
  private projectOrder: string[] = [];
  private registrySubscription: Disposable | undefined;
  private syncQueue = Promise.resolve();
  private disposed = false;

  constructor(
    private projectRegistry: ProjectRegistry,
    @inject("Factory<DBTProject>")
    private dbtProjectFactory: (
      path: Uri,
      onManifestChanged: EventEmitter<ManifestCacheChangedEvent>,
    ) => DBTProject,
    @inject("DBTTerminal")
    private dbtTerminal: DBTTerminal,
  ) {
    this.disposables.push(this.dbtTerminal);
  }

  setContext(context: ExtensionContext) {
    this.context = context;
  }

  async initializeDBTProjects(): Promise<void> {
    if (this.disposed || this.registrySubscription) {
      return;
    }
    await this.enqueueSync();
    if (this.disposed) {
      return;
    }
    this.registrySubscription = this.projectRegistry.onDidChangeProjects(() => {
      void this.enqueueSync().catch((error) => {
        this.dbtTerminal.error(
          "DBTProjectContainer",
          "Project synchronization failed",
          error,
        );
      });
    });
    this._onDBTProjectsInitializationEvent.fire({});
  }

  get extensionUri() {
    return this.context!.extensionUri;
  }

  get extensionVersion() {
    return this.context!.extension.packageJSON.version;
  }

  setToWorkspaceState(key: string, value: any) {
    this.context!.workspaceState.update(key, value);
  }
  getFromWorkspaceState(key: string): any {
    return this.context!.workspaceState.get(key);
  }
  setToGlobalState(key: string, value: any) {
    this.context!.globalState.update(key, value);
  }

  getFromGlobalState(key: string): any {
    return this.context!.globalState.get(key);
  }

  get extensionId(): string {
    return this.context?.extension.id.toString() || "";
  }

  getPackageName = (uri: Uri): string | undefined => {
    return this.findDBTProject(uri)?.findPackageName(uri);
  };

  getProjectRootpath = (uri: Uri): Uri | undefined => {
    return this.findDBTProject(uri)?.projectRoot;
  };

  async initialize(): Promise<void> {
    await Promise.all(
      this.getProjects().map((project) => project.initialize()),
    );
  }

  executeSQL(uri: Uri, query: string, modelName: string): void {
    this.findDBTProject(uri)?.executeSQLOnQueryPanel(query, modelName);
  }

  runModel(modelPath: Uri, type?: RunModelType) {
    this.findDBTProject(modelPath)?.runModel(
      this.createModelParams(modelPath, type),
    );
  }

  buildModel(modelPath: Uri, type?: RunModelType) {
    this.findDBTProject(modelPath)?.buildModel(
      this.createModelParams(modelPath, type),
    );
  }

  buildProject(modelPath: Uri, type?: RunModelType) {
    this.findDBTProject(modelPath)?.buildProject();
  }

  runTest(modelPath: Uri, testName: string) {
    this.findDBTProject(modelPath)?.runTest(testName);
  }

  runModelTest(modelPath: Uri, modelName: string) {
    this.findDBTProject(modelPath)?.runModelTest(modelName);
  }

  runModelByName(projectUri: Uri, modelName: string) {
    this.findDBTProject(projectUri)?.runModel({
      plusOperatorLeft: "",
      modelName,
      plusOperatorRight: "",
    });
  }

  compileModel(modelPath: Uri, type?: RunModelType) {
    this.findDBTProject(modelPath)?.compileModel(
      this.createModelParams(modelPath, type),
    );
  }

  compileQuery(modelPath: Uri, query: string) {
    return this.findDBTProject(modelPath)?.compileQuery(query);
  }

  showRunSQL(modelPath: Uri) {
    this.findDBTProject(modelPath)?.showRunSQL(modelPath);
  }

  showCompiledSQL(modelPath: Uri) {
    this.findDBTProject(modelPath)?.showCompiledSql(modelPath);
  }

  generateSchemaYML(modelPath: Uri, modelName: string) {
    this.findDBTProject(modelPath)?.generateSchemaYML(modelPath, modelName);
  }

  findDBTProject(uri: Uri): DBTProject | undefined {
    const declared = this.projectRegistry.findProject(uri);
    return declared && this.projectsByRoot.get(declared.root.fsPath)?.project;
  }

  getProjects(): DBTProject[] {
    return this.projectOrder.flatMap((root) => {
      const entry = this.projectsByRoot.get(root);
      return entry ? [entry.project] : [];
    });
  }

  findProjectByName(projectName: string): DBTProject | undefined {
    return this.getProjects().find(
      (project) => project.getProjectName() === projectName,
    );
  }

  rerunFromHistory(entry: RunResultsEventData): void {
    const project = this.findProjectByName(entry.projectName);
    if (!project) {
      window.showErrorMessage(
        `Project "${entry.projectName}" is not currently loaded.`,
      );
      return;
    }

    const runModelParams = this.parseHistoryArgs(entry.args);

    switch (extractDbtSubcommand(entry.command)) {
      case "run":
        if (runModelParams.modelName) {
          project.runModel(runModelParams);
        } else {
          window.showWarningMessage(
            "Re-running project-wide dbt run is not currently supported. Please run from the terminal.",
          );
        }
        break;
      case "build":
        if (runModelParams.modelName) {
          project.buildModel(runModelParams);
        } else {
          project.buildProject();
        }
        break;
      case "test":
        if (entry.args.length > 0) {
          project.runTest(entry.args[0]);
        } else {
          window.showWarningMessage(
            "Re-running project-wide dbt test is not currently supported. Please run tests from the terminal.",
          );
        }
        break;
      case "compile":
        if (runModelParams.modelName) {
          project.compileModel(runModelParams);
        } else {
          window.showWarningMessage(
            "Re-running project-wide dbt compile is not currently supported. Please run from the terminal.",
          );
        }
        break;
      default:
        window.showWarningMessage(
          `Re-run is not supported for command: ${entry.command}`,
        );
    }
  }

  private parseHistoryArgs(args: string[]): RunModelParams {
    if (args.length === 0) {
      return { plusOperatorLeft: "", modelName: "", plusOperatorRight: "" };
    }
    const selector = args[0];
    const plusOperatorLeft = selector.startsWith("+") ? "+" : "";
    const plusOperatorRight = selector.endsWith("+") ? "+" : "";
    const modelName = selector.replace(/^\+/, "").replace(/\+$/, "");
    return { plusOperatorLeft, modelName, plusOperatorRight };
  }

  getAdapters(): string[] {
    return Array.from(
      new Set<string>(
        this.getProjects().map((project) => project.getAdapterType()),
      ),
    );
  }

  dispose() {
    this.disposed = true;
    if (this.registrySubscription) {
      this.registrySubscription.dispose();
    }
    for (const [rootPath, entry] of this.projectsByRoot) {
      this.projectsByRoot.delete(rootPath);
      this._onManifestChanged.fire({
        removed: [{ projectRoot: entry.project.projectRoot }],
      });
      const rebuildKey = entry.project.projectRoot.fsPath;
      if (this.rebuildManifestStatusChangeMap.has(rebuildKey)) {
        this.rebuildManifestStatusChangeMap.delete(rebuildKey);
        this.fireRebuildStatus();
      }
      entry.metadataSource.dispose();
      for (const sub of entry.subscriptions) {
        sub.dispose();
      }
      void entry.project.dispose();
    }
    this.projectsByRoot.clear();
    this.projectOrder = [];
    this.rebuildManifestStatusChangeMap.clear();
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private createModelParams(modelPath: Uri, type?: RunModelType) {
    const modelName = basename(
      fs.realpathSync.native(modelPath.fsPath),
      ".sql",
    );
    const plusOperatorLeft =
      type === RunModelType.RUN_PARENTS ||
      type === RunModelType.BUILD_PARENTS ||
      type === RunModelType.BUILD_CHILDREN_PARENTS
        ? "+"
        : "";
    const plusOperatorRight =
      type === RunModelType.RUN_CHILDREN ||
      type === RunModelType.BUILD_CHILDREN ||
      type === RunModelType.BUILD_CHILDREN_PARENTS
        ? "+"
        : "";
    return { plusOperatorLeft, modelName, plusOperatorRight };
  }

  private async sync(): Promise<void> {
    const desired = new Map<string, DeclaredProject>();
    for (const project of this.projectRegistry.projects) {
      desired.set(project.root.fsPath, project);
    }
    this.projectOrder = [...desired.keys()];

    const created: ProjectEntry[] = [];
    const removed: ProjectEntry[] = [];

    for (const [rootPath, declared] of desired) {
      const existing = this.projectsByRoot.get(rootPath);
      if (existing && existing.metadataSource.project !== declared) {
        this.projectsByRoot.delete(rootPath);
        removed.push(existing);
      }
      if (!this.projectsByRoot.has(rootPath)) {
        const projectManifestEmitter =
          new EventEmitter<ManifestCacheChangedEvent>();
        const project = this.dbtProjectFactory(
          declared.root,
          projectManifestEmitter,
        );
        const metadataSource = new ManifestMetadataSource(declared, project);
        const subscriptions: Disposable[] = [
          metadataSource.onDidChangeMetadata((event) => {
            this._onManifestChanged.fire({ added: [event] });
          }),
          project.onRebuildManifestStatusChange((e) => {
            this.rebuildManifestStatusChangeMap.set(
              e.project.projectRoot.fsPath,
              e.inProgress,
            );
            this.fireRebuildStatus();
          }),
          projectManifestEmitter,
        ];
        const entry = { project, metadataSource, subscriptions };
        this.projectsByRoot.set(rootPath, entry);
        created.push(entry);
      }
    }

    for (const [rootPath, entry] of this.projectsByRoot) {
      if (!desired.has(rootPath)) {
        removed.push(entry);
        this.projectsByRoot.delete(rootPath);
      }
    }

    for (const entry of removed) {
      this._onManifestChanged.fire({
        removed: [{ projectRoot: entry.project.projectRoot }],
      });
      const rebuildKey = entry.project.projectRoot.fsPath;
      if (this.rebuildManifestStatusChangeMap.has(rebuildKey)) {
        this.rebuildManifestStatusChangeMap.delete(rebuildKey);
        this.fireRebuildStatus();
      }
      entry.metadataSource.dispose();
      for (const sub of entry.subscriptions) {
        sub.dispose();
      }
      await entry.project.dispose();
    }

    if (!this.disposed) {
      await Promise.all(created.map((entry) => entry.project.initialize()));
    }
  }

  private enqueueSync(): Promise<void> {
    const next = this.syncQueue.then(() =>
      this.disposed ? undefined : this.sync(),
    );
    this.syncQueue = next.catch(() => undefined);
    return next;
  }

  private fireRebuildStatus(): void {
    const projects = Array.from(this.rebuildManifestStatusChangeMap)
      .filter(([, inProgress]) => inProgress)
      .flatMap(([root]) => {
        const project = this.projectsByRoot.get(root)?.project;
        return project ? [project] : [];
      });
    this._onRebuildManifestStatusChange.fire({
      projects,
      inProgress: projects.length > 0,
    });
  }
}
