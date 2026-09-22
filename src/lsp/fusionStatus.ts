import {
  Disposable,
  MarkdownString,
  StatusBarAlignment,
  StatusBarItem,
  window,
} from "vscode";
import { ProjectContext } from "../projects/projectContext";
import { DeclaredProject } from "../projects/projectRegistry";
import { FusionClientPool } from "./fusionClientPool";
import { FusionClient, FusionClientState } from "./fusionLanguageClient";

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
  ) {
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
    const subscriptions: Disposable[] = [
      client.onDidChangeState(() => this.render()),
      client.onDidChangeStaticAnalysis(() => this.render()),
    ];
    this.clientSubscription = {
      dispose: () => {
        for (const subscription of subscriptions) {
          subscription.dispose();
        }
      },
    };
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
      `static: ${client.staticAnalysis.effective}`,
    );
    this.statusBar.tooltip = buildTooltip(project, client);
    this.statusBar.show();
  }
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
): MarkdownString {
  const lines = [
    `**${project.name}**`,
    "",
    `State: ${client.state}`,
    "",
    `Effective static analysis: ${client.staticAnalysis.effective}`,
    "",
    `Configured static analysis: ${client.staticAnalysis.configured}`,
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
  const tooltip = new MarkdownString(lines.join("\n"), true);
  tooltip.isTrusted = false;
  tooltip.supportHtml = false;
  return tooltip;
}
