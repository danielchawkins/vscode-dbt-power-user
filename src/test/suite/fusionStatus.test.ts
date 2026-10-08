import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  commands,
  EventEmitter,
  languages,
  LanguageStatusItem,
  LanguageStatusSeverity,
  Uri,
  WorkspaceFolder,
} from "vscode";
import { LspLaunch } from "../../core/lsp";
import { StaticAnalysisMode } from "../../core/project";
import {
  FusionClient,
  FusionClientState,
} from "../../fusion/fusionLanguageClient";
import { FusionClientPool } from "../../projects/fusionClientPool";
import {
  clientSeverity,
  clientText,
  failureSummary,
  FusionStatus,
  optInLines,
  ProjectOptIns,
} from "../../projects/fusionStatus";
import { DeclaredProject } from "../../projects/projectRegistry";
import { createMockLogOutputChannel } from "../mock/vscode";
import { declaredProject } from "../projectHarness";
const folder: WorkspaceFolder = {
  uri: Uri.file("/workspace"),
  name: "workspace",
  index: 0,
};

const makeProject = (name: string, rootPath: string) =>
  declaredProject(name, rootPath, folder);

class FakeClient implements FusionClient {
  private readonly stateEmitter = new EventEmitter<FusionClientState>();
  private _state: FusionClientState;

  readonly outputChannel = createMockLogOutputChannel(
    "Fusion Power User: general",
  );
  failureReason: string | undefined;

  constructor(
    readonly project: DeclaredProject,
    state: FusionClientState = "running",
    readonly staticAnalysis: StaticAnalysisMode = "baseline",
    failureReason?: string,
  ) {
    this._state = state;
    this.failureReason = failureReason;
  }

  get state(): FusionClientState {
    return this._state;
  }

  get onDidChangeState() {
    return this.stateEmitter.event;
  }

  setState(state: FusionClientState): void {
    this._state = state;
    this.stateEmitter.fire(state);
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
  }
}

describe("fusionStatus helpers", () => {
  it("labels each client state without the static suffix", () => {
    expect(clientText("running")).toBe("$(check) dbt Fusion");
    expect(clientText("starting")).toBe("$(sync~spin) dbt Fusion starting");
    expect(clientText("restarting")).toBe("$(sync~spin) dbt Fusion restarting");
    expect(clientText("failed")).toBe("$(error) dbt Fusion");
    expect(clientText("stopped")).toBe("$(debug-disconnect) dbt Fusion");
  });

  it("maps failed to Error, stopped to Warning, and the rest to Information", () => {
    expect(clientSeverity("failed")).toBe(LanguageStatusSeverity.Error);
    expect(clientSeverity("stopped")).toBe(LanguageStatusSeverity.Warning);
    for (const state of ["starting", "restarting", "running"] as const) {
      expect(clientSeverity(state)).toBe(LanguageStatusSeverity.Information);
    }
  });

  it("summarizes multiline failures to one capped line", () => {
    const summary = failureSummary(
      "$(error) line one\n$(sync~spin) second line with more detail",
    );
    expect(summary).toBe("line one");
  });

  it("lists nothing when both opt-ins are in place", () => {
    expect(
      optInLines({ strict: true, schemaOrigin: { kind: "local" } }, "project"),
    ).toEqual([]);
    expect(
      optInLines({ strict: false, schemaOrigin: { kind: "local" } }, "strict"),
    ).toEqual([]);
    expect(optInLines(undefined, "project")).toEqual([]);
  });

  it("pairs each missing opt-in with its command", () => {
    const lines = optInLines(
      { strict: false, schemaOrigin: { kind: "noHook" } },
      "project",
    );
    expect(lines.map((line) => line.command?.command)).toEqual([
      "fusionPowerUser.useStrictAnalysis",
      "fusionPowerUser.addSchemaOriginHook",
    ]);
    expect(lines[0].text).toContain("has no +static_analysis: strict");
    expect(lines.every((line) => !line.text.includes("command:"))).toBe(true);
  });

  it("names an explicit setting that overrides the project", () => {
    const [line] = optInLines(
      { strict: true, schemaOrigin: { kind: "local" } },
      "off",
    );
    expect(line.text).toContain('is "off", which overrides the project');
    expect(line.command?.command).toBe("fusionPowerUser.useStrictAnalysis");
  });

  it("names the folder the fix changes when it declares several projects", () => {
    const optIns = { strict: false, schemaOrigin: { kind: "local" } } as const;
    const [many] = optInLines(optIns, "project", {
      name: "general",
      projects: 3,
    });
    expect(many.text).toContain("Fusion's default (baseline) applies.");
    expect(many.text).toContain(
      "This sets fusionPowerUser.staticAnalysis for the folder general, which applies to its 3 projects.",
    );
    const [one] = optInLines(optIns, "project", {
      name: "general",
      projects: 1,
    });
    expect(one.text).not.toContain("This sets");
  });

  it("counts untyped sources, with no command", () => {
    const [untyped] = optInLines(
      {
        strict: true,
        schemaOrigin: {
          kind: "untypedSources",
          missing: [
            { source: "raw", table: "a", column: "x" },
            { source: "raw", table: "b" },
          ],
        },
      },
      "project",
    );
    expect(untyped.text).toMatch(/^2 source column/);
    expect(untyped.command).toBeUndefined();
  });
});

describe("FusionStatus", () => {
  let projects: DeclaredProject[];
  let clients: Map<string, FusionClient>;
  let launches: Map<string, Partial<LspLaunch>>;
  let poolChanged: EventEmitter<void>;
  let optIns: ProjectOptIns | undefined;
  let optInsChanged: EventEmitter<void>;
  let projectError: string | undefined;

  beforeEach(() => {
    projects = [];
    clients = new Map();
    launches = new Map();
    poolChanged = new EventEmitter<void>();
    optIns = undefined;
    projectError = undefined;
    optInsChanged = new EventEmitter<void>();
    vi.mocked(languages.createLanguageStatusItem).mockClear();
    vi.mocked(commands.registerCommand).mockClear();
  });

  afterEach(() => {
    poolChanged.dispose();
    optInsChanged.dispose();
  });

  function createStatus(): FusionStatus {
    const clientPool = {
      get: (project: DeclaredProject) => clients.get(project.root.fsPath),
      getLaunch: (project: DeclaredProject) =>
        launches.get(project.root.fsPath) as LspLaunch | undefined,
      onDidChangeClients: poolChanged.event,
    } as unknown as FusionClientPool;
    return new FusionStatus(
      { projects },
      clientPool,
      () => optIns,
      optInsChanged.event,
      () => ({ error: projectError }),
    );
  }

  function items(): LanguageStatusItem[] {
    return vi
      .mocked(languages.createLanguageStatusItem)
      .mock.results.map((result) => result.value as LanguageStatusItem);
  }

  function item(
    kind: "client" | "static" | "target",
    project: DeclaredProject,
  ) {
    const calls = vi.mocked(languages.createLanguageStatusItem).mock.calls;
    const all = items();
    for (let index = calls.length - 1; index >= 0; index--) {
      const [id, selector] = calls[index];
      if (
        id.startsWith(`fusionPowerUser.status.${kind}.`) &&
        JSON.stringify(selector).includes(project.root.fsPath)
      ) {
        return all[index];
      }
    }
    return undefined;
  }

  function add(project: DeclaredProject, client: FusionClient): void {
    projects.push(project);
    clients.set(project.root.fsPath, client);
  }

  it("keeps the text short and carries a running project's configuration error in the detail", () => {
    const general = makeProject("general", "/workspace/general");
    add(general, new FakeClient(general));
    const status = createStatus();
    status.initialize();
    const clientItem = item("client", general)!;
    expect(clientItem.text).toBe("$(check) dbt Fusion");

    const message = `[InvalidConfig (dbt1005)]: ${"x".repeat(400)}`;
    projectError = message;
    optInsChanged.fire();
    expect(clientItem.text).toBe("$(error) dbt Fusion");
    expect(clientItem.severity).toBe(LanguageStatusSeverity.Error);
    expect(clientItem.detail).toBe(`general: ${message}`);

    projectError = undefined;
    optInsChanged.fire();
    expect(clientItem.text).toBe("$(check) dbt Fusion");
    expect(clientItem.detail).toBe("general");
    status.dispose();
  });

  it("creates no items for a project without a client", () => {
    projects.push(makeProject("general", "/workspace/general"));
    const status = createStatus();
    status.initialize();
    expect(languages.createLanguageStatusItem).not.toHaveBeenCalled();
    status.dispose();
  });

  it("creates items scoped to each project's documents when its client is added", () => {
    const general = makeProject("general", "/workspace/general");
    const sox = makeProject("sox", "/workspace/sox");
    add(general, new FakeClient(general));
    const status = createStatus();
    status.initialize();
    expect(items()).toHaveLength(2);

    add(sox, new FakeClient(sox, "starting"));
    poolChanged.fire();
    expect(items()).toHaveLength(4);

    const selector = vi.mocked(languages.createLanguageStatusItem).mock
      .calls[0][1] as { language: string; pattern: { base: unknown } }[];
    expect(selector.map((filter) => filter.language)).toEqual([
      "jinja-sql",
      "sql",
      "yaml",
    ]);
    expect(selector[0].pattern.base).toBe(general.root);
    expect(item("client", sox)?.text).toBe("$(sync~spin) dbt Fusion starting");
    status.dispose();
  });

  it("disposes a project's items when its client is removed", () => {
    const general = makeProject("general", "/workspace/general");
    add(general, new FakeClient(general));
    launches.set(general.root.fsPath, { target: "dev" });
    const status = createStatus();
    status.initialize();
    const created = items();
    expect(created).toHaveLength(3);

    clients.delete(general.root.fsPath);
    poolChanged.fire();
    for (const created_ of created) {
      expect(created_.dispose).toHaveBeenCalled();
    }
    status.dispose();
  });

  it("maps client state to text, severity, busy, and detail", () => {
    const general = makeProject("general", "/workspace/general");
    const client = new FakeClient(general, "starting");
    add(general, client);
    const status = createStatus();
    status.initialize();
    const clientItem = item("client", general)!;
    expect(clientItem.name).toBe("dbt Fusion (general)");
    expect(item("static", general)!.name).toBe("Static analysis (general)");
    expect(clientItem.busy).toBe(true);
    expect(clientItem.detail).toBe("general");

    client.setState("running");
    expect(clientItem.text).toBe("$(check) dbt Fusion");
    expect(clientItem.busy).toBe(false);
    expect(clientItem.severity).toBe(LanguageStatusSeverity.Information);

    client.failureReason = "Fusion executable not found\nmore";
    client.setState("failed");
    expect(clientItem.severity).toBe(LanguageStatusSeverity.Error);
    expect(clientItem.detail).toBe("general: Fusion executable not found");

    client.setState("stopped");
    expect(clientItem.severity).toBe(LanguageStatusSeverity.Warning);
    status.dispose();
  });

  it("opens the project's output channel from the client item", () => {
    const general = makeProject("general", "/workspace/general");
    const client = new FakeClient(general);
    add(general, client);
    const status = createStatus();
    status.initialize();
    const command = item("client", general)!.command!;
    expect(command.command).toBe("fusionPowerUser.showFusionOutput");
    expect(command.arguments).toEqual([general.root]);

    const [, handler] = vi
      .mocked(commands.registerCommand)
      .mock.calls.find(([id]) => id === command.command)!;
    handler(general.root.fsPath);
    expect(client.outputChannel.show).not.toHaveBeenCalled();
    handler(...(command.arguments ?? []));
    expect(client.outputChannel.show).toHaveBeenCalledWith(true);
    status.dispose();
  });

  it("shows the effective static analysis mode under the project setting", () => {
    const general = makeProject("general", "/workspace/general");
    add(general, new FakeClient(general, "running", "project"));
    const status = createStatus();
    status.initialize();
    const staticItem = item("static", general)!;
    expect(staticItem.text).toBe("static: baseline (project)");

    optIns = { strict: true, schemaOrigin: { kind: "local" } };
    optInsChanged.fire();
    expect(staticItem.text).toBe("static: strict (project)");
    status.dispose();
  });

  it("follows a replacement client's state and static analysis mode", () => {
    const general = makeProject("general", "/workspace/general");
    const first = new FakeClient(general);
    add(general, first);
    const status = createStatus();
    status.initialize();
    expect(item("static", general)!.text).toBe("static: baseline");

    const replacement = new FakeClient(general, "running", "strict");
    clients.set(general.root.fsPath, replacement);
    poolChanged.fire();
    expect(items()).toHaveLength(2);
    expect(item("static", general)!.text).toBe("static: strict");

    first.setState("failed");
    expect(item("client", general)!.text).toBe("$(check) dbt Fusion");
    replacement.setState("restarting");
    expect(item("client", general)!.busy).toBe(true);
    status.dispose();
  });

  it("offers the first missing opt-in's command on the static item", () => {
    const general = makeProject("general", "/workspace/general");
    add(general, new FakeClient(general, "running", "project"));
    optIns = { strict: false, schemaOrigin: { kind: "noHook" } };
    const status = createStatus();
    status.initialize();
    const staticItem = item("static", general)!;
    expect(staticItem.command).toEqual({
      title: "Use strict analysis",
      command: "fusionPowerUser.useStrictAnalysis",
      arguments: [general.root],
    });
    expect(staticItem.detail).toMatch(
      /^general · fusionPowerUser.staticAnalysis is "project" and dbt_project.yml has no/,
    );

    optIns = { strict: true, schemaOrigin: { kind: "noHook" } };
    optInsChanged.fire();
    expect(staticItem.command?.command).toBe(
      "fusionPowerUser.addSchemaOriginHook",
    );

    optIns = { strict: true, schemaOrigin: { kind: "local" } };
    optInsChanged.fire();
    expect(staticItem.command).toBeUndefined();
    expect(staticItem.detail).toBe("general");
    status.dispose();
  });

  it("shows the launch target, and no target item when it is unknown", () => {
    const general = makeProject("general", "/workspace/general");
    add(general, new FakeClient(general));
    const status = createStatus();
    status.initialize();
    expect(item("target", general)).toBeUndefined();

    launches.set(general.root.fsPath, { target: "prod" });
    poolChanged.fire();
    const targetItem = item("target", general)!;
    expect(targetItem.text).toBe("target: prod");
    expect(targetItem.name).toBe("Target (general)");
    expect(targetItem.detail).toBe("general");

    launches.delete(general.root.fsPath);
    poolChanged.fire();
    expect(targetItem.dispose).toHaveBeenCalled();
    status.dispose();
  });
});
