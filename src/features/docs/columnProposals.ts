import type {
  columnProposals,
  documentationEditor,
} from "@fusion-power-user/webview-contract";
import type { Disposable, Uri } from "vscode";
import { EventEmitter } from "vscode";
import type { DocColumn } from "../../core/columns/typeProposals";
import type { Log } from "../../core/log";
import type { NeedsStrict } from "../../projects/registry/strictNeeded";
import { descriptionPayloadOf, payloadOf } from "./columnProposalPayloads";
import type { ModelRef, TypeSourceProject } from "./columnTypeSource";
import { resolveColumnTypes } from "./columnTypeSource";
import { withProgress } from "./progress";
import type {
  EditorColumn,
  UpstreamDescriptionRequest,
} from "./upstreamDescriptionSource";
import { resolveUpstreamDescriptions } from "./upstreamDescriptionSource";

/** The proposal kinds the service answers. */
export type ProposalKind = "types" | "descriptions";

/** Lets a command ask the documentation editor for proposals; the panel answers when it is ready. */
export class ColumnProposalRequests implements Disposable {
  private readonly emitter = new EventEmitter<{
    kind: ProposalKind;
    uri?: Uri | undefined;
  }>();
  readonly onDidRequest = this.emitter.event;

  request(kind: ProposalKind, uri?: Uri) {
    this.emitter.fire({ kind, uri });
  }

  dispose() {
    this.emitter.dispose();
  }
}

/** The documentation a proposal is made for: the draft's columns when one is unsaved, else the YAML's. */
export interface ProposalTarget {
  model: ModelRef;
  yaml: DocColumn[];
  draft?: DocColumn[] | undefined;
  /** The same columns as `draft` or `yaml` with their descriptions, which the description proposals read. */
  described: EditorColumn[];
  /** The model's node and the manifest that describes its columns. Without a node, no description is proposed. */
  node?:
    | { uniqueId: string; manifest: UpstreamDescriptionRequest["manifest"] }
    | undefined;
  project: TypeSourceProject;
}

/** The name and data type of each column, without a data type the YAML leaves unset. */
function docColumns(
  columns: { name: string; type?: string | null | undefined }[],
): DocColumn[] {
  return columns.map(({ name, type }) => (type ? { name, type } : { name }));
}

/**
 * The proposal target of a documentation: its draft's columns when one is unsaved, else its YAML's, answered by `project`.
 * The node is set only when the documentation has a unique id and the manifest is loaded.
 */
export function proposalTargetOf({
  documentation,
  draft,
  project,
  manifest,
}: {
  documentation: {
    name: string;
    filePath: string;
    uniqueId?: string | undefined;
    columns: documentationEditor.DocumentationColumn[];
  };
  draft: documentationEditor.DocumentationColumn[] | undefined;
  project: TypeSourceProject;
  manifest: UpstreamDescriptionRequest["manifest"] | undefined;
}): ProposalTarget {
  const columns = draft ?? documentation.columns;
  return {
    model: { name: documentation.name, filePath: documentation.filePath },
    yaml: docColumns(documentation.columns),
    draft: draft && docColumns(draft),
    described: columns.map(({ name, description }) => ({
      name,
      description: description ?? "",
    })),
    node:
      documentation.uniqueId && manifest
        ? { uniqueId: documentation.uniqueId, manifest }
        : undefined,
    project,
  };
}

export interface ColumnProposalDeps {
  log: Log;
  columnsNeedStrict: () => NeedsStrict | undefined;
}

/**
 * Answers proposal requests under cancellable progress. A newer request for the same kind and model aborts the older
 * one, and an aborted or superseded request resolves `undefined`.
 */
export class ColumnProposalService {
  /** The newest request per kind and model file. */
  private readonly latest = new Map<string, AbortController>();
  private readonly deps: ColumnProposalDeps;

  constructor(deps: ColumnProposalDeps) {
    this.deps = deps;
  }

  propose(
    kind: "types",
    target: ProposalTarget,
  ): Promise<columnProposals.TypeProposalsPayload | undefined>;
  propose(
    kind: "descriptions",
    target: ProposalTarget,
  ): Promise<columnProposals.DescriptionProposalsPayload | undefined>;
  propose(
    kind: ProposalKind,
    target: ProposalTarget,
  ): Promise<columnProposals.ColumnProposalsPayload | undefined>;
  async propose(
    kind: ProposalKind,
    target: ProposalTarget,
  ): Promise<columnProposals.ColumnProposalsPayload | undefined> {
    const key = `${kind}\0${target.model.filePath}`;
    this.latest.get(key)?.abort();
    const request = new AbortController();
    this.latest.set(key, request);
    try {
      const payload = await withProgress(
        `Describing ${target.model.name}…`,
        (cancelled): Promise<columnProposals.ColumnProposalsPayload> => {
          cancelled.addEventListener("abort", () => request.abort(), {
            once: true,
          });
          return kind === "types"
            ? this.typesFor(target, request.signal)
            : this.descriptionsFor(target, request.signal);
        },
        true,
      );
      return request.signal.aborted || this.latest.get(key) !== request
        ? undefined
        : payload;
    } catch (error) {
      if (request.signal.aborted) {
        return undefined;
      }
      throw error;
    } finally {
      if (this.latest.get(key) === request) {
        this.latest.delete(key);
      }
    }
  }

  private async typesFor(
    target: ProposalTarget,
    signal: AbortSignal,
  ): Promise<columnProposals.TypeProposalsPayload> {
    const needs = this.deps.columnsNeedStrict();
    const outcome = await resolveColumnTypes(target.project, target.model, {
      log: this.deps.log,
      columnsNeedStrict: () => needs,
      signal,
    });
    return payloadOf(target, outcome, needs !== undefined);
  }

  /** The upstream descriptions of the target's columns that have none. Fusion's answer is not cancellable, but the loop stops between answers. */
  private async descriptionsFor(
    target: ProposalTarget,
    signal: AbortSignal,
  ): Promise<columnProposals.DescriptionProposalsPayload> {
    const { model, node } = target;
    if (!node) {
      return {
        kind: "descriptions",
        model: model.filePath,
        proposals: [],
        notice: {
          message: `The project metadata for ${model.name} has not loaded yet; try again after the parse finishes.`,
          type: "error",
        },
      };
    }
    const needs = this.deps.columnsNeedStrict();
    const outcome = await resolveUpstreamDescriptions({
      lsp: target.project.lsp,
      strict: needs === undefined,
      uniqueId: node.uniqueId,
      columns: target.described,
      manifest: node.manifest,
      signal,
    });
    if (outcome.kind === "failed") {
      this.deps.log.error(
        "Docs",
        `Describing ${model.name} from upstream descriptions failed`,
        outcome.error,
      );
    }
    return descriptionPayloadOf(model, outcome, needs);
  }
}
