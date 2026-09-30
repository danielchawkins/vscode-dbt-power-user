import { Disposable, Event, EventEmitter, Uri } from "vscode";
import { DBTTerminal } from "../dbt_integration";
import { ManifestMetadataSource } from "../metadata/manifestMetadataSource";
import { ProjectMetadataSource } from "../metadata/projectMetadataSource";
import { Project } from "./project";
import { DeclaredProject, ProjectRegistry } from "./projectRegistry";

interface ProjectEntry {
  project: Project;
  metadataSource: ProjectMetadataSource;
  subscriptions: Disposable[];
}

/** Builds one `Project` per Declared Project and aggregates their events. */
export class Projects implements Disposable {
  private _onDidInitialize = new EventEmitter<void>();
  /** Fires once, after the first synchronization with the registry. */
  readonly onDidInitialize: Event<void> = this._onDidInitialize.event;
  private _onDidChangeManifest = new EventEmitter<Project>();
  /** Fires after any project publishes a new manifest. */
  readonly onDidChangeManifest: Event<Project> =
    this._onDidChangeManifest.event;
  private _onDidRemoveProject = new EventEmitter<Uri>();
  /** Fires with a project's root after it is dropped. */
  readonly onDidRemoveProject: Event<Uri> = this._onDidRemoveProject.event;
  private disposables: Disposable[] = [
    this._onDidInitialize,
    this._onDidChangeManifest,
    this._onDidRemoveProject,
  ];

  private readonly projectsByRoot = new Map<string, ProjectEntry>();
  private projectOrder: string[] = [];
  private registrySubscription: Disposable | undefined;
  private syncQueue = Promise.resolve();
  private disposed = false;

  constructor(
    private projectRegistry: ProjectRegistry,
    private projectFactory: (path: Uri) => Project,
    private dbtTerminal: DBTTerminal,
  ) {}

  async initialize(): Promise<void> {
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
          "Projects",
          "Project synchronization failed",
          error,
        );
      });
    });
    this._onDidInitialize.fire();
  }

  get(uri: Uri): Project | undefined {
    const declared = this.projectRegistry.findProject(uri);
    return declared && this.projectsByRoot.get(declared.root.fsPath)?.project;
  }

  all(): Project[] {
    return this.projectOrder.flatMap((root) => {
      const entry = this.projectsByRoot.get(root);
      return entry ? [entry.project] : [];
    });
  }

  byName(projectName: string): Project | undefined {
    return this.all().find(
      (project) => project.getProjectName() === projectName,
    );
  }

  adapters(): string[] {
    return Array.from(
      new Set<string>(this.all().map((project) => project.getAdapterType())),
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
      entry.metadataSource.dispose();
      for (const sub of entry.subscriptions) {
        sub.dispose();
      }
      void entry.project.dispose();
    }
    this.projectsByRoot.clear();
    this.projectOrder = [];
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
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
        const project = this.projectFactory(declared.root);
        const metadataSource = new ManifestMetadataSource(declared, project);
        const subscriptions: Disposable[] = [
          project.onDidChangeManifest((p) => this._onDidChangeManifest.fire(p)),
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
}
