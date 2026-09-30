import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { commands, extensions, Uri, workspace } from "vscode";
import { VSCodeCommands } from "../../features/commands";
import { DiagnosticsOutputChannel } from "../../features/diagnostics/diagnosticsOutputChannel";

describe("fusionPowerUser.diagnostics", () => {
  let diagnosticsHandler: (() => Promise<void>) | undefined;
  let logLine: jest.Mock;
  let diagnosticsOutputChannel: DiagnosticsOutputChannel;
  let initialize: () => void;

  beforeEach(() => {
    jest.clearAllMocks();
    const initialized = new Promise<void>((resolve) => (initialize = resolve));
    logLine = jest.fn();
    diagnosticsOutputChannel = {
      show: jest.fn(),
      logLine,
      logNewLine: jest.fn(),
      logBlock: jest.fn(),
      logBlockWithHeader: jest.fn(),
      logHorizontalRule: jest.fn(),
    } as unknown as DiagnosticsOutputChannel;

    (workspace as any).workspaceFolders = [
      { uri: Uri.file("/workspace"), name: "workspace", index: 0 },
    ];
    (extensions.getExtension as jest.Mock).mockReturnValue({
      packageJSON: { version: "0.2.0" },
    });
    (workspace.getConfiguration as jest.Mock).mockReturnValue({
      inspect: jest.fn(() => ({
        globalValue: {},
        defaultValue: {},
        workspaceValue: {},
      })),
      get: jest.fn(),
    });

    const failedProject = {
      getProjectName: () => "failed-project",
      getAdapterType: () => "unknown",
      getFusionVersion: () => undefined,
      getTargetPath: () => undefined,
      getDBTProjectFilePath: () => "/failed/dbt_project.yml",
      getPackageInstallPath: () => undefined,
      getModelPaths: () => [],
      getSeedPaths: () => [],
      getMacroPaths: () => [],
      getAllDiagnostic: () => [
        {
          message: "Configured dbt executable not found at /missing/dbt",
          source: "fusion-executable",
        },
      ],
      debug: jest.fn(() => Promise.resolve()),
    };
    const healthyProject = {
      getProjectName: () => "healthy-project",
      getAdapterType: () => "snowflake",
      getFusionVersion: () => ({
        major: 2,
        minor: 0,
        patch: 6,
        raw: "dbt 2.0.6-preview.3 (a1b2c3d 2026-09-01)\n",
      }),
      getTargetPath: () => "/healthy/target",
      getDBTProjectFilePath: () => "/healthy/dbt_project.yml",
      getPackageInstallPath: () => "/healthy/dbt_packages",
      getModelPaths: () => ["/healthy/models"],
      getSeedPaths: () => [],
      getMacroPaths: () => [],
      getAllDiagnostic: () => [],
      debug: jest.fn(() => Promise.resolve()),
    };

    new VSCodeCommands(
      {
        all: () => [failedProject, healthyProject],
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { error: jest.fn(), debug: jest.fn() } as never,
      diagnosticsOutputChannel,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { whenSettled: () => initialized },
    );

    const registration = (
      commands.registerCommand as jest.Mock
    ).mock.calls.find(([command]) => command === "fusionPowerUser.diagnostics");
    diagnosticsHandler = registration?.[1] as () => Promise<void>;
  });

  afterEach(() => {
    diagnosticsHandler = undefined;
    (workspace as any).workspaceFolders = [];
  });

  it("waits for extension startup to settle before running", async () => {
    const run = diagnosticsHandler!();
    await new Promise((resolve) => setImmediate(resolve));
    expect(diagnosticsOutputChannel.show).not.toHaveBeenCalled();

    initialize();
    await run;
    expect(diagnosticsOutputChannel.show).toHaveBeenCalled();
  });

  it("enumerates every project without a global installed gate", async () => {
    expect(diagnosticsHandler).toBeDefined();
    initialize();
    await diagnosticsHandler!();

    const lines = logLine.mock.calls.map(([line]) => String(line));
    expect(lines).not.toContain("DBT is not installed");
    expect(lines).not.toContain(
      "Can't proceed further without fixing dbt installation",
    );
    expect(lines).toContain("Number of projects=2");
    expect(lines).toContain("Printing information for failed-project");
    expect(lines).toContain(
      "Configured dbt executable not found at /missing/dbt",
    );
    expect(lines).toContain("Printing information for healthy-project");
    expect(lines).toContain("Fusion is not initialized properly");
    expect(lines).toContain(
      "Fusion version=dbt 2.0.6-preview.3 (a1b2c3d 2026-09-01)",
    );
    expect(lines).toContain("Diagnostics completed successfully...");
  });
});
