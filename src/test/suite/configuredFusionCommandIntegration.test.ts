import {
  CommandProcessExecutionFactory,
  DBTCommand,
  DBTCommandFactory,
  DBTTerminal,
  DeferConfig,
  ManifestPathType,
} from "@altimateai/dbt-integration";
import { describe, expect, it, jest } from "@jest/globals";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Uri, workspace } from "vscode";
import {
  ConfiguredFusionCommandProjectIntegration,
  createFusionCommandIntegrationFactory,
} from "../../dbt_client/configuredFusionCommandIntegration";
import { FusionExecutable } from "../../fusion/fusionExecutable";
import { PROFILES_DIR_SETTING } from "../../lsp/fusionClientSettings";

function mockTerminal(): jest.Mocked<DBTTerminal> {
  return {
    debug: jest.fn(),
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    trace: jest.fn(),
    show: jest.fn(() => Promise.resolve()),
  } as unknown as jest.Mocked<DBTTerminal>;
}

function setupIntegration(
  deferConfig: DeferConfig = DeferConfig.createFusionDefaults(),
): {
  integration: ConfiguredFusionCommandProjectIntegration;
  dbtCommandFactory: DBTCommandFactory;
  createCommandProcessExecution: jest.Mock;
  terminal: jest.Mocked<DBTTerminal>;
} {
  const executable: FusionExecutable = {
    path: "/resolved/bin/dbt",
    version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5\n" },
    env: { PATH: "/resolved/bin", DBT_ENV: "1" },
  };
  const createCommandProcessExecution = jest.fn().mockReturnValue({
    complete: jest.fn(() =>
      Promise.resolve({ stdout: "", stderr: "", fullOutput: "" }),
    ),
    completeWithTerminalOutput: jest.fn(() =>
      Promise.resolve({ stdout: "", stderr: "", fullOutput: "" }),
    ),
  });
  const commandProcessExecutionFactory = {
    createCommandProcessExecution,
  } as unknown as CommandProcessExecutionFactory;
  const dbtCommandFactory = new DBTCommandFactory({
    getRunModelCommandAdditionalParams: () => [],
    getBuildModelCommandAdditionalParams: () => [],
    getTestModelCommandAdditionalParams: () => [],
  } as unknown as ConstructorParameters<typeof DBTCommandFactory>[0]);

  const terminal = mockTerminal();
  const factory = createFusionCommandIntegrationFactory(
    commandProcessExecutionFactory,
    dbtCommandFactory,
    terminal,
  );
  const integration = factory(
    executable,
    "/project/root",
    [],
    deferConfig,
    () => undefined,
  ) as ConfiguredFusionCommandProjectIntegration;

  return {
    integration,
    dbtCommandFactory,
    createCommandProcessExecution,
    terminal,
  };
}

describe("Fusion CLI executable routing", () => {
  it("spawns compile through the resolved Fusion executable and env, matching the LSP resolution", async () => {
    const { integration, dbtCommandFactory, createCommandProcessExecution } =
      setupIntegration();
    await integration.initializeProject();

    const compileCommand = dbtCommandFactory.createCompileModelCommand({
      plusOperatorLeft: "",
      modelName: "my_model",
      plusOperatorRight: "",
    });
    await integration.compileModel(compileCommand);
    await compileCommand.execute();

    expect(createCommandProcessExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "/resolved/bin/dbt",
        envVars: { PATH: "/resolved/bin", DBT_ENV: "1" },
      }),
    );
  });

  it("forwards an abort signal to the spawned command process", async () => {
    const { integration, dbtCommandFactory, createCommandProcessExecution } =
      setupIntegration();
    await integration.initializeProject();

    const buildCommand = dbtCommandFactory.createBuildProjectCommand();
    await integration.buildProject(buildCommand);
    const controller = new AbortController();
    await buildCommand.execute(controller.signal);

    expect(createCommandProcessExecution).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});

describe("Fusion defer argument construction", () => {
  it("adds --no-defer when defer to production is disabled", async () => {
    const { integration, dbtCommandFactory } = setupIntegration(
      DeferConfig.createFusionDefaults(),
    );
    await integration.initializeProject();

    const runCommand = dbtCommandFactory.createRunModelCommand({
      plusOperatorLeft: "",
      modelName: "my_model",
      plusOperatorRight: "",
    });
    const command = (await integration.runModel(runCommand)) as DBTCommand;

    expect(command.getCommandAsString()).toContain("--no-defer");
  });

  it("adds --defer, --state, and --favor-state for a configured local state directory", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "fusion-defer-"));
    try {
      const deferConfig = new DeferConfig(
        true,
        true,
        stateDir,
        ManifestPathType.LOCAL,
      );
      const { integration, dbtCommandFactory } = setupIntegration(deferConfig);
      await integration.initializeProject();

      const runCommand = dbtCommandFactory.createRunModelCommand({
        plusOperatorLeft: "",
        modelName: "my_model",
        plusOperatorRight: "",
      });
      const command = (await integration.runModel(runCommand)) as DBTCommand;
      const commandString = command.getCommandAsString();

      expect(commandString).toContain(`--defer --state ${stateDir}`);
      expect(commandString).toContain("--favor-state");
      expect(commandString).not.toContain("--no-defer");
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("omits --favor-state when it is not set", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "fusion-defer-"));
    try {
      const deferConfig = new DeferConfig(
        true,
        false,
        stateDir,
        ManifestPathType.LOCAL,
      );
      const { integration, dbtCommandFactory } = setupIntegration(deferConfig);
      await integration.initializeProject();

      const runCommand = dbtCommandFactory.createRunModelCommand({
        plusOperatorLeft: "",
        modelName: "my_model",
        plusOperatorRight: "",
      });
      const command = (await integration.runModel(runCommand)) as DBTCommand;
      const commandString = command.getCommandAsString();

      expect(commandString).toContain(`--defer --state ${stateDir}`);
      expect(commandString).not.toContain("--favor-state");
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("adds nothing when defer is enabled but no state path is configured", async () => {
    const deferConfig = new DeferConfig(true, true, undefined, undefined);
    const { integration, dbtCommandFactory } = setupIntegration(deferConfig);
    await integration.initializeProject();

    const runCommand = dbtCommandFactory.createRunModelCommand({
      plusOperatorLeft: "",
      modelName: "my_model",
      plusOperatorRight: "",
    });
    const command = (await integration.runModel(runCommand)) as DBTCommand;
    const commandString = command.getCommandAsString();

    expect(commandString).not.toContain("--defer");
    expect(commandString).not.toContain("--state");
    expect(commandString).not.toContain("--favor-state");
    expect(commandString).not.toContain("--no-defer");
  });

  it("accepts a manifest.json file path and uses its containing directory", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "fusion-defer-"));
    try {
      const manifestPath = join(stateDir, "manifest.json");
      writeFileSync(manifestPath, "{}");
      const deferConfig = new DeferConfig(
        true,
        false,
        manifestPath,
        ManifestPathType.LOCAL,
      );
      const { integration, dbtCommandFactory } = setupIntegration(deferConfig);
      await integration.initializeProject();

      const runCommand = dbtCommandFactory.createRunModelCommand({
        plusOperatorLeft: "",
        modelName: "my_model",
        plusOperatorRight: "",
      });
      const command = (await integration.runModel(runCommand)) as DBTCommand;

      expect(command.getCommandAsString()).toContain(
        `--defer --state ${stateDir}`,
      );
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("warns and adds nothing when the configured path does not exist", async () => {
    const missingPath = join(tmpdir(), "fusion-defer-missing-path-xyz");
    const deferConfig = new DeferConfig(
      true,
      true,
      missingPath,
      ManifestPathType.LOCAL,
    );
    const { integration, dbtCommandFactory, terminal } =
      setupIntegration(deferConfig);
    await integration.initializeProject();

    const runCommand = dbtCommandFactory.createRunModelCommand({
      plusOperatorLeft: "",
      modelName: "my_model",
      plusOperatorRight: "",
    });
    const command = (await integration.runModel(runCommand)) as DBTCommand;
    const commandString = command.getCommandAsString();

    expect(commandString).not.toContain("--defer");
    expect(commandString).not.toContain("--state");
    expect(commandString).not.toContain("--favor-state");
    expect(terminal.warn).toHaveBeenCalledWith(
      "deferMissingManifestPath",
      expect.stringContaining("fusionPowerUser.defer.perProject"),
      false,
    );
    expect(terminal.warn).toHaveBeenCalledWith(
      "deferMissingManifestPath",
      expect.stringContaining(missingPath),
      false,
    );
  });

  it("warns and adds nothing when the configured path is a file other than manifest.json", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "fusion-defer-"));
    try {
      const notManifest = join(stateDir, "notes.txt");
      writeFileSync(notManifest, "hello");
      const deferConfig = new DeferConfig(
        true,
        true,
        notManifest,
        ManifestPathType.LOCAL,
      );
      const { integration, dbtCommandFactory, terminal } =
        setupIntegration(deferConfig);
      await integration.initializeProject();

      const runCommand = dbtCommandFactory.createRunModelCommand({
        plusOperatorLeft: "",
        modelName: "my_model",
        plusOperatorRight: "",
      });
      const command = (await integration.runModel(runCommand)) as DBTCommand;

      expect(command.getCommandAsString()).not.toContain("--defer");
      expect(terminal.warn).toHaveBeenCalledWith(
        "deferMissingManifestPath",
        expect.stringContaining(notManifest),
        false,
      );
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("adds defer arguments to a compileModel command", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "fusion-defer-"));
    try {
      const deferConfig = new DeferConfig(
        true,
        true,
        stateDir,
        ManifestPathType.LOCAL,
      );
      const { integration, dbtCommandFactory } = setupIntegration(deferConfig);
      await integration.initializeProject();

      const compileCommand = dbtCommandFactory.createCompileModelCommand({
        plusOperatorLeft: "",
        modelName: "my_model",
        plusOperatorRight: "",
      });
      const command = (await integration.compileModel(
        compileCommand,
      )) as DBTCommand;

      expect(command.getCommandAsString()).toContain(
        `--defer --state ${stateDir}`,
      );
      expect(command.getCommandAsString()).toContain("--favor-state");
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("does not apply defer arguments to installDeps or clean commands", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "fusion-defer-"));
    try {
      const deferConfig = new DeferConfig(
        true,
        true,
        stateDir,
        ManifestPathType.LOCAL,
      );
      const { integration, dbtCommandFactory, createCommandProcessExecution } =
        setupIntegration(deferConfig);
      await integration.initializeProject();

      const depsCommand = dbtCommandFactory.createInstallDepsCommand();
      await integration.deps(depsCommand);
      const cleanCommand = dbtCommandFactory.createCleanCommand();
      await integration.clean(cleanCommand);

      for (const call of createCommandProcessExecution.mock.calls) {
        const args = (call[0] as { args: string[] }).args;
        expect(args).not.toContain("--defer");
      }
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});

describe("Fusion CLI profiles directory argument", () => {
  function configureProfilesDir(
    configured: string | undefined,
    folder: string | undefined = "/project/root",
  ): void {
    (workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((key: string) =>
        key === PROFILES_DIR_SETTING ? configured : undefined,
      ),
      has: jest.fn(),
      update: jest.fn(),
    });
    (workspace as any).workspaceFolders = folder
      ? [{ uri: Uri.file(folder), name: "root", index: 0 }]
      : [];
  }

  async function runModelCommandString(
    configured: string | undefined,
  ): Promise<string> {
    configureProfilesDir(configured);
    const { integration, dbtCommandFactory } = setupIntegration();
    await integration.initializeProject();

    const command = (await integration.runModel(
      dbtCommandFactory.createRunModelCommand({
        plusOperatorLeft: "",
        modelName: "my_model",
        plusOperatorRight: "",
      }),
    )) as DBTCommand;
    return command.getCommandAsString();
  }

  afterEach(() => {
    (workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn(),
      has: jest.fn(),
      update: jest.fn(),
    });
    (workspace as any).workspaceFolders = [];
  });

  it("passes the configured profiles directory so the CLI matches the language server", async () => {
    expect(await runModelCommandString("/configured/profiles")).toContain(
      "--profiles-dir /configured/profiles",
    );
  });

  it("passes nothing when unset, leaving dbt's own cascade to resolve profiles.yml", async () => {
    expect(await runModelCommandString(undefined)).not.toContain(
      "--profiles-dir",
    );
  });

  it("resolves a folder-relative setting against the project's workspace folder", async () => {
    expect(await runModelCommandString("profiles")).toContain(
      `--profiles-dir ${join("/project/root", "profiles")}`,
    );
  });

  it("adds the argument once when a command already carries it", async () => {
    configureProfilesDir("/configured/profiles");
    const { integration } = setupIntegration();
    await integration.initializeProject();

    const preset = new DBTCommand("Running dbt run...", [
      "run",
      "--profiles-dir",
      "/already/set",
    ]);
    const command = (await integration.runModel(preset)) as DBTCommand;
    const occurrences = command.args.filter(
      (arg) => arg === "--profiles-dir",
    ).length;

    expect(occurrences).toBe(1);
    expect(command.getCommandAsString()).toContain(
      "--profiles-dir /already/set",
    );
  });
});

describe("Fusion CLI process execution (real subprocess)", () => {
  function setupRealIntegration(): {
    integration: ConfiguredFusionCommandProjectIntegration;
    logs: string[];
  } {
    const executable: FusionExecutable = {
      // Runs node itself as the "Fusion binary" so the real, unmocked
      // CommandProcessExecutionFactory spawns a real, controllable process.
      path: process.execPath,
      version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5\n" },
      env: process.env as Record<string, string>,
    };
    const logs: string[] = [];
    const terminal = {
      ...mockTerminal(),
      log: (text: string) => {
        logs.push(text);
      },
    } as unknown as DBTTerminal;
    const commandProcessExecutionFactory = new CommandProcessExecutionFactory(
      terminal,
    );
    const dbtCommandFactory = new DBTCommandFactory({
      getRunModelCommandAdditionalParams: () => [],
      getBuildModelCommandAdditionalParams: () => [],
      getTestModelCommandAdditionalParams: () => [],
    } as unknown as ConstructorParameters<typeof DBTCommandFactory>[0]);
    const factory = createFusionCommandIntegrationFactory(
      commandProcessExecutionFactory,
      dbtCommandFactory,
      terminal,
    );
    const integration = factory(
      executable,
      process.cwd(),
      [],
      DeferConfig.createFusionDefaults(),
      () => undefined,
    ) as ConfiguredFusionCommandProjectIntegration;
    return { integration, logs };
  }

  it("streams command stdout to the terminal (7.3: output reaches the terminal)", async () => {
    const { integration, logs } = setupRealIntegration();
    await integration.initializeProject();

    const command = new DBTCommand(
      "Test",
      ["-e", "console.log('fusion-output-marker')"],
      false,
      false,
      true,
    );
    await integration.executeCommandImmediately(command);

    expect(logs.join("")).toContain("fusion-output-marker");
  });

  it("terminates the spawned process when its abort signal fires", async () => {
    // Proves the SIGTERM link is real: the published CommandProcessExecution.spawn()
    // kills the child on abort. This is the library's behavior, not this extension's.
    const { integration } = setupRealIntegration();
    await integration.initializeProject();

    const command = new DBTCommand(
      "Long-running",
      [
        "-e",
        "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);",
      ],
      false,
      false,
      false,
    );
    const controller = new AbortController();
    command.setSignal(controller.signal);

    const resultPromise = integration.executeCommandImmediately(command);
    await new Promise((resolve) => setTimeout(resolve, 200));
    controller.abort();

    // If SIGTERM never reached the process, this would hang until the test's own timeout.
    await resultPromise;
  }, 10000);
});
