import { jest } from "@jest/globals";
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
  file: jest.fn((f: string) => {
    const cached = uriCache.get(f);
    if (cached) {
      return cached;
    }
    const uri = createUri(f);
    uriCache.set(f, uri);
    return uri;
  }),
  parse: jest.fn(),
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
  constructor(value?: string, _supportThemeIcons?: boolean) {
    if (value) {
      this.value = value;
    }
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
  getExtension: jest.fn(),
  all: [],
};

export const env = { uriScheme: "vscode" };
export const version = "1.125.0";

export const commands = {
  registerCommand: jest.fn().mockReturnValue({ dispose: jest.fn() }),
  registerTextEditorCommand: jest.fn().mockReturnValue({ dispose: jest.fn() }),
  getCommands: jest.fn().mockReturnValue(Promise.resolve([])),
  executeCommand: jest.fn().mockReturnValue(Promise.resolve()),
};

let mockLogOutputChannelCounter = 0;

const mockDisposable = { dispose: jest.fn() };
const mockRegisterProvider = jest.fn(() => mockDisposable);

export function createMockLogOutputChannel(name?: string): LogOutputChannel {
  const channelName =
    name ?? `Log - mock-${(mockLogOutputChannelCounter += 1)}`;
  return {
    name: channelName,
    append: jest.fn(),
    appendLine: jest.fn(),
    clear: jest.fn(),
    show: jest.fn(),
    hide: jest.fn(),
    dispose: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    trace: jest.fn(),
    replace: jest.fn(),
    logLevel: LogLevel.Info,
    onDidChangeLogLevel: jest
      .fn()
      .mockReturnValue({ dispose: jest.fn() } as { dispose: () => void }),
  } as LogOutputChannel;
}

export const window = {
  showInformationMessage: jest.fn().mockReturnValue(Promise.resolve()),
  showWarningMessage: jest.fn().mockReturnValue(Promise.resolve()),
  showErrorMessage: jest.fn().mockReturnValue(Promise.resolve()),
  showQuickPick: jest.fn().mockReturnValue(Promise.resolve(undefined)),
  onDidChangeActiveTextEditor: jest
    .fn()
    .mockReturnValue({ dispose: jest.fn() }),
  onDidChangeActiveColorTheme: jest
    .fn()
    .mockReturnValue({ dispose: jest.fn() }),
  onDidChangeTextEditorSelection: jest
    .fn()
    .mockReturnValue({ dispose: jest.fn() }),
  onDidChangeVisibleTextEditors: jest
    .fn()
    .mockReturnValue({ dispose: jest.fn() }),
  activeTextEditor: undefined as any,
  visibleTextEditors: [] as unknown[],
  activeColorTheme: { kind: ColorThemeKind.Dark },
  createStatusBarItem: jest.fn().mockReturnValue({
    text: "",
    tooltip: undefined,
    show: jest.fn(),
    hide: jest.fn(),
    dispose: jest.fn(),
  }),
  createOutputChannel: jest.fn((name?: string, _options?: { log?: boolean }) =>
    createMockLogOutputChannel(name),
  ),
  registerWebviewViewProvider: mockRegisterProvider,
  registerTreeDataProvider: mockRegisterProvider,
  createTextEditorDecorationType: jest.fn(() => mockDisposable),
  createTerminal: jest.fn().mockReturnValue({
    sendText: jest.fn(),
    show: jest.fn(),
    hide: jest.fn(),
    dispose: jest.fn(),
  }),
  withProgress: jest
    .fn()
    .mockImplementation((_options: any, task: any) => task()),
  registerUriHandler: jest.fn().mockReturnValue({ dispose: jest.fn() }),
};

export const workspace = {
  getConfiguration: jest.fn().mockReturnValue({
    get: jest.fn(),
    has: jest.fn(),
    update: jest.fn(),
  }),
  workspaceFolders: [],
  getWorkspaceFolder: jest.fn((uri: typeof Uri) => {
    if (workspace.workspaceFolders && workspace.workspaceFolders.length > 0) {
      return workspace.workspaceFolders[0];
    }
    return undefined;
  }),
  onDidChangeConfiguration: jest.fn().mockReturnValue({ dispose: jest.fn() }),
  onDidChangeTextDocument: jest.fn().mockReturnValue({ dispose: jest.fn() }),
  onDidChangeWorkspaceFolders: jest
    .fn()
    .mockReturnValue({ dispose: jest.fn() }),
  createFileSystemWatcher: jest.fn().mockReturnValue({
    onDidChange: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    onDidCreate: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    onDidDelete: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    dispose: jest.fn(),
  }),
  findFiles: jest.fn(() => Promise.resolve([])),
  registerTextDocumentContentProvider: mockRegisterProvider,
} as any;

export const languages = {
  createDiagnosticCollection: jest.fn().mockReturnValue({
    set: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
    dispose: jest.fn(),
    [Symbol.iterator]: function* () {
      yield* new Map();
    },
    entries: function* () {
      yield* new Map();
    },
    forEach: function (
      callback: (uri: typeof Uri, diagnostics: any[]) => void,
    ) {
      // Mock implementation that does nothing by default
    },
  }),
  registerCodeLensProvider: mockRegisterProvider,
  registerCompletionItemProvider: mockRegisterProvider,
  registerHoverProvider: mockRegisterProvider,
  registerDefinitionProvider: mockRegisterProvider,
  registerDocumentFormattingEditProvider: mockRegisterProvider,
  setTextDocumentLanguage: jest.fn(() => Promise.resolve(undefined)),
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

export const RelativePattern = jest.fn((base: unknown, pattern: string) => ({
  base,
  pattern,
}));
export const ViewColumn = {};
export const Disposable = Object.assign(jest.fn(), { from: jest.fn() });
export const Event = jest.fn();

export const CancellationTokenSource = jest.fn().mockImplementation(() => ({
  token: {
    onCancellationRequested: jest.fn(),
    isCancellationRequested: false,
  },
  cancel: jest.fn(),
  dispose: jest.fn(),
}));

export const CancellationToken = {
  None: {
    onCancellationRequested: jest.fn(),
    isCancellationRequested: false,
  },
};

export const ThemeIcon = jest.fn().mockImplementation((...args: unknown[]) => ({
  id: args[0],
  color: args[1],
}));

export const ThemeColor = jest
  .fn()
  .mockImplementation((...args: unknown[]) => ({ id: args[0] }));

export const resetMocks = () => {
  jest.clearAllMocks();
};
