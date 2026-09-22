import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";
import { Uri, WorkspaceFolder } from "vscode";
import {
  ConfiguredFusionExecutableResolver,
  FUSION_PATH_SETTING,
  FusionExecutable,
} from "../../fusion/fusionExecutable";
import { FusionVersionVerdict } from "../../fusion/fusionVersion";
import { CONFIGURATION_SECTION } from "../../projects/projectConfiguration";
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
  const findOnPath = jest.fn<(name: string) => Promise<string | undefined>>();
  const isExecutable = jest.fn<(filePath: string) => Promise<boolean>>();
  const runVersion =
    jest.fn<
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
    jest.restoreAllMocks();
    delete process.env[ENV_SENTINEL];
  });

  it("prefers a configured path over PATH lookup", async () => {
    const configured = "/opt/dbt-fusion/bin/dbt";
    const { resolver, findOnPath, isExecutable, runVersion } = createResolver({
      getConfiguredPath: () => configured,
    });

    isExecutable.mockResolvedValue(true);
    runVersion.mockResolvedValue({ stdout: "dbt 2.0.5\n", stderr: "" });

    const result = await resolver.resolve(scope);

    expect(result).toMatchObject({
      path: configured,
      version: {
        major: 2,
        minor: 0,
        patch: 5,
        raw: "dbt 2.0.5\n",
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
      runVersion.mockResolvedValue({ stdout: "dbt 2.0.5\n", stderr: "" });

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
    runVersion.mockResolvedValue({ stdout: "dbt 2.0.5\n", stderr: "" });

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
    runVersion.mockResolvedValue({ stdout: "dbt 2.0.5\n", stderr: "" });

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
    runVersion.mockResolvedValue({ stdout: "dbt 2.0.5\n", stderr: "" });

    const result = await resolver.resolve(scope);

    expect(findOnPath).toHaveBeenCalledWith("dbt");
    expect(result).toMatchObject({ path: onPath });
  });

  it("resolves dbt from PATH when no configured path is set", async () => {
    const onPath = "/usr/local/bin/dbt";
    const { resolver, findOnPath, runVersion } = createResolver();

    findOnPath.mockResolvedValue(onPath);
    runVersion.mockResolvedValue({ stdout: "dbt 2.0.5\n", stderr: "" });

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
    runVersion.mockResolvedValue({ stdout: "dbt 2.0.5\n", stderr: "" });

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
    runVersion.mockResolvedValue({ stdout: "dbt 2.0.5\n", stderr: "" });

    await resolver.resolve(scope);

    const call = runVersion.mock.calls[0];
    expect(call).toBeDefined();
    const env = call?.[1];
    if (env === undefined) {
      throw new Error("expected runVersion env");
    }
    expectInheritedEnv(env);
  });

  it("returns FusionExecutable for an ok version verdict", async () => {
    const raw = "dbt 2.0.5\n";
    const { resolver, findOnPath, runVersion } = createResolver();

    findOnPath.mockResolvedValue("/usr/local/bin/dbt");
    runVersion.mockResolvedValue({ stdout: raw, stderr: "" });

    const result = await resolver.resolve(scope);

    expect(result).toMatchObject({
      path: "/usr/local/bin/dbt",
      version: { major: 2, minor: 0, patch: 5, raw },
    });
    assertFusionExecutable(result);
    expectInheritedEnv(result.env);
  });

  it("uses stderr when stdout is empty", async () => {
    const raw = "dbt 2.0.5\n";
    const { resolver, findOnPath, runVersion } = createResolver();

    findOnPath.mockResolvedValue("/usr/local/bin/dbt");
    runVersion.mockResolvedValue({ stdout: "", stderr: raw });

    const result = await resolver.resolve(scope);

    expect(result).toMatchObject({
      version: { major: 2, minor: 0, patch: 5, raw },
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
    });
  });

  it("propagates tooOld, notFusion, and untestedMajor verdicts", async () => {
    const cases = [
      {
        stdout: "dbt 2.0.4\n",
        expected: {
          kind: "tooOld",
          version: { major: 2, minor: 0, patch: 4, raw: "dbt 2.0.4\n" },
        },
      },
      {
        stdout: "Core:\n  - installed: 1.8.8\n",
        expected: { kind: "notFusion", raw: "Core:\n  - installed: 1.8.8\n" },
      },
      {
        stdout: "dbt 3.0.0\n",
        expected: {
          kind: "untestedMajor",
          version: { major: 3, minor: 0, patch: 0, raw: "dbt 3.0.0\n" },
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

  it("judges version output when runVersion rejects with stderr output", async () => {
    const raw = "dbt 2.0.5\n";
    const { resolver, findOnPath, runVersion } = createResolver();

    findOnPath.mockResolvedValue("/usr/local/bin/dbt");
    runVersion.mockRejectedValue(
      Object.assign(new Error("Command failed"), { stdout: "", stderr: raw }),
    );

    const result = await resolver.resolve(scope);

    expect(result).toMatchObject({
      path: "/usr/local/bin/dbt",
      version: { major: 2, minor: 0, patch: 5, raw },
    });
  });

  it("returns notFusion when runVersion rejects without version output", async () => {
    const { resolver, findOnPath, runVersion } = createResolver();

    findOnPath.mockResolvedValue("/usr/local/bin/dbt");
    runVersion.mockRejectedValue(new Error("spawn ENOENT"));

    await expect(resolver.resolve(scope)).resolves.toEqual({
      kind: "notFusion",
      raw: "spawn ENOENT",
    });
  });

  it("returns notFusion with empty raw when --version succeeds with no output", async () => {
    const { resolver, findOnPath, runVersion } = createResolver();

    findOnPath.mockResolvedValue("/usr/local/bin/dbt");
    runVersion.mockResolvedValue({ stdout: "", stderr: "" });

    await expect(resolver.resolve(scope)).resolves.toEqual({
      kind: "notFusion",
      raw: "empty",
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
        ([key]) => key === `${CONFIGURATION_SECTION}.${FUSION_PATH_SETTING}`,
      )?.[1];

    expect(property).toMatchObject({
      type: "string",
      scope: "resource",
    });
    expect(property).not.toHaveProperty("default");
  });
});
