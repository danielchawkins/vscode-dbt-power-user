import { realpathSync } from "fs";
import * as path from "path";
import type { LogOutputChannel } from "vscode";
import { Uri } from "vscode";
import type {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node";
import type { FusionProjectRef } from "./fusionClient";
import type { ProjectDiagnosticsFilter } from "./fusionDiagnostics";
import { spawnProcess, type ChildProcess } from "./process";
import type {
  acceptWithProcessExit,
  listenForServer,
} from "./reverseSocketTransport";

/** Client command in Fusion's CTE code lenses; not advertised by initialize, and no command here handles it. */
const FUSION_LSP_PREVIEW_CTE = "dbt.previewCte" as const;

/**
 * Fusion canonicalizes `--project-dir` but matches document URIs literally, so a project opened through a
 * symlink loads no documents. Returns the realpath to launch Fusion on and converters that move URIs between
 * the opened root and that realpath; converters are undefined when the two are the same.
 */
export function canonicalProjectRoot(
  root: string,
  realpath: (fsPath: string) => string = realpathSync.native,
): {
  launchRoot: string;
  uriConverters?: LanguageClientOptions["uriConverters"];
} {
  let launchRoot: string;
  try {
    launchRoot = realpath(root);
  } catch {
    return { launchRoot: root };
  }
  if (launchRoot === root) {
    return { launchRoot };
  }
  const remap = (
    fsPath: string,
    from: string,
    to: string,
  ): string | undefined => {
    if (fsPath === from) {
      return to;
    }
    return fsPath.startsWith(from + path.sep)
      ? to + fsPath.slice(from.length)
      : undefined;
  };
  return {
    launchRoot,
    uriConverters: {
      code2Protocol: (uri) => {
        const mapped =
          uri.scheme === "file"
            ? remap(uri.fsPath, root, launchRoot)
            : undefined;
        return (mapped ? Uri.file(mapped) : uri).toString();
      },
      protocol2Code: (value) => {
        const uri = Uri.parse(value);
        const mapped =
          uri.scheme === "file"
            ? remap(uri.fsPath, launchRoot, root)
            : undefined;
        return mapped ? Uri.file(mapped) : uri;
      },
    },
  };
}

/**
 * Drops server code lenses whose command no extension here registers. Fusion emits `dbt.previewCte` lenses for
 * the official dbt extension's client command; `CteCodeLensProvider` supplies the CTE actions instead.
 * @internal
 */
export function withoutUnregisteredLspLenses<
  T extends { command?: { command: string } },
>(lenses: T[] | null | undefined): T[] | null | undefined {
  return lenses?.filter(
    (lens) => lens.command?.command !== FUSION_LSP_PREVIEW_CTE,
  );
}

/**
 * Returns minimal dbt config: `{lsp:{linter:{enabled:bool}}}`, null for other sections.
 * @internal
 */
export function buildWorkspaceConfigurationResponse(
  section: string,
  lintEnabled: boolean,
): unknown {
  if (section === "dbt") {
    return {
      lsp: {
        linter: {
          enabled: lintEnabled,
        },
      },
    };
  }
  return null;
}

/** Fusion's notifications that end a compile; `errors` lists what it found. */
export const FUSION_COMPILE_COMPLETE = [
  "dbt/lspCompileComplete",
  "dbt/lspBackgroundCompileComplete",
] as const;

/** The `Error`-severity messages of a compile-complete notification's `errors`. */
export function compileErrorMessages(params: unknown): string[] {
  const errors = (params as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(errors)) {
    return [];
  }
  return errors.flatMap((error: { message?: unknown; severity?: unknown }) =>
    error?.severity === "Error" && typeof error.message === "string"
      ? [error.message]
      : [],
  );
}

/** The options one Declared Project's `LanguageClient` is created with. */
export function languageClientOptions(input: {
  project: FusionProjectRef;
  selector: LanguageClientOptions["documentSelector"] | undefined;
  uriConverters: LanguageClientOptions["uriConverters"] | undefined;
  outputChannel: LogOutputChannel;
  diagnosticsFilter: ProjectDiagnosticsFilter;
  lintEnabled: boolean;
}): LanguageClientOptions {
  const { project, diagnosticsFilter } = input;
  return {
    ...(input.selector ? { documentSelector: input.selector } : {}),
    ...(input.uriConverters ? { uriConverters: input.uriConverters } : {}),
    connectionOptions: { maxRestartCount: 0 },
    outputChannel: input.outputChannel,
    traceOutputChannel: input.outputChannel,
    workspaceFolder: {
      uri: project.folder.uri,
      name: project.folder.name,
      index: project.folder.index,
    },
    middleware: {
      provideCodeLenses: async (document, token, next) =>
        withoutUnregisteredLspLenses(await next(document, token)),
      handleDiagnostics: (uri, diagnostics, next) => {
        if (diagnosticsFilter.shouldForward(uri)) {
          next(uri, diagnostics);
        }
      },
      workspace: {
        configuration: async (params) =>
          params.items.map((item) =>
            buildWorkspaceConfigurationResponse(
              item.section ?? "",
              input.lintEnabled,
            ),
          ),
      },
    },
  };
}

export type FusionLanguageClientDependencies = {
  listenForServer?: typeof listenForServer;
  acceptWithProcessExit?: typeof acceptWithProcessExit;
  spawnProcess?: (
    executable: string,
    args: string[],
    env: Record<string, string>,
    cwd?: string,
  ) => ChildProcess;
  createLanguageClient?: (
    id: string,
    name: string,
    serverOptions: ServerOptions,
    clientOptions: LanguageClientOptions,
  ) => Promise<ClientHandle>;
  sleep?: (ms: number) => Promise<void>;
};

export type ClientHandle = Pick<
  LanguageClient,
  "start" | "stop" | "sendRequest" | "onDidChangeState" | "dispose"
> &
  Partial<Pick<LanguageClient, "diagnostics" | "onNotification">>;

export function defaultSpawn(
  executable: string,
  args: string[],
  env: Record<string, string>,
  cwd?: string,
): ChildProcess {
  return spawnProcess(executable, args, {
    env,
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export async function defaultCreateLanguageClient(
  id: string,
  name: string,
  serverOptions: ServerOptions,
  clientOptions: LanguageClientOptions,
): Promise<ClientHandle> {
  const { LanguageClient: Client } = await import("vscode-languageclient/node");
  return new Client(id, name, serverOptions, clientOptions);
}
