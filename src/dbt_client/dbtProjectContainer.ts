import * as fs from "fs";
import { inject } from "inversify";
import { basename } from "path";
import { Disposable, Event, EventEmitter, Uri } from "vscode";
import { DBTTerminal, RunModelType } from "../dbt_integration";
import { ManifestMetadataSource } from "../metadata/manifestMetadataSource";
import { ProjectMetadataSource } from "../metadata/projectMetadataSource";
import type { RebuildManifestCombinedStatusChange } from "../projects/manifestTypes";
import { DeclaredProject, ProjectRegistry } from "../projects/projectRegistry";
import { DBTProject } from "./dbtProject";

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
  private _onDidChangeManifest = new EventEmitter<DBTProject>();
  /** Fires after any project publishes a new manifest. */
  readonly onDidChangeManifest: Event<DBTProject> =
    this._onDidChangeManifest.event;
  private _onDidRemoveProject = new EventEmitter<Uri>();
  /** Fires with a project's root after the container drops it. */
  readonly onDidRemoveProject: Event<Uri> = this._onDidRemoveProject.event;
  private _onRebuildManifestStatusChange =
    new EventEmitter<RebuildManifestCombinedStatusChange>();
  readonly onRebuildManifestStatusChange =
    this._onRebuildManifestStatusChange.event;
  private rebuildManifestStatusChangeMap = new Map<string, boolean>();
  private disposables: Disposable[] = [
    this._onDBTProjectsInitializationEvent,
    this._onDidChangeManifest,
    this._onDidRemoveProject,
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
    private dbtProjectFactory: (path: Uri) => DBTProject,
    @inject("DBTTerminal")
    private dbtTerminal: DBTTerminal,
  ) {
    this.disposables.push(this.dbtTerminal);
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
      this._onDidRemoveProject.fire(entry.project.projectRoot);
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
        const project = this.dbtProjectFactory(declared.root);
        const metadataSource = new ManifestMetadataSource(declared, project);
        const subscriptions: Disposable[] = [
          project.onDidChangeManifest((p) => this._onDidChangeManifest.fire(p)),
          project.onRebuildManifestStatusChange((e) => {
            this.rebuildManifestStatusChangeMap.set(
              e.project.projectRoot.fsPath,
              e.inProgress,
            );
            this.fireRebuildStatus();
          }),
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
      this._onDidRemoveProject.fire(entry.project.projectRoot);
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
