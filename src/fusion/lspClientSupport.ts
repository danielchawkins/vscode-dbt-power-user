import type { CancellationToken, Disposable, LogOutputChannel } from "vscode";
import { CodeLens, Uri } from "vscode";
import type {
  LanguageClient,
  LanguageClientOptions,
  Middleware,
  ServerOptions,
} from "vscode-languageclient/node";
import { fusionCteFromLens, type FusionCte } from "../core/cte/ctePreview";
import type { LspLaunch } from "../core/lsp";
import { clientErrorHandler, inactiveGate } from "./clientLifecycle";
import type { FusionProjectRef } from "./fusionClient";
import type { ProjectDiagnosticsFilter } from "./fusionDiagnostics";
import {
  guardMiddleware,
  type NestedRootGuard,
  type OpenDocuments,
} from "./nestedRoots";
import { spawnProcess, type ChildProcess } from "./process";
import type {
  acceptWithProcessExit,
  listenForServer,
} from "./reverseSocketTransport";

/** Client command in Fusion's CTE code lenses; not advertised by initialize, and no command here handles it. */
const FUSION_LSP_PREVIEW_CTE = "dbt.previewCte" as const;

export { canonicalProjectRoot } from "./canonicalProjectRoot";

/**
 * Maps Fusion's `dbt.previewCte` lenses, which carry a client command this extension does not register, to the
 * extension's own CTE actions: "Execute CTE: <name>" on each CTE and one "Profile CTEs" on the first. Other lenses
 * pass through. A lens whose argument has an unexpected shape is dropped.
 * @internal
 */
export function mapCteLenses(
  lenses: CodeLens[] | null | undefined,
  documentUri: Uri,
): CodeLens[] | null | undefined {
  if (!lenses) {
    return lenses;
  }
  const mapped: CodeLens[] = [];
  const ctes: FusionCte[] = [];
  const lensOfCte: CodeLens[] = [];
  for (const lens of lenses) {
    if (lens.command?.command !== FUSION_LSP_PREVIEW_CTE) {
      mapped.push(lens);
      continue;
    }
    const cte = fusionCteFromLens(
      lens.command.arguments?.[1],
      lens.range.start.line,
    );
    if (cte) {
      ctes.push(cte);
      lensOfCte.push(lens);
    }
  }
  ctes.forEach((cte, index) => {
    const range = lensOfCte[index]?.range;
    if (!range) {
      return;
    }
    mapped.push(
      new CodeLens(range, {
        title: `$(play) Execute CTE: ${cte.name}`,
        command: "fusionPowerUser.runCteWithDependencies",
        arguments: [{ uri: documentUri, cte }],
      }),
    );
    if (index === 0) {
      mapped.push(
        new CodeLens(range, {
          title: "⏱ Profile CTEs",
          command: "fusionPowerUser.profileCtes",
          arguments: [documentUri, ctes],
        }),
      );
    }
  });
  return mapped;
}

/**
 * Returns minimal dbt config: `{lsp:{linter:{enabled:bool}, maxErrorReporting?}}`, null for other sections.
 * @internal
 */
export function buildWorkspaceConfigurationResponse(
  section: string,
  lintEnabled: boolean,
  maxErrorReporting?: number,
): unknown {
  if (section === "dbt") {
    return {
      lsp: {
        linter: {
          enabled: lintEnabled,
        },
        ...(maxErrorReporting === undefined ? {} : { maxErrorReporting }),
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
    // Snapshot: a waiter removes itself when it runs.
    const waiters = [...this.waiters];
    for (const waiter of waiters) {
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
  /** What the client answers `workspace/configuration` for section `dbt` with. */
  config: Pick<LspLaunch, "lintEnabled" | "maxErrorReporting">;
  compiled?: CompileSignal;
  /** Keeps documents under nested roots away from this client; see {@link guardMiddleware}. */
  nestedRoots?:
    | { guard: NestedRootGuard; openDocuments: OpenDocuments }
    | undefined;
  /**
   * Whether the client is stopping or stopped. Its notifications are then dropped, and a connection error on it is
   * not reported; see {@link clientErrorHandler}. Defaults to a client that is never inactive.
   */
  isInactive?: () => boolean;
}): LanguageClientOptions {
  const { project, nestedRoots } = input;
  const isInactive = input.isInactive ?? (() => false);
  const middleware = fusionMiddleware({
    compiled: input.compiled ?? new CompileSignal(),
    outputChannel: input.outputChannel,
    diagnosticsFilter: input.diagnosticsFilter,
    config: input.config,
    dropInactive: inactiveGate(isInactive, input.outputChannel),
  });
  return {
    ...(input.selector ? { documentSelector: input.selector } : {}),
    ...(input.uriConverters ? { uriConverters: input.uriConverters } : {}),
    connectionOptions: { maxRestartCount: 0 },
    errorHandler: clientErrorHandler({
      project,
      outputChannel: input.outputChannel,
      isInactive,
    }),
    outputChannel: input.outputChannel,
    traceOutputChannel: input.outputChannel,
    workspaceFolder: {
      uri: project.folder.uri,
      name: project.folder.name,
      index: project.folder.index,
    },
    middleware: nestedRoots
      ? guardMiddleware(
          nestedRoots.guard,
          middleware,
          nestedRoots.openDocuments,
        )
      : middleware,
  };
}

/**
 * The middleware of one Declared Project's client: it maps code lenses and compile requests, filters diagnostics to
 * the project, answers workspace configuration, and drops document and watched-file notifications while the client is
 * inactive.
 */
function fusionMiddleware(input: {
  compiled: CompileSignal;
  outputChannel: LogOutputChannel;
  diagnosticsFilter: ProjectDiagnosticsFilter;
  config: Pick<LspLaunch, "lintEnabled" | "maxErrorReporting">;
  dropInactive: (method: string) => boolean;
}): Middleware {
  const { compiled, diagnosticsFilter, dropInactive } = input;
  const log = (message: string) => input.outputChannel.info(message);
  return {
    provideCodeLenses: async (document, token, next) =>
      mapCteLenses(await next(document, token), document.uri),
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
    didOpen: async (document, next) => {
      if (!dropInactive("textDocument/didOpen")) {
        await next(document);
      }
    },
    didChange: async (event, next) => {
      if (!dropInactive("textDocument/didChange")) {
        await next(event);
      }
    },
    didSave: async (document, next) => {
      if (!dropInactive("textDocument/didSave")) {
        await next(document);
      }
    },
    didClose: async (document, next) => {
      if (!dropInactive("textDocument/didClose")) {
        await next(document);
      }
    },
    workspace: {
      didChangeWatchedFile: (event, next) =>
        dropInactive("workspace/didChangeWatchedFiles")
          ? Promise.resolve()
          : next(event),
      configuration: async (params) =>
        params.items.map((item) =>
          buildWorkspaceConfigurationResponse(
            item.section ?? "",
            input.config.lintEnabled,
            input.config.maxErrorReporting,
          ),
        ),
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
  | "start"
  | "stop"
  | "sendRequest"
  | "sendNotification"
  | "onDidChangeState"
  | "dispose"
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
