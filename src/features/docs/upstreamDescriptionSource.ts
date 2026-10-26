import { CancellationTokenSource } from "vscode";
import {
  type ColumnRef,
  columnEdges,
  columnLineageArgs,
} from "../../core/lineage/columnLineage";
import {
  type DescriptionCandidate,
  declaredDescription,
  descriptionCandidates,
  toDescriptionProposal,
} from "../../core/lineage/upstreamDescriptions";
import type { ListNodesResult } from "../../core/lsp";
import type { NodeMetaMap, SourceMetaMap } from "../../core/manifest/types";
import type { FusionCommands } from "../../fusion/fusionCommands";

/** A column of the model in the editor, with the description it has now. */
export interface EditorColumn {
  name: string;
  description: string;
}

export interface UpstreamDescriptionRequest {
  lsp: Pick<FusionCommands, "state" | "listNodes">;
  /** Whether the effective static analysis mode is strict; only strict computes column lineage. */
  strict: boolean;
  uniqueId: string;
  columns: readonly EditorColumn[];
  manifest: { nodeMetaMap: NodeMetaMap; sourceMetaMap: SourceMetaMap };
  /** Aborts the walk: the answer in flight is cancelled, and no further column is asked about. */
  signal?: AbortSignal;
}

interface ColumnDescriptionProposal {
  column: string;
  candidates: DescriptionCandidate[];
}

export type UpstreamDescriptionOutcome =
  | { kind: "notRunning"; state: FusionCommands["state"] }
  | { kind: "needsStrict" }
  /** A `listNodes` request was rejected; the walk stops there and keeps the proposals found for the columns before it. */
  | {
      kind: "failed";
      message: string;
      error: unknown;
      proposals: ColumnDescriptionProposal[];
    }
  /** `asked` is how many columns without a description Fusion was asked about; 0 when every column is described. */
  | { kind: "found"; asked: number; proposals: ColumnDescriptionProposal[] };

/**
 * Proposes descriptions for the editor's columns that have none, from the first described copy ancestor of
 * each. Asks Fusion for one column's lineage at a time. Columns with no described ancestor get no proposal.
 */
export async function resolveUpstreamDescriptions({
  lsp,
  strict,
  uniqueId,
  columns,
  manifest,
  signal,
}: UpstreamDescriptionRequest): Promise<UpstreamDescriptionOutcome> {
  if (lsp.state !== "running") {
    return { kind: "notRunning", state: lsp.state };
  }
  if (!strict) {
    return { kind: "needsStrict" };
  }
  const describe = (ref: ColumnRef) => declaredDescription(manifest, ref);
  const proposals: ColumnDescriptionProposal[] = [];
  const blank = columns.filter((c) => c.description.trim() === "");
  // The walk's requests share one token: an abort cancels the answer in flight and leaves the lane.
  const cancel = new CancellationTokenSource();
  const abort = () => cancel.cancel();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for (const { name } of blank) {
      if (signal?.aborted) {
        break;
      }
      let answer: ListNodesResult;
      try {
        answer = await lsp.listNodes(columnLineageArgs(uniqueId, name), {
          purpose: "columnLineage",
          token: cancel.token,
        });
      } catch (error) {
        if (signal?.aborted) {
          break;
        }
        return {
          kind: "failed",
          message: errorMessage(error),
          error,
          proposals,
        };
      }
      const edges = columnEdges(answer);
      const candidates = toDescriptionProposal(
        descriptionCandidates(edges, { uniqueId, column: name }, describe),
      );
      if (candidates.length > 0) {
        proposals.push({ column: name, candidates });
      }
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    cancel.dispose();
  }
  return { kind: "found", asked: blank.length, proposals };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
