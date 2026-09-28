import { describe, expect, it } from "@jest/globals";
import * as path from "path";
import {
  ProjectSnapshotInputs,
  ProjectSnapshotSettings,
  resolveProjectSnapshot,
  substituteVariables,
} from "../../core/project";

const folder = path.join("/", "ws");
const first = path.join("/", "first");

const noSettings: ProjectSnapshotSettings = {
  dbtPath: undefined,
  target: undefined,
  profilesDir: undefined,
  staticAnalysis: undefined,
  lspCompiledOutput: undefined,
  deferPerProject: undefined,
  runParams: [],
  buildParams: [],
  testParams: [],
};

const base: ProjectSnapshotInputs = {
  root: path.join(folder, "proj"),
  folder,
  firstWorkspaceFolder: first,
  userHome: path.join("/", "home", "u"),
  environment: { DBT_BIN: path.join("/", "opt", "dbt") },
  lspCompiledOutputOverride: undefined,
  settings: noSettings,
  projectFile: { kind: "missing", config: {} },
};

const withSettings = (
  settings: Partial<ProjectSnapshotSettings>,
  rest: Partial<ProjectSnapshotInputs> = {},
) =>
  resolveProjectSnapshot({
    ...base,
    ...rest,
    settings: { ...noSettings, ...settings },
  });

describe("resolveProjectSnapshot", () => {
  it("uses dbt's standard layout and PATH lookup when nothing is configured", () => {
    const snapshot = resolveProjectSnapshot(base);
    expect(snapshot.name).toBe("proj");
    expect(snapshot.paths.modelPaths).toEqual([path.join(base.root, "models")]);
    expect(snapshot.invocation).toEqual({
      executable: { source: "path" },
      target: undefined,
      profilesDir: undefined,
      staticAnalysis: "project",
      compiledOutput: {
        mode: "separate",
        dir: path.join(base.root, "target", ".lsp"),
      },
      defer: undefined,
      environment: base.environment,
      commandParams: { run: [], build: [], test: [] },
    });
  });

  it("falls back to defaults and the root's name for an invalid project file", () => {
    const snapshot = resolveProjectSnapshot({
      ...base,
      projectFile: {
        kind: "invalid",
        text: "x: [",
        message: "bad",
        config: {},
      },
    });
    expect(snapshot.name).toBe("proj");
    expect(snapshot.paths.targetPath).toBe(path.join(base.root, "target"));
  });

  it("trims the target and leaves a blank one unset", () => {
    expect(withSettings({ target: " prod " }).invocation.target).toBe("prod");
    expect(withSettings({ target: "  " }).invocation.target).toBeUndefined();
  });

  it("falls back to the project's own static analysis for unknown values", () => {
    expect(
      withSettings({ staticAnalysis: "strict" }).invocation.staticAnalysis,
    ).toBe("strict");
    expect(
      withSettings({ staticAnalysis: "bogus" }).invocation.staticAnalysis,
    ).toBe("project");
  });

  it("prefers a valid environment override to the compiled-output setting", () => {
    const mode = (override: string | undefined, setting: unknown) =>
      withSettings(
        { lspCompiledOutput: setting },
        { lspCompiledOutputOverride: override },
      ).invocation.compiledOutput;
    expect(mode("shared", "separate")).toEqual({
      mode: "shared",
      dir: path.join(base.root, "target"),
    });
    expect(mode("bogus", "shared").mode).toBe("shared");
    expect(mode(undefined, "bogus").mode).toBe("separate");
  });

  it("resolves a relative profiles dir against the workspace folder", () => {
    expect(
      withSettings({ profilesDir: "profiles" }).invocation.profilesDir,
    ).toBe(path.join(folder, "profiles"));
  });

  it("leaves the profiles dir unset when it cannot be resolved", () => {
    expect(
      withSettings({ profilesDir: "profiles" }, { folder: undefined })
        .invocation.profilesDir,
    ).toBeUndefined();
    expect(
      withSettings(
        { profilesDir: "${workspaceFolder}/profiles" },
        { folder: undefined },
      ).invocation.profilesDir,
    ).toBeUndefined();
  });

  it("substitutes variables in the executable", () => {
    expect(
      withSettings({ dbtPath: "${env:DBT_BIN}" }).invocation.executable,
    ).toEqual({
      source: "configured",
      path: path.join("/", "opt", "dbt"),
    });
    expect(withSettings({ dbtPath: "bin/dbt" }).invocation.executable).toEqual({
      source: "configured",
      path: path.join(folder, "bin", "dbt"),
    });
  });

  it("marks an executable it cannot make absolute as unresolvable", () => {
    expect(
      withSettings({ dbtPath: "bin/dbt" }, { folder: undefined }).invocation
        .executable,
    ).toEqual({ source: "unresolvable", path: "bin/dbt" });
    expect(
      withSettings({ dbtPath: "${workspaceFolder}/dbt" }, { folder: undefined })
        .invocation.executable,
    ).toEqual({ source: "unresolvable", path: "${workspaceFolder}/dbt" });
  });

  it("resolves ${workspaceFolder} in command params against the first workspace folder", () => {
    const snapshot = withSettings({
      runParams: ["--vars=${userHome}", "--state=${workspaceFolder}/state"],
    });
    expect(snapshot.invocation.commandParams.run).toEqual([
      `--vars=${base.userHome}`,
      `--state=${first}/state`,
    ]);
  });

  it("resolves this project's defer entry against its root", () => {
    const snapshot = withSettings({
      deferPerProject: {
        proj: {
          deferToProduction: true,
          favorState: false,
          manifestPathForDeferral: "${workspaceFolder}/state",
        },
        other: { deferToProduction: false, favorState: true },
      },
    });
    expect(snapshot.invocation.defer).toEqual({
      deferToProduction: true,
      favorState: false,
      manifestPath: path.join(base.root, "state"),
    });
  });

  it("keys defer by the absolute root when the project is outside a workspace folder", () => {
    const entry = { deferToProduction: true, favorState: true };
    const snapshot = withSettings(
      { deferPerProject: { [path.relative("", base.root)]: entry } },
      { folder: undefined },
    );
    expect(snapshot.invocation.defer).toEqual({
      ...entry,
      manifestPath: undefined,
    });
  });
});

describe("substituteVariables", () => {
  const scope = {
    folder,
    userHome: "/home/u",
    lookup: (name: string) => ({ V: "a$&b$1c" })[name],
  };

  it("inserts `$&` and `$1` in a value literally", () => {
    expect(substituteVariables("x=${env:V}", scope)).toBe("x=a$&b$1c");
    expect(
      substituteVariables("${workspaceFolder}", { ...scope, folder: "/w$&" }),
    ).toBe("/w$&");
  });

  it("leaves unresolved placeholders in place", () => {
    expect(
      substituteVariables("${env:NOPE}/${workspaceFolder}", {
        ...scope,
        folder: undefined,
      }),
    ).toBe("${env:NOPE}/${workspaceFolder}");
  });
});
