import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { mkdtempSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { Uri, workspace } from "vscode";
import { CliCommand, PathProbe, toCliArgs } from "../../core/cli";
import {
  DeferSettingsEntry,
  ProjectSnapshot,
  resolveProjectSnapshot,
} from "../../core/project";
import {
  ConfiguredFusionCommandProjectIntegration,
  createFusionCommandIntegrationFactory,
} from "../../dbt_client/configuredFusionCommandIntegration";
import {
  CommandProcessExecutionFactory,
  DBTCommand,
  DBTCommandFactory,
  DBTTerminal,
  DeferConfig,
  ManifestPathType,
} from "../../dbt_integration";
import { PROFILES_DIR_SETTING } from "../../lsp/fusionClientSettings";
import { noSettings, snapshotFolder } from "../arbitraries/projectSnapshot";

const PARAMS = {
  run: ["--threads", "4"],
  build: ["--fail-fast"],
  test: ["--indirect-selection", "cautious"],
};

const diskProbe: PathProbe = (p) => {
  try {
    const stats = statSync(p);
    return stats.isDirectory()
      ? "directory"
      : stats.isFile()
        ? "file"
        : "missing";
  } catch {
    return "missing";
  }
};

interface Legacy {
  integration: ConfiguredFusionCommandProjectIntegration;
  factory: DBTCommandFactory;
  /** The argv of every spawned process, oldest first. */
  spawns: () => string[][];
}

function legacy(deferConfig: DeferConfig): Legacy {
  const spawn = jest.fn((_options: { args: string[] }) => ({
    complete: () => Promise.resolve({ stdout: "", stderr: "", fullOutput: "" }),
    completeWithTerminalOutput: () =>
      Promise.resolve({ stdout: "", stderr: "", fullOutput: "" }),
  }));
  const factory = new DBTCommandFactory({
    getRunModelCommandAdditionalParams: () => PARAMS.run,
    getBuildModelCommandAdditionalParams: () => PARAMS.build,
    getTestModelCommandAdditionalParams: () => PARAMS.test,
  } as unknown as ConstructorParameters<typeof DBTCommandFactory>[0]);
  const integration = createFusionCommandIntegrationFactory(
    {
      createCommandProcessExecution: spawn,
    } as unknown as CommandProcessExecutionFactory,
    factory,
    {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
      show: jest.fn(() => Promise.resolve()),
    } as unknown as DBTTerminal,
  )(
    {
      path: "/bin/dbt",
      version: { major: 2, minor: 0, patch: 6, raw: "" },
      env: {},
    },
    "/project/root",
    [],
    deferConfig,
    () => undefined,
  ) as ConfiguredFusionCommandProjectIntegration;
  return {
    integration,
    factory,
    spawns: () => spawn.mock.calls.map(([options]) => options.args),
  };
}

/** Runs a legacy call and returns the argv it spawned, ignoring the parse failure of the empty stdout. */
async function spawned(
  l: Legacy,
  call: () => Promise<unknown>,
): Promise<string[]> {
  const before = l.spawns().length;
  await call().catch(() => undefined);
  const spawns = l.spawns();
  expect(spawns).toHaveLength(before + 1);
  return spawns[before];
}

const queued = async (command: Promise<DBTCommand | undefined>) =>
  (await command)!.args;

/** The legacy argv of every kind, with the payload the new command must carry. */
function legacyCases(
  l: Legacy,
): [string, CliCommand, () => Promise<string[]>][] {
  const { integration: i, factory: f } = l;
  const model = {
    plusOperatorLeft: "+",
    modelName: "a",
    plusOperatorRight: "",
  };
  return [
    [
      "run",
      { kind: "run", select: "+a" },
      () => queued(i.runModel(f.createRunModelCommand(model))),
    ],
    [
      "build model",
      { kind: "build", select: "+a" },
      () => queued(i.buildModel(f.createBuildModelCommand(model))),
    ],
    [
      "build project",
      { kind: "build" },
      () => queued(i.buildProject(f.createBuildProjectCommand())),
    ],
    [
      "test",
      { kind: "test", select: "a" },
      () => queued(i.runTest(f.createTestModelCommand("a"))),
    ],
    [
      "compile",
      { kind: "compile", select: "+a" },
      () => queued(i.compileModel(f.createCompileModelCommand(model))),
    ],
    [
      "compileNode",
      { kind: "compileNode", node: "a" },
      () => spawned(l, () => i.unsafeCompileNode("a")),
    ],
    [
      "compileInline json",
      { kind: "compileInline", sql: "select 1", output: "json" },
      () => spawned(l, () => i.unsafeCompileQuery("select 1")),
    ],
    [
      "show preview",
      { kind: "show", sql: "select 1", limit: 500, output: "preview" },
      () =>
        spawned(l, async () =>
          (await i.executeSQL("select 1", 500, "a")).executeQuery(),
        ),
    ],
    [
      "show lineage",
      { kind: "show", sql: "select 1", limit: -1, output: "lineage" },
      () => spawned(l, () => i.showColumnLineage("select 1")),
    ],
    [
      "compileColumnLineage",
      { kind: "compileColumnLineage", select: ["a", "b+"] },
      () => spawned(l, () => i.compileColumnLineage(["a", "b+"], {})),
    ],
    [
      "deps",
      { kind: "deps" },
      () => spawned(l, () => i.deps(f.createInstallDepsCommand())),
    ],
    [
      "clean",
      { kind: "clean" },
      () => spawned(l, () => i.clean(f.createCleanCommand())),
    ],
    [
      "debug",
      { kind: "debug" },
      () => spawned(l, () => i.debug(f.createDebugCommand())),
    ],
  ];
}

/** Drops `--project-dir`, which the legacy integration sets through the working directory instead. */
function withoutProjectDir(args: string[]): string[] {
  const at = args.indexOf("--project-dir");
  return at < 0 ? args : [...args.slice(0, at), ...args.slice(at + 2)];
}

describe("toCliArgs gives the argv the legacy integration builds, per kind", () => {
  let stateDir: string;

  beforeAll(() => {
    stateDir = mkdtempSync(path.join(tmpdir(), "fusion-parity-"));
    (workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((key: string) =>
        key === PROFILES_DIR_SETTING ? "/p" : undefined,
      ),
      has: jest.fn(),
      update: jest.fn(),
    });
    (workspace as any).workspaceFolders = [
      { uri: Uri.file("/project/root"), name: "root", index: 0 },
    ];
  });

  afterAll(() => {
    rmSync(stateDir, { recursive: true, force: true });
    (workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn(),
      has: jest.fn(),
      update: jest.fn(),
    });
    (workspace as any).workspaceFolders = [];
  });

  function snapshot(defer: DeferSettingsEntry | undefined): ProjectSnapshot {
    return resolveProjectSnapshot({
      root: path.join(snapshotFolder, "proj"),
      folder: snapshotFolder,
      firstWorkspaceFolder: snapshotFolder,
      userHome: "/home/u",
      environment: {},
      lspCompiledOutputOverride: undefined,
      settings: {
        ...noSettings,
        profilesDir: "/p",
        runParams: PARAMS.run,
        buildParams: PARAMS.build,
        testParams: PARAMS.test,
        deferPerProject: defer && { proj: defer },
      },
      projectFile: { kind: "parsed", text: "", config: { name: "proj" } },
    });
  }

  const configs: [
    string,
    () => [DeferConfig, DeferSettingsEntry | undefined],
  ][] = [
    ["defer off", () => [DeferConfig.createFusionDefaults(), undefined]],
    [
      "defer on",
      () => [
        new DeferConfig(true, true, stateDir, ManifestPathType.LOCAL),
        {
          deferToProduction: true,
          favorState: true,
          manifestPathForDeferral: stateDir,
        },
      ],
    ],
    [
      "defer at a missing path",
      () => [
        new DeferConfig(
          true,
          false,
          path.join(stateDir, "missing"),
          ManifestPathType.LOCAL,
        ),
        {
          deferToProduction: true,
          favorState: false,
          manifestPathForDeferral: path.join(stateDir, "missing"),
        },
      ],
    ],
  ];

  it.each(configs)("%s", async (_name, config) => {
    const [deferConfig, entry] = config();
    const l = legacy(deferConfig);
    const s = snapshot(entry);
    for (const [kind, command, build] of legacyCases(l)) {
      expect({
        kind,
        args: withoutProjectDir(toCliArgs(s, command, diskProbe)),
      }).toEqual({
        kind,
        args: await build(),
      });
    }
  });

  it("differs only in flag order on parse, where the legacy integration appends --log-format last", async () => {
    const l = legacy(DeferConfig.createFusionDefaults());
    const legacyArgs = await spawned(l, () => l.integration.rebuildManifest());
    expect(legacyArgs).toEqual([
      "parse",
      "--profiles-dir",
      "/p",
      "--log-format",
      "json",
    ]);
    expect(
      withoutProjectDir(
        toCliArgs(snapshot(undefined), { kind: "parse" }, diskProbe),
      ),
    ).toEqual(["parse", "--log-format", "json", "--profiles-dir", "/p"]);
  });
});
