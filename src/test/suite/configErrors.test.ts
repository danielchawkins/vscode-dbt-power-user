import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { commands, languages, Uri, window, workspace } from "vscode";
import { DBTTerminal } from "../../dbt_integration";
import { CommandProcessExecutionFactory } from "../../fusion/commandProcessExecution";
import { FusionCli } from "../../fusion/fusionCli";
import { formatFusionExecutableResolutionFailure } from "../../fusion/fusionExecutable";
import { compileErrorMessages } from "../../fusion/fusionLanguageClient";
import { Project } from "../../projects/project";
import {
  errorHint,
  ProjectErrors,
  SHOW_OUTPUT,
} from "../../projects/projectErrors";
import { ProjectRegistry } from "../../projects/projectRegistry";
import { readProjectSnapshot } from "../../projects/readProjectSnapshot";
import { resetMocks } from "../mock/vscode";
import { buildTestProject } from "../projectHarness";

const ENV_ERROR =
  "[error] [InvalidConfig (dbt1005)]: Jinja render error: invalid operation: 'env_var': environment variable " +
  "'FPU_MISSING_VAR' not found\n(in :1:1)";
const PROFILES_ERROR =
  "[error] [InvalidConfig (dbt1005)]: No profiles.yml found at `/nowhere/profiles.yml`.\n" +
  "Try running without the --profiles-dir flag to check the default locations.";
const TARGET_ERROR =
  "[error] [InvalidConfig (dbt1005)]: target 'nope' not found in profile 'config_errors'";

const record = (level: string, msg: string) =>
  JSON.stringify({ info: { level, msg } });

const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

function terminal(): DBTTerminal & { error: Mock } {
  return {
    log: vi.fn(),
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    dispose: vi.fn(),
  };
}

function settings(values: Record<string, unknown>): void {
  vi.mocked(workspace.getConfiguration).mockReturnValue({
    get: vi.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
    has: vi.fn(),
    update: vi.fn(),
  } as never);
}

/** A project at `root` whose `dbt parse` prints `parse()` as JSON log records and exits with its code. */
function projectWithParse(
  root: string,
  parse: () => { stdout: string; exitCode: number },
) {
  const log = terminal();
  const processes = {
    createCommandProcessExecution: () => ({
      complete: async () => ({ stderr: "", fullOutput: "", ...parse() }),
    }),
  } as unknown as CommandProcessExecutionFactory;
  const project = buildTestProject(
    root,
    (executable, projectRoot) =>
      new FusionCli(
        executable,
        () => readProjectSnapshot(Uri.file(projectRoot)),
        processes,
        log,
      ),
    { terminal: log, projectRoot: Uri.file(root) },
  );
  return { project, log };
}

function published(): Map<string, { message: string; range: unknown }[]> {
  const results = vi.mocked(languages.createDiagnosticCollection).mock.results;
  const collection = results[results.length - 1]?.value as {
    forEach(
      cb: (uri: Uri, d: { message: string; range: unknown }[]) => void,
    ): void;
  };
  const byFile = new Map<string, { message: string; range: unknown }[]>();
  collection.forEach((uri, diagnostics) => {
    if (diagnostics.length) {
      byFile.set(uri.fsPath, diagnostics);
    }
  });
  return byFile;
}

describe("configuration errors", () => {
  let root: string;
  let project: Project | undefined;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fpu-config-errors-"));
    fs.writeFileSync(
      path.join(root, "dbt_project.yml"),
      "name: config_errors\nprofile: config_errors\n",
    );
    const folder = { uri: Uri.file(root), name: "config_errors", index: 0 };
    (workspace as { workspaceFolders: unknown }).workspaceFolders = [folder];
    vi.mocked(workspace.getWorkspaceFolder).mockReturnValue(folder);
    settings({});
  });

  afterEach(async () => {
    await project?.dispose();
    project = undefined;
    vi.clearAllMocks();
    resetMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("notifies a missing environment variable once, with Show output and the hint, until parse succeeds", async () => {
    let parse = { stdout: record("error", ENV_ERROR), exitCode: 1 };
    const built = projectWithParse(root, () => parse);
    project = built.project;
    vi.mocked(window.showErrorMessage).mockResolvedValueOnce(
      SHOW_OUTPUT as never,
    );

    await project.initialize();
    await flush();

    expect(window.showErrorMessage).toHaveBeenCalledTimes(1);
    const [text, ...actions] = vi.mocked(window.showErrorMessage).mock.calls[0];
    expect(text).toBe(
      "config_errors: [InvalidConfig (dbt1005)]: Jinja render error: invalid operation: 'env_var': " +
        "environment variable 'FPU_MISSING_VAR' not found " +
        "The editor's environment lacks FPU_MISSING_VAR. Start the editor from a shell that sets it, " +
        "or set it in your profile.",
    );
    expect(actions).toEqual([SHOW_OUTPUT]);
    expect(commands.executeCommand).toHaveBeenCalledWith(
      "fusionPowerUser.showFusionOutput",
      Uri.file(root),
    );
    expect(built.log.error).toHaveBeenCalledWith(
      "ProjectErrors",
      ENV_ERROR,
      undefined,
    );

    const diagnostics = published();
    expect([...diagnostics.keys()]).toEqual([
      path.join(root, "dbt_project.yml"),
    ]);
    expect(diagnostics.get(path.join(root, "dbt_project.yml"))).toEqual([
      expect.objectContaining({ message: ENV_ERROR }),
    ]);
    expect(
      project.getFusionCli().getDiagnostics().rebuildManifestDiagnostics[0]
        .range,
    ).toEqual({ startLine: 0, startColumn: 0, endLine: 0, endColumn: 999 });
    expect(project.errors.current).toBe(
      "[InvalidConfig (dbt1005)]: Jinja render error: invalid operation: 'env_var': environment variable " +
        "'FPU_MISSING_VAR' not found",
    );

    await project.rebuildManifest();
    await flush();
    expect(window.showErrorMessage).toHaveBeenCalledTimes(1);

    parse = { stdout: record("info", "ok"), exitCode: 0 };
    await project.rebuildManifest();
    await flush();
    expect(published().size).toBe(0);
    expect(project.errors.current).toBeUndefined();

    parse = { stdout: record("error", ENV_ERROR), exitCode: 1 };
    await project.rebuildManifest();
    await flush();
    expect(window.showErrorMessage).toHaveBeenCalledTimes(2);
  });

  it("names fusionPowerUser.profilesDir when it holds no profiles.yml", async () => {
    settings({ profilesDir: "/nowhere" });
    project = projectWithParse(root, () => ({
      stdout: record("error", PROFILES_ERROR),
      exitCode: 1,
    })).project;

    await project.initialize();
    await flush();

    const [text] = vi.mocked(window.showErrorMessage).mock.calls[0];
    expect(text).toContain("No profiles.yml found at `/nowhere/profiles.yml`.");
    expect(text).toContain(
      "fusionPowerUser.profilesDir is /nowhere, which has no profiles.yml.",
    );
  });

  it("names an unknown target and the setting that chose it", async () => {
    settings({ target: "nope" });
    project = projectWithParse(root, () => ({
      stdout: record("error", TARGET_ERROR),
      exitCode: 1,
    })).project;

    await project.initialize();
    await flush();

    const [text] = vi.mocked(window.showErrorMessage).mock.calls[0];
    expect(text).toContain(
      "target 'nope' not found in profile 'config_errors'",
    );
    expect(text).toContain(
      "fusionPowerUser.target is nope; set it to a target the profile defines.",
    );
  });

  it("places a profiles.yml error on profiles.yml and leaves model errors silent", async () => {
    project = projectWithParse(root, () => ({
      stdout: [
        record(
          "error",
          "[error] [SerializationError (dbt1013)]: YAML error\n  --> profiles.yml:4:7",
        ),
        record(
          "error",
          "[error] [DependencyNotFound (dbt1048)]: Ref 'x' not found\n  --> models/a.sql:1:15",
        ),
      ].join("\n"),
      exitCode: 1,
    })).project;

    await project.initialize();
    await flush();

    expect([...published().keys()]).toEqual([path.join(root, "profiles.yml")]);
    expect(window.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(window.showErrorMessage).mock.calls[0][0]).toContain(
      "SerializationError",
    );
  });

  it("reports the language server's config errors and clears them after a clean compile", async () => {
    project = projectWithParse(root, () => ({
      stdout: "",
      exitCode: 0,
    })).project;
    await project.initialize();
    await flush();

    const notification = {
      errors: [
        {
          code: "1005",
          message: ENV_ERROR.replace("[error] ", ""),
          severity: "Error",
        },
        {
          code: "1048",
          message: "[DependencyNotFound (dbt1048)]: x\n  --> models/a.sql:1:1",
          severity: "Error",
        },
      ],
    };
    project.errors.reportCompile(compileErrorMessages(notification));
    project.errors.reportCompile(compileErrorMessages(notification));
    expect(window.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(project.errors.current).toContain("FPU_MISSING_VAR");

    project.errors.reportCompile(compileErrorMessages({ errors: [] }));
    expect(project.errors.current).toBeUndefined();
  });

  it("names the configured dbtPath and the version requirement", () => {
    expect(
      formatFusionExecutableResolutionFailure("general", {
        kind: "notFound",
        path: "/missing/dbt",
        source: "configured",
      }),
    ).toBe(
      "fusionPowerUser.dbtPath for general is /missing/dbt, which is not an executable file. " +
        "Fusion Power User needs dbt Fusion 2.0.6 or later.",
    );
    expect(
      formatFusionExecutableResolutionFailure("general", {
        kind: "notFusion",
        raw: "Core:\n  - installed: 1.9.0",
      }),
    ).toBe(
      'The dbt executable for general is not dbt Fusion (dbt --version printed "Core:"). ' +
        "Fusion Power User needs dbt Fusion 2.0.6 or later.",
    );
    expect(
      formatFusionExecutableResolutionFailure("general", {
        kind: "tooOld",
        version: { major: 2, minor: 0, patch: 1, raw: "dbt 2.0.1" },
      }),
    ).toContain("dbt Fusion 2.0.1 for general is too old.");
  });

  it("notifies a missing dbtPath once with Show output", async () => {
    project = buildTestProject(
      root,
      () => {
        throw new Error("no CLI without an executable");
      },
      {
        resolver: {
          resolve: vi.fn(async () => ({
            kind: "notFound" as const,
            path: "/missing/dbt",
            source: "configured" as const,
          })),
        },
      },
    );
    await project.initialize();

    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("fusionPowerUser.dbtPath for "),
      SHOW_OUTPUT,
    );
    expect(project.getAllDiagnostic().map((d) => d.code)).toEqual([
      "fusion-executable",
    ]);
  });

  it("warns, naming the path, when a Declared Project entry has no dbt_project.yml", async () => {
    const log = terminal();
    vi.mocked(workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, fallback?: unknown) =>
        key === "projects" ? ["typo"] : fallback,
      ),
      has: vi.fn(),
      update: vi.fn(),
    } as never);
    const registry = new ProjectRegistry(log);
    await registry.initialize();

    expect(log.warn).toHaveBeenCalledWith(
      "projectRegistry",
      `Declared Project entry typo has no dbt_project.yml at ${path.join(root, "typo")}`,
    );
    registry.dispose();
  });
});

describe("errorHint", () => {
  const none = { profilesDir: undefined, target: undefined };

  it("explains a missing environment variable", () => {
    expect(errorHint(ENV_ERROR, none)).toContain(
      "The editor's environment lacks FPU_MISSING_VAR.",
    );
  });

  it("says nothing it cannot attribute", () => {
    expect(errorHint(PROFILES_ERROR, none)).toBeUndefined();
    expect(errorHint("[error] something else", none)).toBeUndefined();
    expect(errorHint(TARGET_ERROR, none)).toBe(
      "The profile has no output named nope.",
    );
  });
});

describe("ProjectErrors", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows an error again after a different one replaced it", () => {
    const errors = new ProjectErrors(
      Uri.file("/p"),
      () => "p",
      () => {
        throw new Error("no snapshot");
      },
      terminal(),
    );
    const changes = vi.fn();
    errors.onDidChange(changes);
    errors.report("parse", ["[error] a"]);
    errors.report("parse", ["[error] b"]);
    errors.report("parse", ["[error] a"]);
    expect(
      vi.mocked(window.showErrorMessage).mock.calls.map((c) => c[0]),
    ).toEqual(["p: a", "p: b", "p: a"]);
    expect(changes).toHaveBeenCalledTimes(3);
  });

  it("reports a failed CLI compile's config error from its text output, and clears it on a clean exit", () => {
    const errors = new ProjectErrors(
      Uri.file("/p"),
      () => "p",
      () => {
        throw new Error("no snapshot");
      },
      terminal(),
    );
    const stderr =
      "=================== Errors and Warnings ====================\n" +
      `${ENV_ERROR}\n`;
    errors.reportCommand({
      stdout: "",
      stderr,
      fullOutput: stderr,
      exitCode: 1,
    });
    expect(errors.current).toContain("FPU_MISSING_VAR");
    errors.reportCommand({
      stdout:
        "[error] [DependencyNotFound (dbt1048)]: x\n  --> models/a.sql:1:1",
      stderr: "",
      fullOutput: "",
      exitCode: 1,
    });
    expect(errors.current).toContain("FPU_MISSING_VAR");
    errors.reportCommand({
      stdout: "",
      stderr: "",
      fullOutput: "",
      exitCode: 0,
    });
    expect(errors.current).toBeUndefined();
  });

  it("does not repeat an error another source already shows", () => {
    const errors = new ProjectErrors(
      Uri.file("/p"),
      () => "p",
      () => {
        throw new Error("no snapshot");
      },
      terminal(),
    );
    errors.report("parse", ["[error] a"]);
    errors.report("compile", ["[error] a"]);
    expect(window.showErrorMessage).toHaveBeenCalledTimes(1);
    errors.report("parse", []);
    expect(errors.current).toBe("a");
    errors.dispose();
    errors.report("parse", ["[error] c"]);
    expect(window.showErrorMessage).toHaveBeenCalledTimes(1);
  });
});
