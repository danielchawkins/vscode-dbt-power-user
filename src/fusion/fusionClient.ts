import type {
  CancellationToken,
  Disposable,
  Event,
  LogOutputChannel,
  Uri,
  WorkspaceFolder,
} from "vscode";
import type { LspLaunch } from "../core/lsp";
import { projectRootDigest, type StaticAnalysisMode } from "../core/project";
import type { FusionExecutable } from "./fusionExecutable";

export const FUSION_LSP_COMMANDS = {
  listNodes: "dbt.listNodes",
  getCurrentNode: "dbt.getCurrentNode",
  compileFile: "dbt.compileFile",
  compileLsp: "dbt.compileLsp",
  clearTarget: "dbt.clearTarget",
  getProjectInfo: "dbt.getProjectInfo",
} as const;

export type FusionLspCommand =
  | (typeof FUSION_LSP_COMMANDS)[keyof typeof FUSION_LSP_COMMANDS]
  | "dbt.previewCte";

/** The project fields a Fusion client reads; a Declared Project satisfies it. */
export interface FusionProjectRef {
  readonly root: Uri;
  readonly name: string;
  readonly folder: WorkspaceFolder;
}

export type FusionClientState =
  "starting" | "running" | "restarting" | "stopped" | "failed";

export interface FusionClientOptions {
  project: FusionProjectRef;
  /** Supplies the spawned path; its environment is not used. */
  executable: FusionExecutable;
  /** Reused by `restart()` and unexpected-exit restarts. */
  launch: LspLaunch;
  /** Namespaces workspace/executeCommand so two extensions can serve the same window. */
  commandPrefix: string;
  /** Layered over `launch.environment`; the launch's `DBT_LSP_USE_TARGET_LSP` choice still wins. */
  env?: Record<string, string>;
  /** The Declared Project's log channel; receives client, trace and server output. The client never disposes it. */
  outputChannel: LogOutputChannel;
  /** Receives the error messages of each compile the server reports; empty after a clean compile. */
  onCompileErrors?: (messages: string[]) => void;
}

export interface FusionClient extends Disposable {
  readonly project: FusionProjectRef;
  readonly state: FusionClientState;
  /** Configured `fusionPowerUser.staticAnalysis` for this Declared Project; fixed for the client's lifetime. */
  readonly staticAnalysis: StaticAnalysisMode;
  readonly outputChannel: LogOutputChannel;
  readonly failureReason: string | undefined;
  readonly onDidChangeState: Event<FusionClientState>;
  /** Sends `workspace/executeCommand`; {@link FusionCommands} queues and times out the calls. */
  request<T>(
    command: FusionLspCommand,
    payload: unknown,
    token?: CancellationToken,
  ): Promise<T>;
  restart(): Promise<void>;
  /** Awaitable stop path for tests; sync dispose starts this without awaiting. */
  stop(): Promise<void>;
}

const EXTENSION_PREFIX_NAMESPACE = "fusionPowerUser";
export const DISPOSAL_GRACE_MS = 5_000;
export const MAX_UNEXPECTED_EXIT_RETRIES = 3;
export function commandPrefixForProject(project: FusionProjectRef): string {
  return `${EXTENSION_PREFIX_NAMESPACE}:${projectRootDigest(project.root.fsPath)}:`;
}

export function languageClientIdForProject(project: FusionProjectRef): string {
  return `fusion-lsp-${projectRootDigest(project.root.fsPath)}`;
}

export function prefixedCommand(
  commandPrefix: string,
  command: FusionLspCommand,
): string {
  return `${commandPrefix}${command}`;
}
