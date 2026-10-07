import fc from "fast-check";
import * as path from "path";
import { relativeDir, segment, staticAnalysisMode, traceLevel } from ".";
import {
  DbtProjectFile,
  deferSettingsKey,
  ProjectSnapshotInputs,
  ProjectSnapshotSettings,
  resolveProjectSnapshot,
} from "../../core/project";

export const snapshotFolder = path.join("/", "ws");

export const noSettings: ProjectSnapshotSettings = {
  dbtPath: undefined,
  target: undefined,
  profilesDir: undefined,
  staticAnalysis: undefined,
  lspCompiledOutput: undefined,
  lintEnabled: undefined,
  traceServer: undefined,
  deferPerProject: undefined,
  runParams: [],
  buildParams: [],
  testParams: [],
};

/** Inputs for a project at `/ws/proj` with nothing configured, a `DBT_BIN` variable and no project file. */
export const baseInputs: ProjectSnapshotInputs = {
  root: path.join(snapshotFolder, "proj"),
  folder: snapshotFolder,
  firstWorkspaceFolder: path.join("/", "first"),
  userHome: path.join("/", "home", "u"),
  environment: { DBT_BIN: path.join("/", "opt", "dbt") },
  lspCompiledOutputOverride: undefined,
  settings: noSettings,
  projectFile: { kind: "missing", config: {} },
};

/** A snapshot of `baseInputs` with `settings` laid over the unset ones and `rest` over the other inputs. */
export const snapshotWith = (
  settings: Partial<ProjectSnapshotSettings> = {},
  rest: Partial<ProjectSnapshotInputs> = {},
) =>
  resolveProjectSnapshot({
    ...baseInputs,
    ...rest,
    settings: { ...noSettings, ...settings },
  });

const parsed = (config: Record<string, unknown>): DbtProjectFile => ({
  kind: "parsed",
  text: "",
  config,
});

const pathKeys = fc.record(
  {
    "model-paths": fc.array(relativeDir, { minLength: 1, maxLength: 3 }),
    "macro-paths": fc.array(relativeDir, { minLength: 1, maxLength: 2 }),
    "test-paths": fc.array(relativeDir, { minLength: 1, maxLength: 2 }),
    "target-path": relativeDir,
    "packages-install-path": relativeDir,
    name: segment,
  },
  { requiredKeys: [] },
);

/** A flag the snapshot may also derive, in each form dbt accepts: `--flag`, `--flag=value` and `-t`. */
const derivedFlag = fc.oneof(
  fc.constantFrom("--target", "--profiles-dir", "--project-dir", "-t"),
  fc
    .tuple(
      fc.constantFrom("--target", "--profiles-dir", "--project-dir", "-t"),
      segment,
    )
    .map(([flag, value]) =>
      flag === "-t" ? `-t${value}` : `${flag}=${value}`,
    ),
);

/** A user command param: a derived flag, a plain flag, or free text. */
const commandParam = fc.oneof(
  derivedFlag,
  fc.constantFrom("--full-refresh", "--threads", "--target-path"),
  segment,
  fc.string(),
);

const commandParams = fc.array(commandParam, { maxLength: 4 });

const deferEntry = fc.record(
  {
    deferToProduction: fc.boolean(),
    favorState: fc.boolean(),
    manifestPathForDeferral: fc.oneof(
      relativeDir,
      relativeDir.map((dir) => `${dir}/manifest.json`),
      fc.constantFrom("manifest.json", ""),
    ),
  },
  { requiredKeys: ["deferToProduction", "favorState"] },
);

/** Inputs for `resolveProjectSnapshot`, with the project at or under `snapshotFolder`. */
export const snapshotInputs: fc.Arbitrary<ProjectSnapshotInputs> = fc
  .record({
    rel: fc.array(segment, { maxLength: 2 }),
    config: pathKeys,
    target: fc.option(fc.oneof(segment, fc.constant("  ")), {
      nil: undefined,
    }),
    profilesDir: fc.option(relativeDir, { nil: undefined }),
    staticAnalysis: fc.oneof(staticAnalysisMode, fc.string()),
    lspCompiledOutput: fc.constantFrom(
      "separate",
      "shared",
      "bogus",
      undefined,
    ),
    override: fc.constantFrom("separate", "shared", "bogus", undefined),
    lintEnabled: fc.option(fc.boolean(), { nil: undefined }),
    traceServer: fc.oneof(traceLevel, fc.string()),
    environment: fc.dictionary(
      fc.oneof(segment, fc.constant("DBT_LSP_USE_TARGET_LSP")),
      fc.string(),
      { maxKeys: 3 },
    ),
    dbtPath: fc.option(
      fc.oneof(
        relativeDir,
        relativeDir.map((d) => `/${d}`),
      ),
      {
        nil: undefined,
      },
    ),
    defer: fc.option(deferEntry, { nil: undefined }),
    runParams: commandParams,
    buildParams: commandParams,
    testParams: commandParams,
  })
  .map((v): ProjectSnapshotInputs => {
    const root = path.join(snapshotFolder, ...v.rel);
    return {
      root,
      folder: snapshotFolder,
      firstWorkspaceFolder: snapshotFolder,
      userHome: path.join("/", "home", "u"),
      environment: { HOME: "/home/u", ...v.environment },
      lspCompiledOutputOverride: v.override,
      settings: {
        ...noSettings,
        dbtPath: v.dbtPath,
        target: v.target,
        profilesDir: v.profilesDir,
        staticAnalysis: v.staticAnalysis,
        lspCompiledOutput: v.lspCompiledOutput,
        lintEnabled: v.lintEnabled,
        traceServer: v.traceServer,
        deferPerProject: v.defer && {
          [deferSettingsKey(root, snapshotFolder)]: v.defer,
        },
        runParams: v.runParams,
        buildParams: v.buildParams,
        testParams: v.testParams,
      },
      projectFile: parsed(v.config),
    };
  });
