import type { LogOutputChannel } from "vscode";
import { CodeLens, Uri } from "vscode";
import type {
  LanguageClient,
  LanguageClientOptions,
  Middleware,
  ServerOptions,
} from "vscode-languageclient/node";
import { fusionCteFromLens, type FusionCte } from "../core/cte/ctePreview";
import type { LspLaunch } from "../core/lsp";
import { serverIgnoresPath } from "../core/paths";
import { clientErrorHandler, inactiveGate } from "./clientLifecycle";
import {
  ServerCompileState,
  FORMAT_METHODS,
  formatOnceCompiled,
} from "./compileSignal";
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
  /** The project's target directory. Watched-file events under it are the server's own writes, so they are dropped. */
  targetPath: string;
  selector: LanguageClientOptions["documentSelector"] | undefined;
  uriConverters: LanguageClientOptions["uriConverters"] | undefined;
  outputChannel: LogOutputChannel;
  diagnosticsFilter: ProjectDiagnosticsFilter;
  /** What the client answers `workspace/configuration` for section `dbt` with. */
  config: Pick<LspLaunch, "lintEnabled" | "maxErrorReporting">;
  compileState?: ServerCompileState;
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
    compiled: input.compileState ?? new ServerCompileState(),
    outputChannel: input.outputChannel,
    diagnosticsFilter: input.diagnosticsFilter,
    config: input.config,
    dropInactive: inactiveGate(isInactive, input.outputChannel),
    ignoresWatchedFile: (uri) => {
      const parsed = Uri.parse(uri);
      return (
        parsed.scheme === "file" &&
        serverIgnoresPath(project.root.fsPath, input.targetPath, parsed.fsPath)
      );
    },
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

/** The document notifications the middleware can drop while the client is inactive, keyed by middleware hook. */
const DOCUMENT_NOTIFICATIONS = {
  didOpen: "textDocument/didOpen",
  didChange: "textDocument/didChange",
  didSave: "textDocument/didSave",
  didClose: "textDocument/didClose",
} as const;

/** Each document hook forwards its notification to `next` unless the client is inactive. */
function gatedDocumentHooks(
  dropInactive: (method: string) => boolean,
): Pick<Middleware, keyof typeof DOCUMENT_NOTIFICATIONS> {
  const gate =
    <T>(method: string) =>
    async (data: T, next: (data: T) => unknown) => {
      if (!dropInactive(method)) {
        await next(data);
      }
    };
  return {
    didOpen: gate(DOCUMENT_NOTIFICATIONS.didOpen),
    didChange: gate(DOCUMENT_NOTIFICATIONS.didChange),
    didSave: gate(DOCUMENT_NOTIFICATIONS.didSave),
    didClose: gate(DOCUMENT_NOTIFICATIONS.didClose),
  };
}

/**
 * The middleware of one Declared Project's client: it maps code lenses and compile requests, filters diagnostics to
 * the project, answers workspace configuration, and drops document and watched-file notifications while the client is
 * inactive.
 */
function fusionMiddleware(input: {
  compiled: ServerCompileState;
  outputChannel: LogOutputChannel;
  diagnosticsFilter: ProjectDiagnosticsFilter;
  config: Pick<LspLaunch, "lintEnabled" | "maxErrorReporting">;
  dropInactive: (method: string) => boolean;
  /** Whether a watched-file event's URI is one the server writes itself. */
  ignoresWatchedFile: (uri: string) => boolean;
}): Middleware {
  const { compiled, diagnosticsFilter, dropInactive, ignoresWatchedFile } =
    input;
  const log = (message: string) => input.outputChannel.info(message);
  return {
    provideCodeLenses: async (document, token, next) =>
      mapCteLenses(await next(document, token), document.uri),
    sendRequest: (type, param, token, next) => {
      const method = typeof type === "string" ? type : type.method;
      return FORMAT_METHODS.has(method)
        ? formatOnceCompiled(() => next(type, param, token), {
            compiled,
            log,
            token,
          })
        : next(type, param, token);
    },
    handleDiagnostics: (uri, diagnostics, next) => {
      if (diagnosticsFilter.shouldForward(uri)) {
        next(uri, diagnostics);
      }
    },
    ...gatedDocumentHooks(dropInactive),
    workspace: {
      didChangeWatchedFile: (event, next) =>
        dropInactive("workspace/didChangeWatchedFiles") ||
        ignoresWatchedFile(event.uri)
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
  spawnProcess?: (spec: ServerSpawnSpec) => ChildProcess;
  createLanguageClient?: (
    id: string,
    name: string,
    serverOptions: ServerOptions,
    clientOptions: LanguageClientOptions,
  ) => Promise<ClientHandle>;
  sleep?: (ms: number) => Promise<void>;
  /** Whether a project root still has its project file; defaults to the file system. Tests stand in for it. */
  rootExists?: (root: Uri) => boolean;
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

/** What the client needs to start one language server process. */
export type ServerSpawnSpec = {
  executable: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
};

export function defaultSpawn(spec: ServerSpawnSpec): ChildProcess {
  return spawnProcess(spec.executable, spec.args, {
    env: spec.env,
    cwd: spec.cwd,
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
