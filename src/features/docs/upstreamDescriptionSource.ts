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
}

interface ColumnDescriptionProposal {
  column: string;
  candidates: DescriptionCandidate[];
}

export type UpstreamDescriptionOutcome =
  | { kind: "notRunning"; state: FusionCommands["state"] }
  | { kind: "needsStrict" }
  | { kind: "found"; proposals: ColumnDescriptionProposal[] };

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
}: UpstreamDescriptionRequest): Promise<UpstreamDescriptionOutcome> {
  if (lsp.state !== "running") {
    return { kind: "notRunning", state: lsp.state };
  }
  if (!strict) {
    return { kind: "needsStrict" };
  }
  const describe = (ref: ColumnRef) => declaredDescription(manifest, ref);
  const proposals: ColumnDescriptionProposal[] = [];
  for (const { name } of columns.filter((c) => c.description.trim() === "")) {
    const edges = columnEdges(
      await lsp.listNodes(columnLineageArgs(uniqueId, name)),
    );
    const candidates = toDescriptionProposal(
      descriptionCandidates(edges, { uniqueId, column: name }, describe),
    );
    if (candidates.length > 0) {
      proposals.push({ column: name, candidates });
    }
  }
  return { kind: "found", proposals };
}
