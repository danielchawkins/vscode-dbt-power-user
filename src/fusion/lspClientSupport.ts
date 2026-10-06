import { realpathSync } from "fs";
import * as path from "path";
import type { CancellationToken, Disposable, LogOutputChannel } from "vscode";
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
const FUSION_COMPILE_COMPLETE = [
  "dbt/lspCompileComplete",
  "dbt/lspBackgroundCompileComplete",
] as const;

/** The `Error`-severity messages of a compile-complete notification's `errors`. */
function compileErrorMessages(params: unknown): string[] {
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

/** How long a formatting request waits for the server's first compile before giving up. */
const FORMAT_COMPILE_WAIT_MS = 5_000;

/** LSP `RequestFailed`. */
const REQUEST_FAILED = -32803;

/** Counts `dbt/lspCompileComplete` notifications so a request can wait for the next one. */
export class CompileSignal {
  private count = 0;
  private readonly waiters = new Set<() => void>();

  get completions(): number {
    return this.count;
  }

  notify(): void {
    this.count += 1;
    for (const waiter of [...this.waiters]) {
      waiter();
    }
  }

  /** Resolves once a compile completes after `since`, after `timeoutMs`, or when `token` is cancelled. */
  async after(
    since: number,
    timeoutMs: number,
    token?: { onCancellationRequested: (listener: () => void) => Disposable },
  ): Promise<void> {
    if (this.count > since) {
      return;
    }
    await new Promise<void>((resolve) => {
      const cancelled = token?.onCancellationRequested(() => done());
      const done = () => {
        clearTimeout(timer);
        cancelled?.dispose();
        this.waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      this.waiters.add(done);
    });
  }
}

/** Counts `dbt/lspCompileComplete` on `compiled` and passes each compile's errors to `onCompileErrors`. */
export function subscribeToCompileComplete(
  client: ClientHandle,
  compiled: CompileSignal,
  onCompileErrors?: (messages: string[]) => void,
): void {
  for (const method of FUSION_COMPILE_COMPLETE) {
    client.onNotification?.(method, (params: unknown) => {
      if (method === "dbt/lspCompileComplete") {
        compiled.notify();
      }
      onCompileErrors?.(compileErrorMessages(params));
    });
  }
}

/** True for Fusion's refusal to format a document it has not compiled yet. */
function isNoCompilerStateError(error: unknown): boolean {
  const { code, message } = (error ?? {}) as {
    code?: unknown;
    message?: unknown;
  };
  return (
    code === REQUEST_FAILED &&
    typeof message === "string" &&
    message.includes("no compiler state")
  );
}

const FORMAT_METHODS = new Set([
  "textDocument/formatting",
  "textDocument/rangeFormatting",
]);

/**
 * Runs a formatting request; on the no-compiler-state error waits once for the next compile and retries once.
 * Still failing, or cancelled while waiting, it returns no edits. Other errors propagate.
 * Runs in `middleware.sendRequest`, below the library's failure handler, which would show a toast.
 */
async function formatOnceCompiled<R>(
  request: () => Promise<R>,
  compiled: CompileSignal,
  log: (message: string) => void,
  token: CancellationToken | undefined,
  timeoutMs: number = FORMAT_COMPILE_WAIT_MS,
): Promise<R> {
  const since = compiled.completions;
  try {
    return await request();
  } catch (error) {
    if (!isNoCompilerStateError(error)) {
      throw error;
    }
  }
  await compiled.after(since, timeoutMs, token);
  if (token?.isCancellationRequested) {
    return null as R;
  }
  try {
    return await request();
  } catch (error) {
    if (!isNoCompilerStateError(error)) {
      throw error;
    }
    log(
      "Formatting skipped: the server has no compiler state for this document yet.",
    );
    return null as R;
  }
}

/**
 * The arguments of `command`. `compileFile` takes a URI string, which skips the document `uriConverters`, so it is
 * mapped the same way; the server matches URIs literally and would not find a file under a symlinked root.
 */
export function commandArguments(
  command: string,
  args: unknown[],
  uriConverters: LanguageClientOptions["uriConverters"],
): unknown[] {
  if (command !== "dbt.compileFile" || !uriConverters) {
    return args;
  }
  return args.map((arg) =>
    typeof arg === "string" ? uriConverters.code2Protocol(Uri.parse(arg)) : arg,
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
  compiled?: CompileSignal;
}): LanguageClientOptions {
  const compiled = input.compiled ?? new CompileSignal();
  const log = (message: string) => input.outputChannel.info(message);
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
      sendRequest: (type, param, token, next) => {
        const method = typeof type === "string" ? type : type.method;
        return FORMAT_METHODS.has(method)
          ? formatOnceCompiled(
              () => next(type, param, token),
              compiled,
              log,
              token,
            )
          : next(type, param, token);
      },
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
