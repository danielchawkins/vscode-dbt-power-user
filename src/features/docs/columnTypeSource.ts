import * as path from "node:path";
import type { Described } from "../../core/cli";
import type { AnsweredTypes } from "../../core/columns/typeProposals";
import type {
  Attempt,
  TypeSourceOutcome,
} from "../../core/columns/typeSourceMessage";
import type { Log } from "../../core/log";
import { dbColumnsFrom } from "../../core/lsp";
import { errorText } from "../../core/text";
import type { Project } from "../../projects/project/project";
import { whyNotStrict } from "../../projects/registry/schemaOrigin";
import type { NeedsStrict } from "../../projects/registry/strictNeeded";

/** The project's parts the type attempts read. */
export type TypeSourceProject = Pick<Project, "root" | "lsp" | "getFusionCli">;

/** The model whose column types are asked for: its name, and its file, which the language server looks up. */
export interface ModelRef {
  name: string;
  filePath: string;
}

export interface TypeSourceDeps {
  log: Log;
  /** The mode that computes no column lineage, when the effective mode is not strict and a client runs. */
  columnsNeedStrict: () => NeedsStrict | undefined;
  /** Aborts the attempts. An abort rethrows rather than being recorded as a failed attempt. */
  signal?: AbortSignal | undefined;
}

interface Answer {
  attempt: Attempt;
  answered?: AnsweredTypes;
}

/**
 * Asks the sources for a model's column types in order: target, then deferred when defer is on, then inferred. The
 * first source that answers ends the chain. An empty describe result is `missing`, a thrown attempt is `failed` and
 * its error goes to the log, and the chain goes on.
 */
export async function resolveColumnTypes(
  project: TypeSourceProject,
  model: ModelRef,
  deps: TypeSourceDeps,
): Promise<TypeSourceOutcome> {
  const cli = project.getFusionCli();
  const attempts: Attempt[] = [];
  const target = await describeAttempt(
    "target",
    () => cli.describeModel(model.name, "target", deps.signal),
    { model, deps },
  );
  attempts.push(target.attempt);
  if (target.answered) {
    return outcome(attempts, target.answered);
  }

  const defer = cli.deferState();
  if (defer.kind === "on") {
    const deferred = await describeAttempt(
      "deferred",
      () => cli.describeModel(model.name, "deferred", deps.signal),
      { model, deps, state: defer.stateDirectory },
    );
    attempts.push(deferred.attempt);
    if (deferred.answered) {
      return outcome(attempts, deferred.answered);
    }
  } else {
    attempts.push({
      source: "deferred",
      result: "notConfigured",
      detail: defer.kind,
      ...(defer.kind === "unusable" ? { state: defer.manifestPath } : {}),
    });
  }

  const inferred = await inferredAttempt(project, model, deps);
  attempts.push(inferred.attempt);
  return outcome(attempts, inferred.answered);
}

function outcome(
  attempts: Attempt[],
  answered: AnsweredTypes | undefined,
): TypeSourceOutcome {
  return answered ? { attempts, answered } : { attempts };
}

/** The `scope` names the model and the deferred state directory, which the answer records when it is set. */
async function describeAttempt(
  source: "target" | "deferred",
  describe: () => Promise<Described>,
  scope: { model: ModelRef; deps: TypeSourceDeps; state?: string },
): Promise<Answer> {
  const { model, deps } = scope;
  try {
    const { target, relation, columns } = await describe();
    const found = {
      target,
      relation,
      ...(scope.state === undefined ? {} : { state: scope.state }),
    };
    return columns.length === 0
      ? { attempt: { source, result: "missing", ...found } }
      : {
          attempt: { source, result: "answered", ...found },
          answered: { source, ...found, columns },
        };
  } catch (error) {
    deps.signal?.throwIfAborted();
    deps.log.error(
      "Docs",
      `Describing ${model.name} from the ${source} source failed`,
      error,
    );
    return {
      attempt: { source, result: "failed", detail: errorText(error) },
    };
  }
}

async function inferredAttempt(
  project: TypeSourceProject,
  model: ModelRef,
  deps: TypeSourceDeps,
): Promise<Answer> {
  deps.signal?.throwIfAborted();
  if (project.lsp.state === "running") {
    const relative = path
      .relative(project.root.fsPath, model.filePath)
      .split(path.sep)
      .join("/");
    try {
      const columns = dbColumnsFrom(
        await project.lsp.getCurrentNode(relative, { purpose: "columns" }),
      );
      if (columns) {
        return {
          attempt: { source: "inferred", result: "answered" },
          answered: { source: "inferred", columns },
        };
      }
    } catch (error) {
      deps.log.error(
        "Docs",
        `Inferring the columns of ${model.name} failed`,
        error,
      );
      return {
        attempt: {
          source: "inferred",
          result: "failed",
          detail: errorText(error),
        },
      };
    }
  }
  return {
    attempt: {
      source: "inferred",
      result: "unavailable",
      detail: unavailableReason(project, model, deps),
    },
  };
}

/** Why the inferred types are unavailable: the static-analysis mode, the client, or the model's columns. */
function unavailableReason(
  project: TypeSourceProject,
  model: ModelRef,
  deps: TypeSourceDeps,
): string {
  const needs = deps.columnsNeedStrict();
  if (needs) {
    return `static analysis is ${needs.mode}, not strict: ${whyNotStrict(needs.setting, needs.folder)}`;
  }
  if (project.lsp.state !== "running") {
    return "the Fusion language server is not running";
  }
  return `the language server has no columns for \`${model.name}\``;
}
