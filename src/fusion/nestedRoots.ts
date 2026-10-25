import type { Disposable, Event, TextDocument } from "vscode";
import { Uri } from "vscode";
import type { Middleware } from "vscode-languageclient/node";
import { isAtOrBelow } from "../core/paths";

/**
 * Excludes `file` URIs under a root declared strictly below `root`, so the outer project's server never receives
 * a nested project's files. Roots are read on each call, so a root declared later applies without a restart.
 */
export class NestedRootGuard {
  private readonly root: Uri;
  private readonly nestedRoots: () => readonly Uri[];

  constructor(root: Uri, nestedRoots: () => readonly Uri[]) {
    this.root = root;
    this.nestedRoots = nestedRoots;
  }

  excludes(uri: Uri): boolean {
    return (
      uri.scheme === "file" &&
      this.nestedRoots().some(
        (nested) =>
          nested.fsPath !== this.root.fsPath &&
          isAtOrBelow(this.root.fsPath, nested.fsPath) &&
          isAtOrBelow(nested.fsPath, uri.fsPath),
      )
    );
  }
}

/** Documents whose didOpen reached the server and whose didClose has not, keyed by URI string. */
export class OpenDocuments {
  private readonly documents = new Map<string, Uri>();

  get uris(): readonly Uri[] {
    return [...this.documents.values()];
  }

  opened(uri: Uri): void {
    this.documents.set(uri.toString(), uri);
  }

  closed(uri: Uri): void {
    this.documents.delete(uri.toString());
  }

  clear(): void {
    this.documents.clear();
  }
}

/** The first argument of a document hook: a document, a URI, or a change or save event that carries a document. */
type DocumentArgument =
  | TextDocument
  | Uri
  | { readonly document: TextDocument };

type Hook = (argument: DocumentArgument, ...rest: unknown[]) => unknown;

/** Every Middleware hook whose first argument is a document or URI, other than the sync hooks below. */
const PROVIDER_HOOKS = [
  "prepareCallHierarchy",
  "prepareRename",
  "prepareTypeHierarchy",
  "provideCodeActions",
  "provideCodeLenses",
  "provideCompletionItem",
  "provideDeclaration",
  "provideDefinition",
  "provideDiagnostics",
  "provideDocumentColors",
  "provideDocumentFormattingEdits",
  "provideDocumentHighlights",
  "provideDocumentLinks",
  "provideDocumentRangeFormattingEdits",
  "provideDocumentRangeSemanticTokens",
  "provideDocumentRangesFormattingEdits",
  "provideDocumentSemanticTokens",
  "provideDocumentSemanticTokensEdits",
  "provideDocumentSymbols",
  "provideFoldingRanges",
  "provideHover",
  "provideImplementation",
  "provideInlayHints",
  "provideInlineCompletionItems",
  "provideInlineValues",
  "provideLinkedEditingRange",
  "provideOnTypeFormattingEdits",
  "provideReferences",
  "provideRenameEdits",
  "provideSelectionRanges",
  "provideSignatureHelp",
  "provideTypeDefinition",
] as const;

const SYNC_HOOKS = [
  "didOpen",
  "didChange",
  "willSave",
  "willSaveWaitUntil",
  "didSave",
  "didClose",
] as const;

function uriOf(argument: DocumentArgument): Uri {
  if ("document" in argument) {
    return argument.document.uri;
  }
  return "uri" in argument ? argument.uri : argument;
}

/** Calls the inner hook with the arguments, or `next`, the last argument, when there is no inner hook. */
function forward(inner: Hook | undefined, args: unknown[]): unknown {
  if (inner) {
    return inner(args[0] as DocumentArgument, ...args.slice(1));
  }
  const next = args.at(-1) as (...params: unknown[]) => unknown;
  return next(...args.slice(0, -1));
}

function providerHook(guard: NestedRootGuard, inner: Hook | undefined): Hook {
  return (argument, ...rest) =>
    guard.excludes(uriOf(argument))
      ? undefined
      : forward(inner, [argument, ...rest]);
}

function syncHook(
  guard: NestedRootGuard,
  name: (typeof SYNC_HOOKS)[number],
  inner: Hook | undefined,
  open: OpenDocuments | undefined,
): Hook {
  return (argument, ...rest) => {
    const uri = uriOf(argument);
    if (guard.excludes(uri)) {
      return Promise.resolve();
    }
    if (name === "didOpen") {
      open?.opened(uri);
    } else if (name === "didClose") {
      open?.closed(uri);
    }
    return forward(inner, [argument, ...rest]);
  };
}

/**
 * Wraps the client's middleware so the outer server never sees documents, diagnostics or watched files under a
 * nested root. An excluded document gets `undefined` from a provider hook and skips the sync hook's `next`.
 * `open`, when given, records the documents whose didOpen reaches `next`.
 */
export function guardMiddleware(
  guard: NestedRootGuard,
  middleware: Middleware,
  open?: OpenDocuments,
): Middleware {
  const hooks = middleware as unknown as Record<string, Hook | undefined>;
  const guarded: Middleware = {
    ...middleware,
    handleDiagnostics: (uri, diagnostics, next) => {
      if (guard.excludes(uri)) {
        return;
      }
      const inner = middleware.handleDiagnostics;
      if (inner) {
        inner(uri, diagnostics, next);
      } else {
        next(uri, diagnostics);
      }
    },
    workspace: {
      ...middleware.workspace,
      didChangeWatchedFile: (event, next) => {
        if (guard.excludes(Uri.parse(event.uri))) {
          return Promise.resolve();
        }
        const inner = middleware.workspace?.didChangeWatchedFile;
        return inner ? inner(event, next) : next(event);
      },
    },
  };
  for (const name of PROVIDER_HOOKS) {
    Object.assign(guarded, {
      [name]: providerHook(guard, hooks[name]),
    });
  }
  for (const name of SYNC_HOOKS) {
    Object.assign(guarded, {
      [name]: syncHook(guard, name, hooks[name], open),
    });
  }
  return guarded;
}

/** The live nested roots a client's guard reads, and the change event that says when they moved. */
export interface NestedRootSource {
  readonly roots: () => readonly Uri[];
  readonly onDidChange: Event<void>;
}

/**
 * One client's guard and open-document record. When a root declared later excludes an open document, `release` is
 * called for it after it leaves the open set; `dispose` stops listening.
 */
export class ClientNestedRoots {
  readonly guard: NestedRootGuard;
  readonly openDocuments = new OpenDocuments();
  private readonly subscription: Disposable;

  constructor(
    root: Uri,
    source: NestedRootSource,
    release: (uri: Uri) => void,
  ) {
    this.guard = new NestedRootGuard(root, source.roots);
    this.subscription = source.onDidChange(() =>
      releaseNewlyExcluded(this.guard, this.openDocuments, release),
    );
  }

  dispose(): void {
    this.subscription.dispose();
  }
}

function releaseNewlyExcluded(
  guard: NestedRootGuard,
  open: OpenDocuments,
  release: (uri: Uri) => void,
): void {
  for (const uri of open.uris) {
    if (guard.excludes(uri)) {
      open.closed(uri);
      release(uri);
    }
  }
}
