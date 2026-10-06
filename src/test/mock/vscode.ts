import { type Mock, vi } from "vitest";
import type { LogOutputChannel } from "vscode";

// Export VSCode types that were previously defined
export const ExtensionKind = {
  UI: 1,
  Workspace: 2,
};

const uriCache = new Map<string, ReturnType<typeof createUri>>();

function createUri(f: string) {
  return {
    fsPath: f,
    path: f,
    scheme: "file",
    toString: () => (f.startsWith("file://") ? f : `file://${f}`),
  };
}

export const Uri = {
  file: vi.fn((f: string) => {
    const cached = uriCache.get(f);
    if (cached) {
      return cached;
    }
    const uri = createUri(f);
    uriCache.set(f, uri);
    return uri;
  }),
  parse: vi.fn(),
  joinPath: vi.fn((base: { path: string }, ...segments: string[]) =>
    createUri([base.path, ...segments].join("/")),
  ),
};

export class Position {
  constructor(
    public line: number,
    public character: number,
  ) {}

  // Add common Position methods for compatibility
  isEqual(other: Position): boolean {
    return this.line === other.line && this.character === other.character;
  }

  isBefore(other: Position): boolean {
    return (
      this.line < other.line ||
      (this.line === other.line && this.character < other.character)
    );
  }

  isAfter(other: Position): boolean {
    return (
      this.line > other.line ||
      (this.line === other.line && this.character > other.character)
    );
  }

  isBeforeOrEqual(other: Position): boolean {
    return this.isBefore(other) || this.isEqual(other);
  }

  isAfterOrEqual(other: Position): boolean {
    return this.isAfter(other) || this.isEqual(other);
  }
}

export class Range {
  public start: Position;
  public end: Position;

  constructor(start: Position, end: Position) {
    this.start = start;
    this.end = end;
  }
}

export class WorkspaceEdit {
  readonly replacements: { uri: unknown; range: Range; newText: string }[] = [];
  readonly createdFiles: {
    uri: unknown;
    options?: { contents?: Uint8Array };
  }[] = [];

  replace(uri: unknown, range: Range, newText: string): void {
    this.replacements.push({ uri, range, newText });
  }

  createFile(uri: unknown, options?: { contents?: Uint8Array }): void {
    this.createdFiles.push({ uri, options });
  }
}

/** A one-line `TextDocument` holding `text`, for `workspace.openTextDocument` to resolve. */
export function createMockTextDocument(text: string, isDirty = false) {
  return {
    isDirty,
    getText: vi.fn(() => text),
    positionAt: (offset: number) => new Position(0, offset),
    save: vi.fn(() => Promise.resolve(true)),
  };
}

export class Location {
  public range: Range | Position;
  constructor(
    public uri: typeof Uri | any,
    rangeOrPosition: Range | Position,
  ) {
    this.range = rangeOrPosition;
  }
}

export class CodeLens {
  constructor(
    public range: Range,
    public command?: {
      title: string;
      command: string;
      tooltip?: string;
      arguments?: any[];
    },
  ) {}
}

export const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3,
};

export const ColorThemeKind = {
  Light: 1,
  Dark: 2,
  HighContrast: 3,
  HighContrastLight: 4,
};

export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
};

export const CompletionItemKind = {
  Text: 0,
  Method: 1,
  Function: 2,
  Constructor: 3,
  Field: 4,
  Variable: 5,
  Class: 6,
  Interface: 7,
  Module: 8,
  Property: 9,
  Unit: 10,
  Value: 11,
  Enum: 12,
  Keyword: 13,
  Snippet: 14,
  Color: 15,
  File: 16,
  Reference: 17,
  Folder: 18,
  EnumMember: 19,
  Constant: 20,
  Struct: 21,
  Event: 22,
  Operator: 23,
  TypeParameter: 24,
};

export class CompletionItem {
  constructor(
    public label: string,
    public kind?: number,
  ) {}
}

export const QuickPickItemKind = {
  Separator: -1,
  Default: 0,
};

export const StatusBarAlignment = {
  Left: 1,
  Right: 2,
};

/** Matches `@types/vscode` LogLevel ordering (Info = 3). */
export const LogLevel = {
  Off: 0,
  Trace: 1,
  Debug: 2,
  Info: 3,
  Warning: 4,
  Error: 5,
} as const;

export const OverviewRulerLane = {
  Left: 1,
  Center: 2,
  Right: 4,
  Full: 7,
};

export class MarkdownString {
  public value = "";
  public isTrusted = false;
  public supportHtml = false;
  public supportThemeIcons = false;

  constructor(value?: string, _supportThemeIcons?: boolean) {
    if (value) {
      this.value = value;
    }
  }

  appendMarkdown(value: string): this {
    this.value += value;
    return this;
  }

  appendText(value: string): this {
    this.value += value;
    return this;
  }
}

export class Hover {
  constructor(
    public contents: MarkdownString | string,
    public range?: Range,
  ) {}
}

export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
};

export const TreeItem = class {
  constructor(
    public label?: string,
    public collapsibleState?: number,
  ) {}
};

export const Diagnostic = class {
  constructor(
    public range: any,
    public message: string,
    public severity?: number,
  ) {}
};

export class TextEdit {
  constructor(
    public range: Range,
    public newText: string,
  ) {}

  static insert(position: Position, newText: string): TextEdit {
    return new TextEdit(new Range(position, position), newText);
  }

  static replace(range: Range, newText: string): TextEdit {
    return new TextEdit(range, newText);
  }

  static delete(range: Range): TextEdit {
    return new TextEdit(range, "");
  }
}

// Mock VSCode API
export const extensions = {
  getExtension: vi.fn(),
  all: [],
};

export const env = { uriScheme: "vscode" };
export const version = "1.125.0";

export const commands = {
  registerCommand: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  registerTextEditorCommand: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  getCommands: vi.fn().mockReturnValue(Promise.resolve([])),
  executeCommand: vi.fn().mockReturnValue(Promise.resolve()),
};

let mockLogOutputChannelCounter = 0;

const mockDisposable = { dispose: vi.fn() };
const mockRegisterProvider = vi.fn(() => mockDisposable);

export function createMockLogOutputChannel(name?: string): LogOutputChannel {
  const channelName =
    name ?? `mock-channel-${(mockLogOutputChannelCounter += 1)}`;
  return {
    name: channelName,
    append: vi.fn(),
    appendLine: vi.fn(),
    clear: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    replace: vi.fn(),
    logLevel: LogLevel.Info,
    onDidChangeLogLevel: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  };
}

export const window = {
  showInformationMessage: vi.fn().mockReturnValue(Promise.resolve()),
  showWarningMessage: vi.fn().mockReturnValue(Promise.resolve()),
  showErrorMessage: vi.fn().mockReturnValue(Promise.resolve()),
  showQuickPick: vi.fn().mockReturnValue(Promise.resolve(undefined)),
  showSaveDialog: vi.fn(() => Promise.resolve(undefined)),
  showOpenDialog: vi.fn(() => Promise.resolve(undefined)),
  onDidChangeActiveTextEditor: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  onDidChangeActiveColorTheme: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  onDidChangeTextEditorSelection: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  onDidChangeVisibleTextEditors: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  activeTextEditor: undefined as any,
  visibleTextEditors: [] as unknown[],
  activeColorTheme: { kind: ColorThemeKind.Dark },
  createStatusBarItem: vi.fn().mockReturnValue({
    text: "",
    tooltip: undefined,
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  }),
  createOutputChannel: vi.fn((name?: string, _options?: { log?: boolean }) =>
    createMockLogOutputChannel(name),
  ),
  registerWebviewViewProvider: mockRegisterProvider,
  registerTreeDataProvider: mockRegisterProvider,
  createTreeView: vi.fn(() => ({
    visible: false,
    onDidChangeVisibility: vi.fn(() => mockDisposable),
    dispose: vi.fn(),
  })),
  createTextEditorDecorationType: vi.fn(() => mockDisposable),
  createTerminal: vi.fn().mockReturnValue({
    sendText: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  }),
  withProgress: vi
    .fn()
    .mockImplementation((_options: any, task: any) => task()),
  registerUriHandler: vi.fn().mockReturnValue({ dispose: vi.fn() }),
};

type MockUriListener = (uri: { fsPath: string }) => unknown;
type MockSubscribe = Mock<
  (listener: MockUriListener) => { dispose: () => void }
>;

/** A watcher from `workspace.createFileSystemWatcher` with the listeners it received. */
export interface MockFileSystemWatcher {
  pattern: unknown;
  listeners: {
    create: MockUriListener[];
    change: MockUriListener[];
    delete: MockUriListener[];
  };
  /** Delivers an event with `Uri.file(fsPath)` to every listener of that kind. */
  fire(kind: "create" | "change" | "delete", fsPath: string): void;
  onDidCreate: MockSubscribe;
  onDidChange: MockSubscribe;
  onDidDelete: MockSubscribe;
  dispose: Mock;
}

/** Watchers created through the mock, oldest first; tests clear it as needed. */
export const createdFileSystemWatchers: MockFileSystemWatcher[] = [];

function createMockFileSystemWatcher(pattern?: unknown): MockFileSystemWatcher {
  const listeners: MockFileSystemWatcher["listeners"] = {
    create: [],
    change: [],
    delete: [],
  };
  const subscribe = (kind: keyof typeof listeners) =>
    vi.fn((listener: MockUriListener) => {
      listeners[kind].push(listener);
      return {
        dispose: vi.fn(() => {
          const index = listeners[kind].indexOf(listener);
          if (index >= 0) {
            listeners[kind].splice(index, 1);
          }
        }),
      };
    });
  const watcher: MockFileSystemWatcher = {
    pattern,
    listeners,
    fire: (kind, fsPath) => {
      for (const listener of [...listeners[kind]]) {
        listener(Uri.file(fsPath));
      }
    },
    onDidCreate: subscribe("create"),
    onDidChange: subscribe("change"),
    onDidDelete: subscribe("delete"),
    dispose: vi.fn(),
  };
  createdFileSystemWatchers.push(watcher);
  return watcher;
}

export const workspace = {
  getConfiguration: vi.fn().mockReturnValue({
    get: vi.fn(),
    has: vi.fn(),
    update: vi.fn(),
  }),
  workspaceFolders: [],
  getWorkspaceFolder: vi.fn((_uri: typeof Uri) => {
    if (workspace.workspaceFolders && workspace.workspaceFolders.length > 0) {
      return workspace.workspaceFolders[0];
    }
    return undefined;
  }),
  onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  onDidChangeTextDocument: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  onDidSaveTextDocument: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  onDidOpenTextDocument: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  onDidChangeWorkspaceFolders: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  createFileSystemWatcher: vi.fn(createMockFileSystemWatcher),
  findFiles: vi.fn(() => Promise.resolve([])),
  textDocuments: [],
  applyEdit: vi.fn(() => Promise.resolve(true)),
  openTextDocument: vi.fn(),
  registerTextDocumentContentProvider: mockRegisterProvider,
} as any;

export const languages = {
  createDiagnosticCollection: vi.fn((name?: string) => {
    const entries = new Map<any, any[]>();
    return {
      name,
      set: vi.fn((uri: any, diagnostics: any[]) =>
        entries.set(uri, diagnostics),
      ),
      get: vi.fn((uri: any) => entries.get(uri)),
      delete: vi.fn((uri: any) => entries.delete(uri)),
      clear: vi.fn(() => entries.clear()),
      dispose: vi.fn(),
      [Symbol.iterator]: () => entries.entries(),
      forEach: (callback: (uri: any, diagnostics: any[]) => void) =>
        entries.forEach((diagnostics, uri) => callback(uri, diagnostics)),
    };
  }),
  registerCodeLensProvider: mockRegisterProvider,
  registerCompletionItemProvider: mockRegisterProvider,
  registerHoverProvider: mockRegisterProvider,
  registerDefinitionProvider: mockRegisterProvider,
  registerDocumentFormattingEditProvider: mockRegisterProvider,
  setTextDocumentLanguage: vi.fn(() => Promise.resolve(undefined)),
  createLanguageStatusItem: vi.fn((id: string, selector: unknown) => ({
    id,
    selector,
    name: undefined,
    severity: LanguageStatusSeverity.Information,
    text: "",
    detail: undefined,
    busy: false,
    command: undefined,
    dispose: vi.fn(),
  })),
};

export const LanguageStatusSeverity = {
  Information: 0,
  Warning: 1,
  Error: 2,
};

export class EventEmitter<T> {
  private listeners: ((e: T) => any)[] = [];

  event = (listener: (e: T) => any) => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        const index = this.listeners.indexOf(listener);
        if (index > -1) {
          this.listeners.splice(index, 1);
        }
      },
    };
  };

  fire(data: T): void {
    this.listeners.forEach((listener) => listener(data));
  }

  dispose(): void {
    this.listeners = [];
  }
}

export const ProgressLocation = {
  Notification: 15,
};

export const RelativePattern = vi.fn(function (base: unknown, pattern: string) {
  return { base, pattern };
});
export const ViewColumn = {};
export const Disposable = Object.assign(vi.fn(), {
  from: vi.fn((...disposables: { dispose: () => unknown }[]) => ({
    dispose: () => disposables.forEach((d) => d.dispose()),
  })),
});
export const Event = vi.fn();

export const CancellationTokenSource = vi.fn().mockImplementation(function () {
  const token = {
    onCancellationRequested: vi.fn(),
    isCancellationRequested: false,
  };
  return {
    token,
    cancel: vi.fn(() => {
      token.isCancellationRequested = true;
    }),
    dispose: vi.fn(),
  };
});

export const CancellationToken = {
  None: {
    onCancellationRequested: vi.fn(),
    isCancellationRequested: false,
  },
};

// Vitest mocks invoked with `new` need a `function` implementation, not an arrow.
export const ThemeIcon = vi.fn().mockImplementation(function (
  ...args: unknown[]
) {
  return { id: args[0], color: args[1] };
});

export const ThemeColor = vi.fn().mockImplementation(function (
  ...args: unknown[]
) {
  return { id: args[0] };
});

export const TaskRevealKind = { Always: 1, Silent: 2, Never: 3 };
export const TaskScope = { Global: 1, Workspace: 2 };

export class CustomExecution {
  constructor(
    readonly callback: (definition: unknown) => Promise<{
      open(): void;
      close(): void;
      onDidClose?: (listener: (code: number) => void) => unknown;
    }>,
  ) {}
}

export class Task {
  presentationOptions: Record<string, unknown> = {};
  constructor(
    readonly definition: { type: string },
    readonly scope: unknown,
    readonly name: string,
    readonly source: string,
    readonly execution?: CustomExecution,
  ) {}
}

type TaskEndListener = (event: { execution: unknown }) => void;
const taskEndListeners = new Set<TaskEndListener>();
const activeTasks = new Map<string, { task: Task }>();

/**
 * Runs a `CustomExecution` task the way VS Code does: opens its Pseudoterminal and ends when it closes. A task whose
 * definition is already active is not run; the active execution is returned.
 */
export const tasks = {
  registerTaskProvider: vi.fn(() => ({ dispose: vi.fn() })),
  get taskExecutions() {
    return [...activeTasks.values()];
  },
  onDidEndTask: vi.fn((listener: TaskEndListener) => {
    taskEndListeners.add(listener);
    return { dispose: () => taskEndListeners.delete(listener) };
  }),
  executeTask: vi.fn(async (task: Task) => {
    const key = JSON.stringify(task.definition);
    const active = activeTasks.get(key);
    if (active) {
      return active;
    }
    const execution = { task };
    activeTasks.set(key, execution);
    const terminal = await task.execution!.callback(task.definition);
    terminal.onDidClose?.(() => {
      activeTasks.delete(key);
      [...taskEndListeners].forEach((listener) => listener({ execution }));
    });
    terminal.open();
    return execution;
  }),
};

export const resetMocks = () => {
  activeTasks.clear();
  vi.clearAllMocks();
};
