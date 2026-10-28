import type { Mock } from "vitest";
import { vi } from "vitest";
import type { WebviewPanel, WebviewView } from "vscode";
import { EventEmitter, Uri } from "vscode";
import type { Log } from "../core/log";
import { ColumnProposalRequests } from "../features/docs/columnProposals";
import { DocsEditViewPanel } from "../features/docs/docsEditPanel";
import { LineagePanel } from "../features/lineage/lineagePanel";
import { QueryResultPanel } from "../features/queryResults/queryResultPanel";
import { spyLog } from "./testLog";

type Listener = (message: unknown) => unknown;
type Hook = () => unknown;

/**
 * A page a panel host can listen to: a view VS Code resolves, or a results tab. `page` is the double to hand the host;
 * `send` fires the message subscription the host made, so a test drives the same path a webview message takes.
 */
export interface FakePage<P> {
  readonly page: P;
  /** The disposable the host got for the message subscription; disposing it ends the subscription. */
  readonly messageSubscription: { dispose: Mock };
  /** Fires a message at the page's subscription; the promise settles once its handler has run. */
  send(message: unknown): Promise<unknown>;
  /** Every message the host posted to the page, in order. */
  posted(): unknown[];
  /** Hides the page as VS Code does when a view is covered; the visibility listeners run. */
  hide(): void;
  /** Shows the page again as VS Code does; the visibility listeners run. */
  show(): void;
  /** Closes the page; the dispose listeners the host registered run. */
  close(): void;
}

type Surface = {
  webview: { postMessage: Mock; onDidReceiveMessage: Mock };
  onDidDispose: Mock;
};

/** Builds a page's double. `subscribe` gets the message listener the host registers, and the hooks it fires later. */
function fakePage<P extends Surface>(
  build: (hooks: {
    message: (listener: Listener) => { dispose: Mock };
    dispose: (listener: Hook) => { dispose: Mock };
    visibility: (listener: Hook) => { dispose: Mock };
  }) => P,
  hidden?: (page: P) => void,
): FakePage<P> {
  let listener: Listener | undefined;
  const visibility: Hook[] = [];
  const disposes: Hook[] = [];
  const messageSubscription = { dispose: vi.fn() };
  const page = build({
    message: (next) => {
      listener = next;
      return messageSubscription;
    },
    dispose: (next) => {
      disposes.push(next);
      return { dispose: vi.fn() };
    },
    visibility: (next) => {
      visibility.push(next);
      return { dispose: vi.fn() };
    },
  });
  return {
    page,
    messageSubscription,
    send: async (message) => {
      if (!listener) {
        throw new Error("the host never subscribed to this page's messages");
      }
      return listener(message);
    },
    posted: () => page.webview.postMessage.mock.calls.map((call) => call[0]),
    hide: () => {
      hidden?.(page);
      visibility.forEach((listen) => listen());
    },
    show: () => {
      (page as { visible?: boolean }).visible = true;
      visibility.forEach((listen) => listen());
    },
    close: () => disposes.forEach((listen) => listen()),
  };
}

/**
 * A `WebviewView` double. `resolveWebviewView` subscribes it, as VS Code does, and `send` fires its messages.
 * Its `visible` flag is set by `hide`.
 */
export function fakeView(): FakePage<WebviewView & Surface> {
  return fakePage<WebviewView & Surface>(
    ({ message, visibility, dispose }) =>
      ({
        title: "",
        description: undefined as string | undefined,
        visible: true,
        show: vi.fn(),
        webview: {
          options: {},
          html: "",
          postMessage: vi.fn().mockResolvedValue(true),
          onDidReceiveMessage: vi.fn(message),
        },
        onDidChangeVisibility: vi.fn(visibility),
        onDidDispose: vi.fn(dispose),
      }) as unknown as WebviewView & Surface,
    (page) => {
      (page as { visible: boolean }).visible = false;
    },
  );
}

/** A results tab (a `WebviewPanel`) double, with the same subscriptions as `fakeView`. */
export function fakeTab(): FakePage<WebviewPanel & Surface> {
  return fakePage<WebviewPanel & Surface>(
    ({ message, dispose }) =>
      ({
        webview: {
          postMessage: vi.fn().mockResolvedValue(true),
          onDidReceiveMessage: vi.fn(message),
        },
        onDidDispose: vi.fn(dispose),
      }) as unknown as WebviewPanel & Surface,
  );
}

/**
 * Subscribes `page` to the host's messages as a resolve or a new results tab does, without rendering the page. Use it
 * for a tab, which the host does not resolve; a view should go through `resolveWebviewView` instead.
 */
export function listenTo(host: object, page: WebviewView | WebviewPanel): void {
  (host as { listen(page: WebviewView | WebviewPanel): void }).listen(page);
}

/** Whether the host's readiness for `page` is set, as its `whenReady` sees it; a view's readiness is the bottom page's. */
export function isPageReady(
  host: object,
  page: WebviewView | WebviewPanel,
): boolean {
  const pages = host as {
    pageOf(page: WebviewView | WebviewPanel): unknown;
    isReady(page: unknown): boolean;
  };
  return pages.isReady(pages.pageOf(page));
}

const extensionContext = { extensionUri: Uri.file("/ext") } as never;

/** A query results panel built as the extension builds it; `queryManifestService` and its inert services are the test's. */
export function queryResultPanel(
  terminal: Log = spyLog(),
  queryManifestService: unknown = {},
  currentProject: unknown = {},
): QueryResultPanel {
  return new QueryResultPanel({
    extensionContext,
    eventEmitterService: { eventEmitter: new EventEmitter<unknown>() } as never,
    log: terminal,
    queryManifestService: queryManifestService as never,
    currentProject: currentProject as never,
    onDidRemoveProject: new EventEmitter<Uri>().event,
  });
}

/**
 * A documentation editor built as the extension builds it, with inert services; `services` replaces any of them and
 * `projects` replaces the project registry.
 */
export function docsEditPanel(
  terminal: Log = spyLog(),
  services: Record<string, unknown> = {},
  projects: Record<string, unknown> = {
    onDidChangeManifest: new EventEmitter<unknown>().event,
    onDidRemoveProject: new EventEmitter<Uri>().event,
    get: () => undefined,
  },
): DocsEditViewPanel {
  return new DocsEditViewPanel({
    projects: projects as never,
    extensionContext,
    services: {
      docGenService: {
        getUncompiledDocumentationForCurrentActiveFile: vi.fn(async () => ({
          documentation: undefined,
        })),
      },
      modelTests: {
        getTestsForCurrentModel: vi.fn(async () => []),
        getUnitTestsForCurrentModel: vi.fn(async () => []),
      },
      queryManifestService: { manifestFor: () => undefined },
      sharedState: { eventEmitter: { event: vi.fn() } },
      columnProposalRequests: new ColumnProposalRequests(),
      ...services,
    } as never,
    terminal,
  });
}

/**
 * A lineage panel built as the extension builds it. The services default to inert ones; `services` replaces any.
 */
export function lineagePanel(
  terminal: Log = spyLog(),
  services: {
    extensionContext?: unknown;
    lineageService?: unknown;
    queryManifestService?: unknown;
    currentProject?: unknown;
  } = {},
): LineagePanel {
  return new LineagePanel({
    extensionContext: (services.extensionContext ?? extensionContext) as never,
    terminal,
    lineageService: (services.lineageService ?? {}) as never,
    currentProject: (services.currentProject ?? {}) as never,
    eventEmitterService: { eventEmitter: new EventEmitter<unknown>() } as never,
    queryManifestService: (services.queryManifestService ?? {}) as never,
  });
}

/**
 * Resolves `view` on `panel` as VS Code does, and when `ready` lets the page report ready as its webview does. The
 * returned `send` waits for that first, so a message never reaches the panel before its page is resolved.
 */
export function openPage(
  panel: {
    resolveWebviewView(
      view: WebviewView,
      context: unknown,
      token: unknown,
    ): unknown;
  },
  view: FakePage<WebviewView & { webview: { postMessage: Mock } }>,
  ready: boolean,
) {
  const opened = Promise.resolve(
    panel.resolveWebviewView(
      view.page,
      {},
      { onCancellationRequested: vi.fn() },
    ),
  ).then(() => (ready ? view.send({ command: "webview:ready" }) : undefined));
  return {
    page: view.page,
    fake: view,
    send: async (message: unknown) => {
      await opened;
      return view.send(message);
    },
  };
}
