import {
  CommandProcessExecutionFactory,
  DBTCommand,
  DBTCommandFactory,
  DBTTerminal,
  DeferConfig,
  ManifestPathType,
} from "@altimateai/dbt-integration";
import { describe, expect, it, jest } from "@jest/globals";
import {
  ConfiguredFusionCommandProjectIntegration,
  createFusionCommandIntegrationFactory,
} from "../../dbt_client/configuredFusionCommandIntegration";
import { FusionExecutable } from "../../fusion/fusionExecutable";

function mockTerminal(): DBTTerminal {
  return {
    debug: () => undefined,
    log: () => undefined,
    error: () => undefined,
    warn: () => undefined,
    info: () => undefined,
    trace: () => undefined,
    show: () => Promise.resolve(),
  } as unknown as DBTTerminal;
}

function setupIntegration(
  deferConfig: DeferConfig = DeferConfig.createFusionDefaults(),
): {
  integration: ConfiguredFusionCommandProjectIntegration;
  dbtCommandFactory: DBTCommandFactory;
  createCommandProcessExecution: jest.Mock;
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

  const factory = createFusionCommandIntegrationFactory(
    commandProcessExecutionFactory,
    dbtCommandFactory,
    mockTerminal(),
  );
  const integration = factory(
    executable,
    "/project/root",
    [],
    deferConfig,
    () => undefined,
  ) as ConfiguredFusionCommandProjectIntegration;

  return { integration, dbtCommandFactory, createCommandProcessExecution };
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

  it("does not add --defer, --state, or --favor-state even when a state directory is configured", async () => {
    // The published integration's defer/--state/--favor-state argument construction
    // (dbtCoreIntegration.ts's getDeferParams) is implemented only for dbt Core.
    // DBTFusionCommandProjectIntegration has no override and inherits the base class's
    // trivial version, which only ever emits "--no-defer" or nothing. manifestPathForDeferral
    // and ManifestPathType are therefore inert for Fusion: 7.7's defer feature does not
    // reach the CLI at all beyond suppressing --no-defer.
    const deferConfig = new DeferConfig(
      true,
      true,
      "/tmp/some-state-dir",
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

    expect(commandString).not.toContain("--defer");
    expect(commandString).not.toContain("--state");
    expect(commandString).not.toContain("--favor-state");
    expect(commandString).not.toContain("--no-defer");
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
