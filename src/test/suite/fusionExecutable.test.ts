import { readFileSync } from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Uri, window, WorkspaceFolder } from "vscode";
import {
  ConfiguredFusionExecutableResolver,
  DBT_PATH_SETTING,
  formatFusionExecutableResolutionFailure,
  FusionExecutable,
} from "../../fusion/fusionExecutable";
import { FusionVersionVerdict } from "../../fusion/fusionVersion";
import { CONFIGURATION_SECTION } from "../../settings";
import { esmDirname } from "../esmDirname";

const repositoryRoot = path.resolve(esmDirname(import.meta.url), "../../..");
const scope = Uri.file("/workspace/general/models/stg_orders.sql");
const folder: WorkspaceFolder = {
  uri: Uri.file("/workspace/general"),
  name: "general",
  index: 0,
};
const ENV_SENTINEL = "FUSION_PU_RESOLVER_TEST_ENV";

function definedEnvKeys(): string[] {
  return Object.keys(process.env).filter(
    (key) => process.env[key] !== undefined,
  );
}

function expectInheritedEnv(env: Record<string, string>): void {
  expect(env.PATH).toBe(process.env.PATH);
  expect(Object.keys(env).sort()).toEqual(definedEnvKeys().sort());
  expect(env[ENV_SENTINEL]).toBe("set");
}

function assertFusionExecutable(
  result: FusionExecutable | FusionVersionVerdict,
): asserts result is FusionExecutable {
  expect(result).toHaveProperty("env");
}

function createResolver(
  overrides: Partial<
    ConstructorParameters<typeof ConfiguredFusionExecutableResolver>[0]
  > = {},
) {
  const findOnPath =
    vi.fn<(name: string, pathValue?: string) => Promise<string | undefined>>();
  const isExecutable = vi.fn<(filePath: string) => Promise<boolean>>();
  const runVersion =
    vi.fn<
      (
        executable: string,
        env: Record<string, string>,
      ) => Promise<{ stdout: string; stderr: string }>
    >();

  const resolver = new ConfiguredFusionExecutableResolver({
    getConfiguredPath: () => undefined,
    getWorkspaceFolder: () => folder,
    findOnPath,
    isExecutable,
    runVersion,
    ...overrides,
  });

  return { resolver, findOnPath, isExecutable, runVersion };
}

describe("Fusion executable resolver", () => {
  beforeEach(() => {
    process.env[ENV_SENTINEL] = "set";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env[ENV_SENTINEL];
  });

  it("prefers a configured path over PATH lookup", async () => {
    const configured = "/opt/dbt-fusion/bin/dbt";
    const { resolver, findOnPath, isExecutable, runVersion } = createResolver({
      getConfiguredPath: () => configured,
    });

    isExecutable.mockResolvedValue(true);
    runVersion.mockResolvedValue({ stdout: "dbt 2.0.6\n", stderr: "" });

    const result = await resolver.resolve(scope);

    expect(result).toMatchObject({
      path: configured,
      version: {
        major: 2,
        minor: 0,
        patch: 6,
        raw: "dbt 2.0.6\n",
      },
    });
    assertFusionExecutable(result);
    expectInheritedEnv(result.env);
    expect(findOnPath).not.toHaveBeenCalled();
  });

  it("resolves ${workspaceFolder}, ${userHome}, and ${env:VAR} in configured paths", async () => {
    const priorDbtBin = process.env.DBT_BIN;
    process.env.DBT_BIN = "fusion-bin";
    try {
      const configured = "${userHome}/.local/${env:DBT_BIN}/dbt";
      const expected = "/mock/home/.local/fusion-bin/dbt";
      const { resolver, isExecutable, runVersion } = createResolver({
        getConfiguredPath: () => configured,
        getUserHome: () => "/mock/home",
      });

      isExecutable.mockResolvedValue(true);
      runVersion.mockResolvedValue({ stdout: "dbt 2.0.6\n", stderr: "" });

      await resolver.resolve(scope);

      expect(isExecutable).toHaveBeenCalledWith(expected);
    } finally {
      if (priorDbtBin === undefined) {
        delete process.env.DBT_BIN;
      } else {
        process.env.DBT_BIN = priorDbtBin;
      }
    }
  });

  it("resolves a relative configured path against the containing workspace folder", async () => {
    const { resolver, isExecutable, runVersion } = createResolver({
      getConfiguredPath: () => "bin/dbt",
    });
    const expected = path.resolve(folder.uri.fsPath, "bin/dbt");

    isExecutable.mockResolvedValue(true);
    runVersion.mockResolvedValue({ stdout: "dbt 2.0.6\n", stderr: "" });

    const result = await resolver.resolve(scope);

    expect(isExecutable).toHaveBeenCalledWith(expected);
    expect(result).toMatchObject({ path: expected });
  });

  it("returns blocking notFound for a relative configured path without a workspace folder", async () => {
    const { resolver, findOnPath, isExecutable, runVersion } = createResolver({
      getConfiguredPath: () => "bin/dbt",
      getWorkspaceFolder: () => undefined,
    });

    const result = await resolver.resolve(scope);

    expect(result).toEqual({
      kind: "notFound",
      path: "bin/dbt",
      source: "configured",
    });
    expect(findOnPath).not.toHaveBeenCalled();
    expect(isExecutable).not.toHaveBeenCalled();
    expect(runVersion).not.toHaveBeenCalled();
  });

  it("returns blocking notFound for an unresolved workspaceFolder token without a workspace folder", async () => {
    const { resolver, findOnPath, runVersion } = createResolver({
      getConfiguredPath: () => "${workspaceFolder}/bin/dbt",
      getWorkspaceFolder: () => undefined,
    });

    const result = await resolver.resolve(scope);

    expect(result).toEqual({
      kind: "notFound",
      path: "${workspaceFolder}/bin/dbt",
      source: "configured",
    });
    expect(findOnPath).not.toHaveBeenCalled();
    expect(runVersion).not.toHaveBeenCalled();
  });

  it("resolves an absolute userHome configured path without a workspace folder", async () => {
    const configured = "${userHome}/.local/bin/dbt";
    const expected = "/mock/home/.local/bin/dbt";
    const { resolver, isExecutable, runVersion } = createResolver({
      getConfiguredPath: () => configured,
      getWorkspaceFolder: () => undefined,
      getUserHome: () => "/mock/home",
    });

    isExecutable.mockResolvedValue(true);
    runVersion.mockResolvedValue({ stdout: "dbt 2.0.6\n", stderr: "" });

    const result = await resolver.resolve(scope);

    expect(isExecutable).toHaveBeenCalledWith(expected);
    expect(result).toMatchObject({ path: expected });
  });

  it("returns blocking notFound for a missing configured path without PATH lookup", async () => {
    const configured = "/missing/dbt";
    const { resolver, findOnPath, isExecutable, runVersion } = createResolver({
      getConfiguredPath: () => configured,
    });

    isExecutable.mockResolvedValue(false);

    const result = await resolver.resolve(scope);

    expect(result).toEqual({
      kind: "notFound",
      path: configured,
      source: "configured",
    });
    expect(findOnPath).not.toHaveBeenCalled();
    expect(runVersion).not.toHaveBeenCalled();
  });

  it("returns blocking notFound for a non-executable configured path without PATH lookup", async () => {
    const configured = "/workspace/general/bin/dbt";
    const { resolver, findOnPath, isExecutable, runVersion } = createResolver({
      getConfiguredPath: () => configured,
    });

    isExecutable.mockResolvedValue(false);

    const result = await resolver.resolve(scope);

    expect(result).toEqual({
      kind: "notFound",
      path: configured,
      source: "configured",
    });
    expect(findOnPath).not.toHaveBeenCalled();
    expect(runVersion).not.toHaveBeenCalled();
  });

  it("treats whitespace-only configured paths as unset and uses PATH lookup", async () => {
    const onPath = "/usr/local/bin/dbt";
    const { resolver, findOnPath, runVersion } = createResolver({
      getConfiguredPath: () => "   ",
    });

    findOnPath.mockResolvedValue(onPath);
    runVersion.mockResolvedValue({ stdout: "dbt 2.0.6\n", stderr: "" });

    const result = await resolver.resolve(scope);

    expect(findOnPath).toHaveBeenCalledWith("dbt");
    expect(result).toMatchObject({ path: onPath });
  });

  it("resolves dbt from PATH when no configured path is set", async () => {
    const onPath = "/usr/local/bin/dbt";
    const { resolver, findOnPath, runVersion } = createResolver();

    findOnPath.mockResolvedValue(onPath);
    runVersion.mockResolvedValue({ stdout: "dbt 2.0.6\n", stderr: "" });

    const result = await resolver.resolve(scope);

    expect(findOnPath).toHaveBeenCalledWith("dbt");
    expect(result).toMatchObject({ path: onPath });
  });

  it("returns blocking notFound when dbt is absent from PATH", async () => {
    const { resolver, findOnPath, runVersion } = createResolver();

    findOnPath.mockResolvedValue(undefined);

    const result = await resolver.resolve(scope);

    expect(result).toEqual({
      kind: "notFound",
      path: "dbt",
      source: "path",
    });
    expect(runVersion).not.toHaveBeenCalled();
  });

  it("returns an absolute executable path", async () => {
    const relativeConfigured = "bin/dbt";
    const { resolver, isExecutable, runVersion } = createResolver({
      getConfiguredPath: () => relativeConfigured,
    });
    const expected = path.resolve(folder.uri.fsPath, relativeConfigured);

    isExecutable.mockResolvedValue(true);
    runVersion.mockResolvedValue({ stdout: "dbt 2.0.6\n", stderr: "" });

    const result = await resolver.resolve(scope);

    expect(result).toMatchObject({ path: expected });
    expect(path.isAbsolute((result as { path: string }).path)).toBe(true);
  });

  it("runs --version with inherited env", async () => {
    const configured = "/opt/dbt";
    const { resolver, isExecutable, runVersion } = createResolver({
      getConfiguredPath: () => configured,
    });

    isExecutable.mockResolvedValue(true);
    runVersion.mockResolvedValue({ stdout: "dbt 2.0.6\n", stderr: "" });

    await resolver.resolve(scope);

    const call = runVersion.mock.calls[0];
    expect(call).toBeDefined();
    const env = call?.[1];
    if (env === undefined) {
      throw new Error("expected runVersion env");
    }
    expectInheritedEnv(env);
  });

  it("preserves DBT_PROFILES_DIR from the host environment in the resolved env", async () => {
    const priorProfilesDir = process.env.DBT_PROFILES_DIR;
    process.env.DBT_PROFILES_DIR = "/Users/someone/.dbt";

    try {
      const { resolver, isExecutable, runVersion } = createResolver({
        getConfiguredPath: () => "/opt/dbt",
      });
      isExecutable.mockResolvedValue(true);
      runVersion.mockResolvedValue({ stdout: "dbt 2.0.6\n", stderr: "" });

      const result = await resolver.resolve(scope);

      assertFusionExecutable(result);
      expect(result.env.DBT_PROFILES_DIR).toBe("/Users/someone/.dbt");
    } finally {
      if (priorProfilesDir === undefined) {
        delete process.env.DBT_PROFILES_DIR;
      } else {
        process.env.DBT_PROFILES_DIR = priorProfilesDir;
      }
    }
  });

  it("returns FusionExecutable for an ok version verdict", async () => {
    const raw = "dbt 2.0.6\n";
    const { resolver, findOnPath, runVersion } = createResolver();

    findOnPath.mockResolvedValue("/usr/local/bin/dbt");
    runVersion.mockResolvedValue({ stdout: raw, stderr: "" });

    const result = await resolver.resolve(scope);

    expect(result).toMatchObject({
      path: "/usr/local/bin/dbt",
      version: { major: 2, minor: 0, patch: 6, raw },
    });
    assertFusionExecutable(result);
    expectInheritedEnv(result.env);
  });

  it("uses stderr when stdout is empty", async () => {
    const raw = "dbt 2.0.6\n";
    const { resolver, findOnPath, runVersion } = createResolver();

    findOnPath.mockResolvedValue("/usr/local/bin/dbt");
    runVersion.mockResolvedValue({ stdout: "", stderr: raw });

    const result = await resolver.resolve(scope);

    expect(result).toMatchObject({
      version: { major: 2, minor: 0, patch: 6, raw },
    });
  });

  it("returns notFusion for stderr-only Core output", async () => {
    const raw = "Core:\n  - installed: 1.8.8\n";
    const { resolver, findOnPath, runVersion } = createResolver();

    findOnPath.mockResolvedValue("/usr/local/bin/dbt");
    runVersion.mockResolvedValue({ stdout: "", stderr: raw });

    await expect(resolver.resolve(scope)).resolves.toEqual({
      kind: "notFusion",
      raw,
      path: "/usr/local/bin/dbt",
      source: "path",
    });
  });

  it("propagates blocking tooOld and notFusion verdicts", async () => {
    const cases = [
      {
        stdout: "dbt 2.0.4\n",
        expected: {
          kind: "tooOld",
          version: { major: 2, minor: 0, patch: 4, raw: "dbt 2.0.4\n" },
          path: "/usr/local/bin/dbt",
          source: "path",
        },
      },
      {
        stdout: "Core:\n  - installed: 1.8.8\n",
        expected: {
          kind: "notFusion",
          raw: "Core:\n  - installed: 1.8.8\n",
          path: "/usr/local/bin/dbt",
          source: "path",
        },
      },
    ] as const;

    for (const { stdout, expected } of cases) {
      const { resolver, findOnPath, runVersion } = createResolver();

      findOnPath.mockResolvedValue("/usr/local/bin/dbt");
      runVersion.mockResolvedValue({ stdout, stderr: "" });

      await expect(resolver.resolve(scope)).resolves.toEqual(expected);
    }
  });

  it("resolves an untested newer major as a usable executable", async () => {
    const raw = "dbt 3.0.0\n";
    const { resolver, findOnPath, runVersion } = createResolver();

    findOnPath.mockResolvedValue("/usr/local/bin/dbt");
    runVersion.mockResolvedValue({ stdout: raw, stderr: "" });

    const result = await resolver.resolve(scope);

    assertFusionExecutable(result);
    expect(result).toMatchObject({
      path: "/usr/local/bin/dbt",
      version: { major: 3, minor: 0, patch: 0, raw },
    });
  });

  it("warns once per untested major, to the terminal only, across repeated resolutions", async () => {
    const logWarning = vi.fn();
    const stored = new Map<string, unknown>();
    const getGlobalState = vi.fn(() => ({
      get: <T>(key: string) => stored.get(key) as T | undefined,
      update: (key: string, value: unknown) => {
        stored.set(key, value);
      },
    }));
    const { resolver, findOnPath, runVersion } = createResolver({
      logWarning,
      getGlobalState,
    });

    findOnPath.mockResolvedValue("/usr/local/bin/dbt");
    runVersion.mockResolvedValue({ stdout: "dbt 3.0.0\n", stderr: "" });

    await resolver.resolve(scope);
    await resolver.resolve(scope);
    runVersion.mockResolvedValue({ stdout: "dbt 3.1.2\n", stderr: "" });
    await resolver.resolve(scope);

    expect(logWarning).toHaveBeenCalledTimes(1);
    expect(logWarning.mock.calls[0]?.[0]).toContain("major version 3");
    expect(window.showWarningMessage).not.toHaveBeenCalled();
    expect(window.showInformationMessage).not.toHaveBeenCalled();
    expect(window.showErrorMessage).not.toHaveBeenCalled();
  });

  it("does not warn again once a major is already recorded in global state", async () => {
    const logWarning = vi.fn();
    const stored = new Map<string, unknown>([
      ["fusionVersion.warnedMajor.3", true],
    ]);
    const getGlobalState = vi.fn(() => ({
      get: <T>(key: string) => stored.get(key) as T | undefined,
      update: (key: string, value: unknown) => {
        stored.set(key, value);
      },
    }));
    const { resolver, findOnPath, runVersion } = createResolver({
      logWarning,
      getGlobalState,
    });

    findOnPath.mockResolvedValue("/usr/local/bin/dbt");
    runVersion.mockResolvedValue({ stdout: "dbt 3.0.0\n", stderr: "" });

    await resolver.resolve(scope);

    expect(logWarning).not.toHaveBeenCalled();
  });

  it("judges version output when runVersion rejects with stderr output", async () => {
    const raw = "dbt 2.0.6\n";
    const { resolver, findOnPath, runVersion } = createResolver();

    findOnPath.mockResolvedValue("/usr/local/bin/dbt");
    runVersion.mockRejectedValue(
      Object.assign(new Error("Command failed"), { stdout: "", stderr: raw }),
    );

    const result = await resolver.resolve(scope);

    expect(result).toMatchObject({
      path: "/usr/local/bin/dbt",
      version: { major: 2, minor: 0, patch: 6, raw },
    });
  });

  it("returns notFusion when runVersion rejects without version output", async () => {
    const { resolver, findOnPath, runVersion } = createResolver();

    findOnPath.mockResolvedValue("/usr/local/bin/dbt");
    runVersion.mockRejectedValue(new Error("spawn ENOENT"));

    await expect(resolver.resolve(scope)).resolves.toEqual({
      kind: "notFusion",
      raw: "spawn ENOENT",
      path: "/usr/local/bin/dbt",
      source: "path",
    });
  });

  it("returns notFusion with empty raw when --version succeeds with no output", async () => {
    const { resolver, findOnPath, runVersion } = createResolver();

    findOnPath.mockResolvedValue("/usr/local/bin/dbt");
    runVersion.mockResolvedValue({ stdout: "", stderr: "" });

    await expect(resolver.resolve(scope)).resolves.toEqual({
      kind: "notFusion",
      raw: "empty",
      path: "/usr/local/bin/dbt",
      source: "path",
    });
  });

  describe("project environment", () => {
    const hostDbt = "/usr/local/bin/dbt";
    const toolDbt = "/tool/shims/dbt";
    const toolEnv = { PATH: "/tool/shims", HOME: "/home/dev" };

    function shadowedResolver(
      overrides: Parameters<typeof createResolver>[0] = {},
    ) {
      const created = createResolver(overrides);
      created.findOnPath.mockImplementation(async (_name, pathValue) =>
        pathValue === undefined ? hostDbt : toolDbt,
      );
      created.runVersion.mockImplementation(async (executable) => ({
        stdout: executable === hostDbt ? "dbt 2.0.5\n" : "dbt 2.0.6\n",
        stderr: "",
      }));
      return created;
    }

    it.each(["mise", "direnv"] as const)(
      "prefers a %s PATH that shadows the host dbt, and runs --version on that environment",
      async (source) => {
        const { resolver, runVersion } = shadowedResolver();

        const result = await resolver.resolve(scope, {
          env: toolEnv,
          source,
        });

        assertFusionExecutable(result);
        expect(result.path).toBe(path.resolve(toolDbt));
        expect(result.env).toEqual(toolEnv);
        expect(runVersion).toHaveBeenCalledWith(path.resolve(toolDbt), toolEnv);
      },
    );

    it("reads a Windows-style Path key and skips the lookup without any PATH", async () => {
      const { resolver, findOnPath } = shadowedResolver();

      const result = await resolver.resolve(scope, {
        env: { Path: "/tool/shims" },
        source: "mise",
      });
      assertFusionExecutable(result);
      expect(result.path).toBe(path.resolve(toolDbt));
      expect(findOnPath).toHaveBeenCalledWith("dbt", "/tool/shims");

      findOnPath.mockClear();
      await resolver.resolve(scope, { env: { HOME: "/h" }, source: "mise" });
      expect(findOnPath).toHaveBeenCalledTimes(1);
      expect(findOnPath).toHaveBeenCalledWith("dbt");
    });

    it("names the tool manager in resolution failures", async () => {
      const { resolver, runVersion } = shadowedResolver();
      runVersion.mockResolvedValue({ stdout: "dbt 2.0.5\n", stderr: "" });

      const result = await resolver.resolve(scope, {
        env: toolEnv,
        source: "mise",
      });

      expect(result).toMatchObject({ kind: "tooOld", source: "mise" });
      expect(
        formatFusionExecutableResolutionFailure(
          "general",
          result as FusionVersionVerdict,
        ),
      ).toContain(`${path.resolve(toolDbt)} (from mise)`);
    });

    it("keeps the path source when the project lookup matches the host's", async () => {
      const { resolver, findOnPath, runVersion } = createResolver();
      findOnPath.mockResolvedValue(hostDbt);
      runVersion.mockResolvedValue({ stdout: "dbt 2.0.6\n", stderr: "" });

      const result = await resolver.resolve(scope, {
        env: toolEnv,
        source: "mise",
      });

      assertFusionExecutable(result);
      expect(result.path).toBe(path.resolve(hostDbt));
      runVersion.mockResolvedValue({ stdout: "dbt 2.0.5\n", stderr: "" });
      await expect(
        resolver.resolve(scope, { env: toolEnv, source: "mise" }),
      ).resolves.toMatchObject({ kind: "tooOld", source: "path" });
    });

    it("falls back to the host PATH when the project PATH has no dbt", async () => {
      const { resolver, findOnPath, runVersion } = createResolver();
      findOnPath.mockImplementation(async (_name, pathValue) =>
        pathValue === undefined ? hostDbt : undefined,
      );
      runVersion.mockResolvedValue({ stdout: "dbt 2.0.6\n", stderr: "" });

      const result = await resolver.resolve(scope, {
        env: toolEnv,
        source: "direnv",
      });

      expect(result).toMatchObject({ path: path.resolve(hostDbt) });
    });

    it("lets fusionPowerUser.dbtPath win over the project PATH", async () => {
      const configured = "/opt/fusion/dbt";
      const { resolver, findOnPath, isExecutable, runVersion } =
        shadowedResolver({ getConfiguredPath: () => configured });
      isExecutable.mockResolvedValue(true);

      const result = await resolver.resolve(scope, {
        env: toolEnv,
        source: "mise",
      });

      expect(result).toMatchObject({ path: path.resolve(configured) });
      expect(findOnPath).not.toHaveBeenCalled();
      expect(runVersion).toHaveBeenCalledWith(
        path.resolve(configured),
        toolEnv,
      );
    });
  });

  it("matches the package manifest for fusionPath", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
    ) as {
      contributes: {
        configuration: Array<{ properties: Record<string, unknown> }>;
      };
    };
    const property = manifest.contributes.configuration
      .flatMap((section) => Object.entries(section.properties))
      .find(
        ([key]) => key === `${CONFIGURATION_SECTION}.${DBT_PATH_SETTING}`,
      )?.[1];

    expect(property).toMatchObject({
      type: "string",
      scope: "resource",
    });
    expect(property).not.toHaveProperty("default");
  });
});
