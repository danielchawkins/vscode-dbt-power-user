import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { vi } from "vitest";
import {
  type ConfigurationChangeEvent,
  EventEmitter,
  Uri,
  type WorkspaceFolder,
  workspace,
} from "vscode";
import type { Log } from "../core/log";
import type {
  CommandProcessExecution,
  CommandProcessExecutionFactory,
} from "../fusion/commandProcessExecution";
import { FusionCommandIntegrationFactory } from "../fusion/executableLifecycle";
import type { FusionCli } from "../fusion/fusionCli";
import {
  DBT_PATH_SETTING,
  FusionExecutable,
  FusionExecutableResolver,
} from "../fusion/fusionExecutable";
import { ManifestParsers } from "../projects/manifest";
import { Project, ProjectOptions } from "../projects/project";
import type { DeclaredProject } from "../projects/projectRegistry";
import { RunHistoryService } from "../projects/runHistoryService";
import { SharedStateService } from "../projects/sharedStateService";
import { CONFIGURATION_SECTION } from "../settings";
import { silentLog } from "./testLog";

/** A Fusion 2.0.6 executable at `executablePath`. */
export function sampleExecutable(
  executablePath = "/mock/bin/dbt",
  env: Record<string, string> = process.env as Record<string, string>,
): FusionExecutable {
  return {
    path: executablePath,
    version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6\n" },
    env,
  };
}

/** A resolver that always returns `sampleExecutable()`. */
function stubResolver(): FusionExecutableResolver {
  return { resolve: vi.fn(async () => sampleExecutable()) };
}

/** Builds a `Project` with inert collaborators; `overrides` replaces any of them. */
export function buildTestProject(
  root: string,
  cliFactory: FusionCommandIntegrationFactory,
  overrides: Partial<ProjectOptions> = {},
): Project {
  return new Project({
    terminal: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Log,
    sharedState: {} as SharedStateService,
    runHistoryService: {
      addEntry: vi.fn(),
      notifyCommandFailed: vi.fn(),
    } as unknown as RunHistoryService,
    resolver: stubResolver(),
    cliFactory,
    parsers: {} as ManifestParsers,
    projectRoot: Uri.file(root),
    ...overrides,
  });
}

/** A Declared Project named `name` at `rootPath` in `folder`, which contains no file. */
export function declaredProject(
  name: string,
  rootPath: string,
  folder: WorkspaceFolder,
): DeclaredProject {
  return {
    root: Uri.file(rootPath),
    name,
    folder,
    contains: () => false,
    dispose: () => {},
  };
}

/** What an executable resolver may answer. */
export type Verdict =
  FusionExecutable | { kind: "notFound"; path: string; source: "configured" };

/** A resolver verdict for a configured `dbt` path that does not exist. */
export function notFound(missingPath: string): Verdict {
  return { kind: "notFound", path: missingPath, source: "configured" };
}

/**
 * Environments that resolve at once to `env`. `changed` fires `onDidChange` for a project; `ensure` records each
 * call.
 */
export function fakeProjectEnvironments(env: Record<string, string> = {}) {
  const changed = new EventEmitter<DeclaredProject>();
  const environment = {
    env,
    source: "host",
    result: { kind: "none" },
  } as const;
  return {
    ensure: vi.fn(async (_project: DeclaredProject) => environment),
    peek: vi.fn((_project: DeclaredProject) => environment),
    onDidChange: changed.event,
    changed,
  };
}

/** A configuration change that affects only `dbtPath` in the workspace folder at `root`. */
function pathChangeEvent(root: string): ConfigurationChangeEvent {
  return {
    affectsConfiguration: (section: string, scope?: Uri) =>
      section === `${CONFIGURATION_SECTION}.${DBT_PATH_SETTING}` &&
      scope?.fsPath === root,
  };
}

/**
 * Captures configuration listeners so a test can fire scoped `dbtPath` changes. Call it in `beforeEach`; the spy
 * goes away with `vi.restoreAllMocks()`.
 */
export function captureConfigChanges(): { changePath(root: string): void } {
  const listeners: Array<(event: ConfigurationChangeEvent) => void> = [];
  vi.spyOn(workspace, "onDidChangeConfiguration").mockImplementation(
    (listener) => {
      listeners.push(listener as (event: ConfigurationChangeEvent) => void);
      return { dispose: vi.fn() };
    },
  );
  return {
    changePath: (root) =>
      listeners.forEach((listener) => listener(pathChangeEvent(root))),
  };
}

const projectRoots: string[] = [];
const projects: Project[] = [];

/** A temporary dbt project root. `cleanUpProjects()` removes it. */
export function createProjectRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `fusion-${prefix}-`));
  for (const dir of ["models", "macros", "seeds"]) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  fs.writeFileSync(
    path.join(root, "dbt_project.yml"),
    "name: cli_test\nversion: 1.0.0\n",
  );
  projectRoots.push(root);
  return root;
}

/** Disposes every project from `buildIntegration` and removes every root from `createProjectRoot`. */
export async function cleanUpProjects(): Promise<void> {
  await Promise.all(projects.splice(0).map((project) => project.dispose()));
  for (const root of projectRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** A command execution factory that records each call's options and completes with exit code 0. */
export function recordingExecutionFactory(): {
  factory: CommandProcessExecutionFactory;
  calls: Array<Record<string, unknown>>;
} {
  const calls: Array<Record<string, unknown>> = [];
  const execution = {
    complete: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    dispose: vi.fn(),
  } as unknown as CommandProcessExecution;
  const factory = {
    createCommandProcessExecution: vi.fn((options: Record<string, unknown>) => {
      calls.push(options);
      return execution;
    }),
  } as unknown as CommandProcessExecutionFactory;
  return { factory, calls };
}

/** An inert `FusionCli` for the project at `root`; `hooks` replaces any member. */
export function stubFusionCli(
  root: string,
  hooks: Partial<FusionCli> = {},
): FusionCli {
  const stub: Partial<FusionCli> = {
    refreshProjectConfig: vi.fn(async () => undefined),
    rebuildManifest: vi.fn(async () => undefined),
    dispose: vi.fn(),
    getDiagnostics: () => ({
      projectConfigDiagnostics: [],
      rebuildManifestDiagnostics: [],
    }),
    getProjectName: () => "cli_test",
    getModelPaths: () => [path.join(root, "models")],
    getMacroPaths: () => [path.join(root, "macros")],
    getSeedPaths: () => [path.join(root, "seeds")],
    getTargetPath: () => path.join(root, "target"),
    run: vi.fn(async () => ({ stdout: "", stderr: "", fullOutput: "" })),
    ...hooks,
  };
  return stub as FusionCli;
}

/** A `Project` at `root` whose resolver answers `resolve()`. `cleanUpProjects()` disposes it. */
export function buildIntegration(
  root: string,
  resolve: () => Promise<Verdict>,
  cliFactory: FusionCommandIntegrationFactory,
): Project {
  const project = buildTestProject(root, cliFactory, {
    resolver: { resolve: vi.fn(async () => resolve()) },
    terminal: silentLog(),
  });
  projects.push(project);
  return project;
}
