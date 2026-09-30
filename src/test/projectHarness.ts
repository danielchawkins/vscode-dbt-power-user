import { vi } from "vitest";
import { Uri } from "vscode";
import { DBTProjectLog } from "../dbt_client/dbtProjectLog";
import { DBTTerminal } from "../dbt_integration";
import { FusionCommandIntegrationFactory } from "../fusion/executableLifecycle";
import {
  FusionExecutable,
  FusionExecutableResolver,
} from "../fusion/fusionExecutable";
import { ManifestParsers } from "../projects/manifest";
import { Project, ProjectOptions } from "../projects/project";
import { RunHistoryService } from "../projects/runHistoryService";
import { SharedStateService } from "../projects/sharedStateService";

/** A Fusion 2.0.5 executable at `executablePath`. */
export function sampleExecutable(
  executablePath = "/mock/bin/dbt",
  env: Record<string, string> = process.env as Record<string, string>,
): FusionExecutable {
  return {
    path: executablePath,
    version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5\n" },
    env,
  };
}

/** A resolver that always returns `sampleExecutable()`. */
export function stubResolver(): FusionExecutableResolver {
  return { resolve: vi.fn(async () => sampleExecutable()) };
}

/** Builds a `Project` with inert collaborators; `overrides` replaces any of them. */
export function buildTestProject(
  root: string,
  cliFactory: FusionCommandIntegrationFactory,
  overrides: Partial<ProjectOptions> = {},
): Project {
  return new Project({
    dbtProjectLogFactory: () =>
      ({ dispose: vi.fn() }) as unknown as DBTProjectLog,
    terminal: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as DBTTerminal,
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
