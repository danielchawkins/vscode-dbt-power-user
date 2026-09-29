import {
  Disposable,
  Event,
  MarkdownString,
  StatusBarAlignment,
  StatusBarItem,
  window,
} from "vscode";
import { DBT_PROJECT_FILE } from "../core/project";
import { SchemaOriginStatus } from "../fusion/schemaOrigin";
import { ProjectContext } from "../projects/projectContext";
import { DeclaredProject } from "../projects/projectRegistry";
import { FusionClientPool } from "./fusionClientPool";
import { FusionClient, FusionClientState } from "./fusionLanguageClient";

/** What a project has opted into in its own project file, for the tooltip. */
export interface ProjectOptIns {
  strict: boolean;
  schemaOrigin: SchemaOriginStatus;
}

export class FusionStatus implements Disposable {
  readonly statusBar: StatusBarItem = window.createStatusBarItem(
    StatusBarAlignment.Left,
    10,
  );
  private readonly disposables: Disposable[] = [];
  private clientSubscription: Disposable | undefined;

  constructor(
    private readonly projectContext: ProjectContext,
    private readonly clientPool: FusionClientPool,
    private readonly optIns: (
      project: DeclaredProject,
    ) => ProjectOptIns | undefined = () => undefined,
    onDidChangeOptIns?: Event<unknown>,
  ) {
    if (onDidChangeOptIns) {
      this.disposables.push(onDidChangeOptIns(() => this.render()));
    }
    this.disposables.push(
      this.projectContext.onDidChangeCurrent(() => {
        this.rewireClientListener();
        this.render();
      }),
      this.clientPool.onDidChangeClients(() => {
        this.rewireClientListener();
        this.render();
      }),
    );
  }

  initialize(): void {
    this.rewireClientListener();
    this.render();
  }

  dispose(): void {
    this.clientSubscription?.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
    this.statusBar.dispose();
  }

  private rewireClientListener(): void {
    this.clientSubscription?.dispose();
    const client = this.currentClient();
    if (!client) {
      this.clientSubscription = undefined;
      return;
    }
    this.clientSubscription = client.onDidChangeState(() => this.render());
  }

  private currentClient(): FusionClient | undefined {
    const project = this.projectContext.current;
    if (!project) {
      return undefined;
    }
    return this.clientPool.get(project);
  }

  private render(): void {
    const project = this.projectContext.current;
    const client = project ? this.clientPool.get(project) : undefined;
    if (!project || !client) {
      this.statusBar.hide();
      return;
    }

    this.statusBar.text = statusText(
      client.state,
      `static: ${client.staticAnalysis}`,
    );
    this.statusBar.tooltip = buildTooltip(
      project,
      client,
      this.optIns(project),
    );
    this.statusBar.show();
  }
}

/**
 * Tooltip lines for the column-lineage opt-ins that are missing. Links run the commands that add them;
 * nothing is written without that command's confirmation.
 */
export function optInLines(optIns: ProjectOptIns | undefined): string[] {
  if (!optIns) {
    return [];
  }
  const lines: string[] = [];
  if (!optIns.strict) {
    lines.push(
      `Strict analysis is not enabled in ${DBT_PROJECT_FILE}. [Enable](command:fusionPowerUser.enableStrictAnalysis)`,
    );
  }
  const origin = optIns.schemaOrigin;
  switch (origin.kind) {
    case "local":
      break;
    case "noHook":
      lines.push(
        "Sources read their schemas from the warehouse. [Add schema-origin hook](command:fusionPowerUser.addSchemaOriginHook)",
      );
      break;
    case "unsupportedFusion":
      lines.push(
        `Local source schemas need dbt Fusion 2.0.6 or later (found ${origin.version}).`,
      );
      break;
    case "untypedSources":
      lines.push(
        `${origin.missing.length} source column(s) or table(s) lack a data_type, so strict analysis still needs the warehouse.`,
      );
      break;
  }
  return lines;
}

export function statusText(
  state: FusionClientState,
  staticLabel: string,
): string {
  const suffix = ` · ${staticLabel}`;
  switch (state) {
    case "starting":
      return `$(sync~spin) dbt Fusion starting${suffix}`;
    case "restarting":
      return `$(sync~spin) dbt Fusion restarting${suffix}`;
    case "running":
      return `$(check) dbt Fusion${suffix}`;
    case "failed":
      return `$(error) dbt Fusion${suffix}`;
    case "stopped":
      return `$(debug-disconnect) dbt Fusion${suffix}`;
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

export function buildTooltip(
  project: DeclaredProject,
  client: FusionClient,
  optIns?: ProjectOptIns,
): MarkdownString {
  const lines = [
    `**${project.name}**`,
    "",
    `State: ${client.state}`,
    "",
    `Static analysis: ${client.staticAnalysis}`,
    "",
    `Output: ${client.outputChannel.name}`,
    "",
  ];
  if (client.state === "failed") {
    const summary = failureSummary(client.failureReason);
    if (summary) {
      lines.push(`Failure: ${summary}. See the output channel for full logs.`);
    }
  }
  for (const line of optInLines(optIns)) {
    lines.push("", line);
  }
  const tooltip = new MarkdownString(lines.join("\n"), true);
  // Project and failure text is untrusted; only these two command links may run.
  tooltip.isTrusted = { enabledCommands: [...OPT_IN_COMMANDS] };
  tooltip.supportHtml = false;
  return tooltip;
}

const OPT_IN_COMMANDS = [
  "fusionPowerUser.enableStrictAnalysis",
  "fusionPowerUser.addSchemaOriginHook",
] as const;
