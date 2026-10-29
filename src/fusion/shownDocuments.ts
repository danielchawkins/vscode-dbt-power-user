import type { Disposable, TextDocument, Uri } from "vscode";
import { TabInputText, TabInputTextDiff, window } from "vscode";
import type { Middleware } from "vscode-languageclient/node";
import { disposeAll } from "../core/disposables";

/** Whether `uri` is shown: open in an editor tab, as a diff's modified side, or in a visible editor such as a peek. */
function shownInEditor(uri: Uri): boolean {
  const key = uri.toString();
  const inTab = window.tabGroups.all.some((group) =>
    group.tabs.some(({ input }) => {
      const shown =
        input instanceof TabInputText
          ? input.uri
          : input instanceof TabInputTextDiff
            ? input.modified
            : undefined;
      return shown?.toString() === key;
    }),
  );
  return (
    inTab ||
    window.visibleTextEditors.some(
      (editor) => editor.document.uri.toString() === key,
    )
  );
}

function onDidChangeShownInEditor(listener: () => void): Disposable {
  const subscriptions = [
    window.tabGroups.onDidChangeTabs(listener),
    window.onDidChangeVisibleTextEditors(listener),
  ];
  return { dispose: () => disposeAll(subscriptions) };
}

/** What the gate reads from the workbench; tests replace both. */
export interface ShownDocumentsDependencies {
  isShown?: (uri: Uri) => boolean;
  onDidChangeShown?: (listener: () => void) => Disposable;
}

type Next<T> = (data: T) => Promise<void>;
type Hook<T> = ((data: T, next: Next<T>) => Promise<void>) | undefined;

const forward = <T>(inner: Hook<T>, data: T, next: Next<T>) =>
  inner ? inner(data, next) : next(data);

/**
 * Holds a document's `didOpen` until the document is shown in an editor, so documents VS Code loads without one (an
 * agent's edits, a search, another extension) do not each start a compile on the server. A client's first document
 * is never held, since the server compiles nothing before it. A held document that closes is dropped, and change,
 * save and close notifications reach the server only for documents it has opened.
 */
export class ShownDocuments implements Disposable {
  private readonly opened = new Set<string>();
  private readonly held = new Map<
    string,
    { uri: Uri; open: () => Promise<void> }
  >();
  private readonly isShown: (uri: Uri) => boolean;
  private readonly subscription: Disposable;

  constructor(deps: ShownDocumentsDependencies = {}) {
    this.isShown = deps.isShown ?? shownInEditor;
    this.subscription = (deps.onDidChangeShown ?? onDidChangeShownInEditor)(
      () => void this.openShown(),
    );
  }

  /** The documents whose open is held until they are shown. */
  get heldDocuments(): readonly Uri[] {
    return Array.from(this.held.values(), ({ uri }) => uri);
  }

  /** `middleware` with its document sync hooks behind the gate. */
  wrap(middleware: Middleware): Middleware {
    return {
      ...middleware,
      didOpen: async (document, next) => {
        const key = document.uri.toString();
        const open = async () => {
          this.held.delete(key);
          this.opened.add(key);
          await forward(middleware.didOpen, document, next);
        };
        if (this.opened.size === 0 || this.isShown(document.uri)) {
          await open();
        } else {
          this.held.set(key, { uri: document.uri, open });
        }
      },
      didChange: async (event, next) => {
        if (this.isOpen(event.document)) {
          await forward(middleware.didChange, event, next);
        }
      },
      didSave: async (document, next) => {
        if (this.isOpen(document)) {
          await forward(middleware.didSave, document, next);
        }
      },
      didClose: async (document, next) => {
        const key = document.uri.toString();
        this.held.delete(key);
        if (this.opened.delete(key)) {
          await forward(middleware.didClose, document, next);
        }
      },
    };
  }

  /** Forgets every document, for a new server that VS Code opens its documents with again. */
  clear(): void {
    this.opened.clear();
    this.held.clear();
  }

  dispose(): void {
    this.subscription.dispose();
    this.clear();
  }

  private isOpen(document: TextDocument): boolean {
    return this.opened.has(document.uri.toString());
  }

  private async openShown(): Promise<void> {
    const shown = [...this.held.values()].filter(({ uri }) =>
      this.isShown(uri),
    );
    for (const { open } of shown) {
      await open();
    }
  }
}
