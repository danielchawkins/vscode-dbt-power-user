import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import {
  EventEmitter,
  StatusBarAlignment,
  Uri,
  window,
  WorkspaceFolder,
} from "vscode";
import {
  createStaticAnalysisSelection,
  StaticAnalysisSelection,
} from "../../fusion/staticAnalysisMode";
import { FusionClientPool } from "../../lsp/fusionClientPool";
import {
  FusionClient,
  FusionClientState,
  fusionOutputChannelName,
} from "../../lsp/fusionLanguageClient";
import {
  buildTooltip,
  failureSummary,
  FusionStatus,
  statusText,
} from "../../lsp/fusionStatus";
import { ProjectContext } from "../../projects/projectContext";
import { DeclaredProject } from "../../projects/projectRegistry";
import { createMockLogOutputChannel } from "../mock/vscode";

const folder: WorkspaceFolder = {
  uri: Uri.file("/workspace"),
  name: "workspace",
  index: 0,
};

function makeProject(name: string, rootPath: string): DeclaredProject {
  return {
    root: Uri.file(rootPath),
    name,
    folder,
    contains: () => false,
    dispose: () => {},
  };
}

class FakeClient implements FusionClient {
  private readonly stateEmitter = new EventEmitter<FusionClientState>();
  private readonly analysisEmitter =
    new EventEmitter<StaticAnalysisSelection>();
  private _state: FusionClientState;
  private _analysis: StaticAnalysisSelection;

  readonly outputChannel = createMockLogOutputChannel(
    "dbt Fusion LSP (general · abc)",
  ) as FusionClient["outputChannel"];
  readonly failureReason: string | undefined;

  constructor(
    readonly project: DeclaredProject,
    state: FusionClientState = "running",
    analysis: StaticAnalysisSelection = createStaticAnalysisSelection(
      "baseline",
    ),
    failureReason?: string,
  ) {
    this._state = state;
    this._analysis = analysis;
    this.failureReason = failureReason;
  }

  get state(): FusionClientState {
    return this._state;
  }

  get staticAnalysis(): StaticAnalysisSelection {
    return this._analysis;
  }

  get onDidChangeState() {
    return this.stateEmitter.event;
  }

  get onDidChangeStaticAnalysis() {
    return this.analysisEmitter.event;
  }

  setState(state: FusionClientState): void {
    this._state = state;
    this.stateEmitter.fire(state);
  }

  setAnalysis(analysis: StaticAnalysisSelection): void {
    this._analysis = analysis;
    this.analysisEmitter.fire(analysis);
  }

  request<T>(): Promise<T> {
    return Promise.reject(new Error("not implemented"));
  }

  restart(): Promise<void> {
    return Promise.resolve();
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }

  dispose(): void {
    this.stateEmitter.dispose();
    this.analysisEmitter.dispose();
  }
}

describe("fusionStatus helpers", () => {
  it("shows static analysis in status text, never configured", () => {
    expect(statusText("running", "static: unknown")).toBe(
      "$(check) dbt Fusion · static: unknown",
    );
    expect(statusText("failed", "static: unknown")).toContain("$(error)");
    expect(statusText("starting", "static: unknown")).toContain(
      "dbt Fusion starting",
    );
    expect(statusText("restarting", "static: unknown")).toContain(
      "dbt Fusion restarting",
    );
  });

  it("labels configured mode only in the tooltip", () => {
    const project = makeProject("general", "/workspace/general");
    const client = new FakeClient(
      project,
      "running",
      createStaticAnalysisSelection("strict"),
    );
    const tooltip = buildTooltip(project, client).value;
    expect(tooltip).toContain("Effective static analysis: unknown");
    expect(tooltip).toContain("Configured static analysis: strict");
    expect(tooltip).not.toContain("fallback");
    expect(tooltip).not.toContain("login");
  });

  it("caps failed tooltip summaries and points to the output channel", () => {
    const project = makeProject("general", "/workspace/general");
    const client = new FakeClient(
      project,
      "failed",
      createStaticAnalysisSelection("baseline"),
      "Fusion executable not found",
    );
    const tooltip = buildTooltip(project, client);
    expect(tooltip.value).toContain("Failure: Fusion executable not found");
    expect(tooltip.value).toContain("See the output channel for full logs");
    expect(tooltip.value).toContain(client.outputChannel.name);
    expect(tooltip.supportHtml).toBe(false);
  });

  it("summarizes multiline failures to one capped line", () => {
    const summary = failureSummary(
      "$(error) line one\n$(sync~spin) second line with more detail",
    );
    expect(summary).toBe("line one");
  });
});

describe("FusionStatus", () => {
  let statusBar: {
    text: string;
    tooltip: unknown;
    show: jest.Mock;
    hide: jest.Mock;
    dispose: jest.Mock;
  };
  let currentProject: DeclaredProject | undefined;
  let clients: Map<string, FusionClient>;
  let poolListeners: Array<() => void>;
  let contextListeners: Array<() => void>;

  beforeEach(() => {
    statusBar = {
      text: "",
      tooltip: undefined,
      show: jest.fn(),
      hide: jest.fn(),
      dispose: jest.fn(),
    };
    currentProject = undefined;
    clients = new Map();
    poolListeners = [];
    contextListeners = [];

    jest.spyOn(window, "createStatusBarItem").mockReturnValue(statusBar as any);
  });

  afterEach(() => {
    jest.mocked(window.createStatusBarItem).mockRestore();
  });

  function createStatus(): FusionStatus {
    const projectContext = {
      get current() {
        return currentProject;
      },
      onDidChangeCurrent: (listener: () => void) => {
        contextListeners.push(listener);
        return { dispose: () => {} };
      },
    } as ProjectContext;

    const clientPool = {
      get: (project: DeclaredProject) => clients.get(project.root.fsPath),
      onDidChangeClients: (listener: () => void) => {
        poolListeners.push(listener);
        return { dispose: () => {} };
      },
    } as FusionClientPool;

    return new FusionStatus(projectContext, clientPool);
  }

  it("hides when there is no current project or client", () => {
    const status = createStatus();
    status.initialize();
    expect(statusBar.hide).toHaveBeenCalled();

    const project = makeProject("general", "/workspace/general");
    currentProject = project;
    contextListeners.forEach((listener) => listener());
    expect(statusBar.hide).toHaveBeenCalledTimes(2);

    status.dispose();
  });

  it("reflects client state and disambiguates duplicate project names", () => {
    const generalA = makeProject("general", "/workspace/a");
    const generalB = makeProject("general", "/workspace/b");
    const clientA = new FakeClient(generalA, "running");
    Object.defineProperty(clientA.outputChannel, "name", {
      value: fusionOutputChannelName(generalA),
    });
    const clientB = new FakeClient(generalB, "starting");
    Object.defineProperty(clientB.outputChannel, "name", {
      value: fusionOutputChannelName(generalB),
    });

    clients.set(generalA.root.fsPath, clientA);
    clients.set(generalB.root.fsPath, clientB);

    const status = createStatus();
    currentProject = generalA;
    status.initialize();
    expect(statusBar.text).toBe("$(check) dbt Fusion · static: unknown");
    expect((statusBar.tooltip as { value: string }).value).toContain(
      fusionOutputChannelName(generalA),
    );

    currentProject = generalB;
    contextListeners.forEach((listener) => listener());
    expect(statusBar.text).toContain("dbt Fusion starting");
    expect((statusBar.tooltip as { value: string }).value).toContain(
      fusionOutputChannelName(generalB),
    );

    status.dispose();
  });

  it("rewires listeners when the current project changes and disposes stale subscriptions", () => {
    const general = makeProject("general", "/workspace/general");
    const sox = makeProject("sox", "/workspace/sox");
    const generalClient = new FakeClient(general, "running");
    const soxClient = new FakeClient(sox, "failed", undefined, "boom");
    clients.set(general.root.fsPath, generalClient);
    clients.set(sox.root.fsPath, soxClient);

    const status = createStatus();
    currentProject = general;
    status.initialize();

    generalClient.setState("restarting");
    expect(statusBar.text).toContain("dbt Fusion restarting");

    currentProject = sox;
    contextListeners.forEach((listener) => listener());
    expect(statusBar.text).toContain("$(error)");

    soxClient.setState("running");
    expect(statusBar.text).toContain("$(check)");

    status.dispose();
  });

  it("updates when the pool replaces a client for the current project", () => {
    const project = makeProject("general", "/workspace/general");
    const first = new FakeClient(project, "running");
    clients.set(project.root.fsPath, first);

    const status = createStatus();
    currentProject = project;
    status.initialize();

    const replacement = new FakeClient(project, "failed", undefined, "stopped");
    clients.set(project.root.fsPath, replacement);
    poolListeners.forEach((listener) => listener());

    expect(statusBar.text).toContain("$(error)");
    status.dispose();
  });

  it("creates the status bar on the left", () => {
    const status = createStatus();
    status.initialize();
    expect(window.createStatusBarItem).toHaveBeenCalledWith(
      StatusBarAlignment.Left,
      10,
    );
    status.dispose();
  });
});
