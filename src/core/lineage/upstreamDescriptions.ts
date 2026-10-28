import type {
  ColumnRef,
  DescriptionCandidate,
} from "@fusion-power-user/webview-contract/columnProposals";
import type { NodeMetaMap, SourceMetaMap } from "../manifest/types";
import type { ColumnEdge } from "./columnLineage";

/** A described ancestor column, and the trimmed description it carries. */
export interface DescriptionHit {
  description: string;
  source: ColumnRef;
}

/**
 * The described ancestors a column can inherit a description from. The walk follows only `copy` nodes: a
 * described parent is a hit, an undescribed `copy` parent is walked further, and any other parent ends its
 * branch. Columns are matched case-insensitively, and a visited set stops cycles.
 */
export function descriptionCandidates(
  edges: readonly ColumnEdge[],
  start: ColumnRef,
  describe: (ref: ColumnRef) => string | undefined,
): DescriptionHit[] {
  const hits: DescriptionHit[] = [];
  const seen = new Set<string>([keyOf(start)]);
  const walk = (ref: ColumnRef) => {
    if (evolutionOf(edges, ref) !== "copy") {
      return;
    }
    for (const edge of edges) {
      if (keyOf(edge.child) !== keyOf(ref)) {
        continue;
      }
      const parent = edge.parent;
      if (seen.has(keyOf(parent))) {
        continue;
      }
      seen.add(keyOf(parent));
      const description = describe(parent)?.trim();
      if (description) {
        hits.push({ description, source: parent });
      } else {
        walk(parent);
      }
    }
  };
  walk(start);
  return hits;
}

/** Groups hits by their trimmed description, in first-seen order. Equal descriptions give one candidate. */
export function toDescriptionProposal(
  hits: readonly DescriptionHit[],
): DescriptionCandidate[] {
  const byText = new Map<string, DescriptionCandidate>();
  for (const { description, source } of hits) {
    const text = description.trim();
    const candidate = byText.get(text) ?? { description: text, sources: [] };
    if (!candidate.sources.some((s) => keyOf(s) === keyOf(source))) {
      candidate.sources.push(source);
    }
    byText.set(text, candidate);
  }
  return [...byText.values()];
}

/**
 * The manifest description of a model or source column, trimmed, or `undefined` when it is absent or blank.
 * A source column is found under its source group and table; a model column under its node.
 */
export function declaredDescription(
  maps: { nodeMetaMap: NodeMetaMap; sourceMetaMap: SourceMetaMap },
  ref: ColumnRef,
): string | undefined {
  const parts = ref.uniqueId.split(".");
  const columns =
    parts[0] === "source"
      ? maps.sourceMetaMap
          .get(parts[2] ?? "")
          ?.tables.find((table) => table.name === parts[3])?.columns
      : maps.nodeMetaMap.lookupByUniqueId(ref.uniqueId)?.columns;
  const wanted = ref.column.toLowerCase();
  const column = Object.entries(columns ?? {}).find(
    ([name]) => name.toLowerCase() === wanted,
  );
  const text = column?.[1].description.trim();
  return text === "" ? undefined : text;
}

/** The evolution of a column's node, which every edge into that column carries. */
function evolutionOf(edges: readonly ColumnEdge[], ref: ColumnRef) {
  return edges.find((edge) => keyOf(edge.child) === keyOf(ref))?.evolution;
}

function keyOf({ uniqueId, column }: ColumnRef): string {
  return `${uniqueId.toLowerCase()}\u0000${column.toLowerCase()}`;
}
