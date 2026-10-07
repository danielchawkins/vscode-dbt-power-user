import { readFileSync } from "fs";
import { CodeLens, commands, ProgressLocation, Uri, window } from "vscode";
import type { RegisterCommand } from "../../commandRegistry";
import { previewSql, type FusionCte } from "../../core/cte/ctePreview";
import type { Log } from "../../core/log";
import {
  notifyError,
  notifyErrorWithoutProject,
} from "../../projects/notifications";
import type { Projects } from "../../projects/projects";
import type { CteProfilerDecorationProvider } from "./cteProfilerDecorationProvider";
import type { CteProfilerService } from "./cteProfilerService";

export interface CteCommandDeps {
  projects: Projects;
  /** Runs `query` for `uri` on the query panel under `name`. */
  runModel: {
    executeSQL(uri: Uri, query: string, name: string): unknown;
  };
  cteProfilerService: CteProfilerService;
  cteProfilerDecorationProvider: CteProfilerDecorationProvider;
  log: Log;
  register: RegisterCommand;
}

/** The CTEs the server's lenses offer for `docUri`; from the palette there is no argument to read them from. */
async function ctesFromLenses(docUri: Uri): Promise<FusionCte[] | undefined> {
  const lenses =
    (await commands.executeCommand<CodeLens[]>(
      "vscode.executeCodeLensProvider",
      docUri,
    )) ?? [];
  return lenses.find(
    (lens) => lens.command?.command === "fusionPowerUser.profileCtes",
  )?.command?.arguments?.[1] as FusionCte[] | undefined;
}

async function profileCtes(
  { cteProfilerService, log }: CteCommandDeps,
  docUri: Uri,
  ctes: FusionCte[],
) {
  const totalCtes = ctes.length;
  await window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: `Profiling ${totalCtes} CTE${totalCtes === 1 ? "" : "s"}`,
      cancellable: true,
    },
    async (progress, token) => {
      // Forward notification cancel to the service's own token.
      token.onCancellationRequested(() => cteProfilerService.cancel());
      // Report per-CTE increments as the service fires result updates.
      let lastCount = 0;
      const progressSub = cteProfilerService.onResultChanged((result) => {
        if (!result || result.uri !== docUri.toString()) {
          return;
        }
        const done = result.ctes.length;
        if (done <= lastCount) {
          return;
        }
        const delta = done - lastCount;
        lastCount = done;
        progress.report({
          increment: (delta / totalCtes) * 100,
          message: `${done}/${totalCtes} — ${result.ctes[done - 1]?.name ?? ""}`,
        });
      });
      try {
        await cteProfilerService.profileModel(docUri, ctes);
      } catch (error) {
        log.error("profileCtesError", "Unable to profile CTEs", error);
      } finally {
        progressSub.dispose();
      }
    },
  );
}

async function runCte(
  { projects, runModel, log }: CteCommandDeps,
  uri: Uri,
  cte: FusionCte,
) {
  try {
    const query = previewSql(readFileSync(cte.compiledPath), cte);
    const hash = Date.now().toString(36).slice(-6);
    await runModel.executeSQL(uri, query, `cte_${cte.name}_${hash}`);
  } catch (error) {
    log.error("CteExecution", "Unable to execute CTE", error);
    void notifyError(projects.get(uri), "Failed to execute CTE", error);
  }
}

/** Commands that profile and run the CTEs of a model. */
export function registerCteCommands(deps: CteCommandDeps) {
  const { register, cteProfilerService, cteProfilerDecorationProvider } = deps;
  return [
    register(
      "fusionPowerUser.profileCtes",
      async (uri?: Uri, ctes?: FusionCte[]) => {
        const docUri = uri ?? window.activeTextEditor?.document.uri;
        if (!docUri) {
          void notifyErrorWithoutProject("No active SQL file to profile");
          return;
        }
        const found = ctes ?? (await ctesFromLenses(docUri));
        if (!found || found.length === 0) {
          void window.showInformationMessage(
            "No CTEs found in this file to profile. Save the file first.",
          );
          return;
        }
        await profileCtes(deps, docUri, found);
      },
    ),
    register("fusionPowerUser.cancelCteProfiling", () =>
      cteProfilerService.cancel(),
    ),
    register("fusionPowerUser.clearProfileResults", () =>
      cteProfilerService.clearResults(),
    ),
    register("fusionPowerUser.toggleProfileDecorations", () =>
      cteProfilerDecorationProvider.toggle(),
    ),
    register(
      "fusionPowerUser.runCteWithDependencies",
      (target: { uri: Uri; cte: FusionCte }) =>
        runCte(deps, target.uri, target.cte),
    ),
  ];
}
