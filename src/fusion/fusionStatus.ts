import {
  Command,
  commands,
  Disposable,
  Event,
  languages,
  LanguageStatusItem,
  LanguageStatusSeverity,
  Uri,
} from "vscode";
import { DBT_PROJECT_FILE, projectRootDigest } from "../core/project";
import { DeclaredProject } from "../projects/projectRegistry";
import { FusionClientPool } from "./fusionClientPool";
import {
  FusionClient,
  FusionClientState,
  vscodeDocumentSelectorForProject,
} from "./fusionLanguageClient";
import { SchemaOriginStatus } from "./schemaOrigin";

/** What a project has opted into in its own project file. */
export interface ProjectOptIns {
  strict: boolean;
  schemaOrigin: SchemaOriginStatus;
}

/** One missing column-lineage opt-in; `command` adds it after that command's own confirmation. */
interface OptInLine {
  text: string;
  command?: Command;
}

type ProjectStatus = {
  project: DeclaredProject;
  client: FusionClient;
  subscription: Disposable;
  clientItem: LanguageStatusItem;
  staticItem: LanguageStatusItem;
  targetItem: LanguageStatusItem | undefined;
};

/** Language status items per Declared Project with a client, scoped to that project's documents. */
export class FusionStatus implements Disposable {
  private readonly statuses = new Map<string, ProjectStatus>();
  private readonly disposables: Disposable[] = [];

  constructor(
    private readonly registry: {
      readonly projects: readonly DeclaredProject[];
    },
    private readonly clientPool: FusionClientPool,
    private readonly optIns: (
      project: DeclaredProject,
    ) => ProjectOptIns | undefined = () => undefined,
    onDidChangeOptIns?: Event<unknown>,
    /** The project's current configuration error, in full; fires `onDidChangeOptIns` when it changes. */
    private readonly projectError: (
      project: DeclaredProject,
    ) => string | undefined = () => undefined,
  ) {
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
    );
  }

  initialize(): void {
    this.reconcile();
  }

  dispose(): void {
    for (const key of [...this.statuses.keys()]) {
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
  }

  private renderAll(): void {
    for (const status of this.statuses.values()) {
      this.render(status);
    }
  }

  private render(status: ProjectStatus): void {
    const { project, client, clientItem, staticItem } = status;
    const failure =
      client.state === "failed"
        ? failureSummary(client.failureReason)
        : undefined;
    const error = failure ? undefined : this.projectError(project);
    clientItem.text = error ? clientText("failed") : clientText(client.state);
    clientItem.severity = error
      ? LanguageStatusSeverity.Error
      : clientSeverity(client.state);
    clientItem.busy =
      client.state === "starting" || client.state === "restarting";
    const problem = failure ?? error;
    clientItem.detail = problem ? `${project.name}: ${problem}` : project.name;
    clientItem.command = {
      title: "Show output",
      command: "fusionPowerUser.showFusionOutput",
      arguments: [project.root],
    };

    const lines = optInLines(this.optIns(project));
    staticItem.text = `static: ${client.staticAnalysis}`;
    staticItem.detail = [
      project.name,
      ...(lines.length ? [lines.map((line) => line.text).join(" ")] : []),
    ].join(" · ");
    const command = lines.find((line) => line.command)?.command;
    staticItem.command = command && { ...command, arguments: [project.root] };

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

/** The missing column-lineage opt-ins, each with the command that adds it when one exists. */
export function optInLines(optIns: ProjectOptIns | undefined): OptInLine[] {
  if (!optIns) {
    return [];
  }
  const lines: OptInLine[] = [];
  if (!optIns.strict) {
    lines.push({
      text: `Strict analysis is not enabled in ${DBT_PROJECT_FILE}.`,
      command: {
        title: "Enable strict analysis",
        command: "fusionPowerUser.enableStrictAnalysis",
      },
    });
  }
  const origin = optIns.schemaOrigin;
  switch (origin.kind) {
    case "local":
      break;
    case "noHook":
      lines.push({
        text: "Sources read their schemas from the warehouse.",
        command: {
          title: "Add schema-origin hook",
          command: "fusionPowerUser.addSchemaOriginHook",
        },
      });
      break;
    case "untypedSources":
      lines.push({
        text:
          `${origin.missing.length} source column(s) or table(s) lack a data_type, ` +
          "so strict analysis still needs the warehouse.",
      });
      break;
  }
  return lines;
}

export function clientText(state: FusionClientState): string {
  switch (state) {
    case "starting":
      return "$(sync~spin) dbt Fusion starting";
    case "restarting":
      return "$(sync~spin) dbt Fusion restarting";
    case "running":
      return "$(check) dbt Fusion";
    case "failed":
      return "$(error) dbt Fusion";
    case "stopped":
      return "$(debug-disconnect) dbt Fusion";
  }
}

export function clientSeverity(
  state: FusionClientState,
): LanguageStatusSeverity {
  switch (state) {
    case "failed":
      return LanguageStatusSeverity.Error;
    case "stopped":
      return LanguageStatusSeverity.Warning;
    default:
      return LanguageStatusSeverity.Information;
  }
}

export function failureSummary(
  reason: string | undefined,
  maxLength = 240,
): string | undefined {
  if (!reason) {
    return undefined;
  }
  const line = reason
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  if (!line) {
    return undefined;
  }
  const plain = line.replace(/\$\([^)]*\)/g, "").trim();
  if (!plain) {
    return undefined;
  }
  return plain.length > maxLength ? `${plain.slice(0, maxLength)}…` : plain;
}
