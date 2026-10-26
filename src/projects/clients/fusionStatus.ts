import type { Event, LanguageStatusItem, Uri } from "vscode";
import { commands, Disposable, languages } from "vscode";
import { projectRootDigest } from "../../core/snapshot/index";
import { vscodeDocumentSelectorForProject } from "../../fusion/documentSelector";
import type { FusionClient } from "../../fusion/fusionClient";
import { addDeclaredProjectRoot } from "../registry/projectConfiguration";
import type { DeclaredProject } from "../registry/projectRegistry";
import { folderScopeOf } from "../registry/schemaOrigin";
import type { FusionClientPool } from "./fusionClientPool";
import {
  clientItemView,
  optInLines,
  type ProjectNotes,
  type ProjectOptIns,
  staticText,
} from "./fusionStatusText";

type ProjectStatus = {
  project: DeclaredProject;
  client: FusionClient;
  subscription: Disposable;
  clientItem: LanguageStatusItem;
  staticItem: LanguageStatusItem;
  targetItem: LanguageStatusItem | undefined;
  originItem: LanguageStatusItem | undefined;
};

/** Language status items per Declared Project with a client, scoped to that project's documents. */
export class FusionStatus implements Disposable {
  private readonly statuses = new Map<string, ProjectStatus>();
  private readonly disposables: Disposable[] = [];
  private readonly registry: {
    readonly projects: readonly DeclaredProject[];
  };
  private readonly clientPool: FusionClientPool;
  private readonly optIns: (
    project: DeclaredProject,
  ) => ProjectOptIns | undefined;
  /**
   * The project's current configuration error, in full, and a note on its environment shown beside the client
   * state; fires `onDidChangeOptIns` when either changes.
   */
  private readonly projectNotes: (project: DeclaredProject) => ProjectNotes;

  constructor({
    registry,
    clientPool,
    optIns = () => undefined,
    onDidChangeOptIns,
    projectNotes = () => ({}),
  }: {
    registry: {
      readonly projects: readonly DeclaredProject[];
    };
    clientPool: FusionClientPool;
    optIns?: (project: DeclaredProject) => ProjectOptIns | undefined;
    onDidChangeOptIns?: Event<unknown>;
    projectNotes?: (project: DeclaredProject) => ProjectNotes;
  }) {
    this.registry = registry;
    this.clientPool = clientPool;
    this.optIns = optIns;
    this.projectNotes = projectNotes;
    if (onDidChangeOptIns) {
      this.disposables.push(onDidChangeOptIns(() => this.renderAll()));
    }
    this.disposables.push(
      this.clientPool.onDidChangeClients(() => this.reconcile()),
      commands.registerCommand(
        "fusionPowerUser.showFusionOutput",
        (root?: Uri) =>
          root &&
          this.statuses.get(root.fsPath)?.client.outputChannel.show(true),
      ),
      commands.registerCommand(
        "fusionPowerUser.addToProjects",
        (root?: Uri) => {
          const project = this.registry.projects.find(
            (candidate) => candidate.root.fsPath === root?.fsPath,
          );
          return (
            project && addDeclaredProjectRoot(project.folder, project.root)
          );
        },
      ),
    );
  }

  initialize(): void {
    this.reconcile();
  }

  /** The rendered detail of the client item for a project root, when that project has one. */
  clientDetail(root: Uri): string | undefined {
    return this.statuses.get(root.fsPath)?.clientItem.detail;
  }

  dispose(): void {
    // Snapshot: remove() deletes from statuses.
    const keys = [...this.statuses.keys()];
    for (const key of keys) {
      this.remove(key);
    }
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }

  private reconcile(): void {
    const next = new Map<string, [DeclaredProject, FusionClient]>();
    for (const project of this.registry.projects) {
      const client = this.clientPool.get(project);
      if (client) {
        next.set(project.root.fsPath, [project, client]);
      }
    }
    for (const [key, status] of this.statuses) {
      const entry = next.get(key);
      if (!entry || entry[0] !== status.project) {
        this.remove(key);
      }
    }
    for (const [key, [project, client]] of next) {
      const status =
        this.statuses.get(key) ?? this.create(key, project, client);
      if (status.client !== client) {
        status.subscription.dispose();
        status.client = client;
        status.subscription = client.onDidChangeState(() =>
          this.render(status),
        );
      }
      this.render(status);
    }
  }

  private create(
    key: string,
    project: DeclaredProject,
    client: FusionClient,
  ): ProjectStatus {
    const selector = vscodeDocumentSelectorForProject(project.root);
    const digest = projectRootDigest(project.root.fsPath);
    const clientItem = languages.createLanguageStatusItem(
      `fusionPowerUser.status.client.${digest}`,
      selector,
    );
    clientItem.name = `dbt Fusion (${project.name})`;
    const staticItem = languages.createLanguageStatusItem(
      `fusionPowerUser.status.static.${digest}`,
      selector,
    );
    staticItem.name = `Static analysis (${project.name})`;
    const status: ProjectStatus = {
      project,
      client,
      subscription: Disposable.from(),
      clientItem,
      staticItem,
      targetItem: undefined,
      originItem: undefined,
    };
    status.subscription = client.onDidChangeState(() => this.render(status));
    this.statuses.set(key, status);
    return status;
  }

  private remove(key: string): void {
    const status = this.statuses.get(key);
    if (!status) {
      return;
    }
    this.statuses.delete(key);
    status.subscription.dispose();
    status.clientItem.dispose();
    status.staticItem.dispose();
    status.targetItem?.dispose();
    status.originItem?.dispose();
  }

  private renderAll(): void {
    for (const status of this.statuses.values()) {
      this.render(status);
    }
  }

  private renderStatic({ project, client, staticItem }: ProjectStatus): void {
    const optIns = this.optIns(project);
    const lines = optInLines(
      optIns,
      client.staticAnalysis,
      folderScopeOf(this.registry.projects, project),
    );
    staticItem.text = staticText(
      client.staticAnalysis,
      optIns?.strict ?? false,
    );
    staticItem.detail = [
      project.name,
      ...(lines.length ? [lines.map((line) => line.text).join(" ")] : []),
    ].join(" · ");
    const command = lines.find((line) => line.command)?.command;
    staticItem.command = command && { ...command, arguments: [project.root] };
  }

  /** A project declared by an opened file offers to add its root to the folder's configured projects. */
  private renderOrigin(status: ProjectStatus): void {
    const { project } = status;
    if (project.origin !== "openedFile") {
      status.originItem?.dispose();
      status.originItem = undefined;
      return;
    }
    if (!status.originItem) {
      status.originItem = languages.createLanguageStatusItem(
        `fusionPowerUser.status.origin.${projectRootDigest(project.root.fsPath)}`,
        vscodeDocumentSelectorForProject(project.root),
      );
      status.originItem.name = `Origin (${project.name})`;
    }
    status.originItem.text = "Declared by an opened file";
    status.originItem.detail = project.name;
    status.originItem.command = {
      title: "Add to projects",
      command: "fusionPowerUser.addToProjects",
      arguments: [project.root],
    };
  }

  private render(status: ProjectStatus): void {
    const { project, client, clientItem } = status;
    const view = clientItemView({
      projectName: project.name,
      state: client.state,
      failureReason: client.failureReason,
      notes: this.projectNotes(project),
    });
    clientItem.text = view.text;
    clientItem.severity = view.severity;
    clientItem.busy = view.busy;
    clientItem.detail = view.detail;
    clientItem.command = { ...view.command, arguments: [project.root] };

    this.renderStatic(status);
    this.renderOrigin(status);

    const target = this.clientPool.getLaunch(project)?.target;
    if (!target) {
      status.targetItem?.dispose();
      status.targetItem = undefined;
      return;
    }
    if (!status.targetItem) {
      status.targetItem = languages.createLanguageStatusItem(
        `fusionPowerUser.status.target.${projectRootDigest(project.root.fsPath)}`,
        vscodeDocumentSelectorForProject(project.root),
      );
      status.targetItem.name = `Target (${project.name})`;
    }
    status.targetItem.text = `target: ${target}`;
    status.targetItem.detail = project.name;
  }
}
