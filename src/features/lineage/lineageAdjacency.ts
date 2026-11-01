import type { GraphMetaMap, NodeGraphMap } from "../../core/manifest/types";

/** Which way a table's neighbours run: `children` are the tables it feeds, `parents` the tables it reads. */
export type Direction = "parents" | "children";

/** One data-flow neighbour: its unique ID, and the URL of its file when the graph carries one. */
export interface AdjacentNode {
  key: string;
  url: string | undefined;
}

const NO_EXCLUSIONS: ReadonlySet<string> = new Set();

/** The neighbours of each table in one direction, without foreign-key-only edges or excluded nodes. */
function neighbourLists(
  map: NodeGraphMap,
  excluded: ReadonlySet<string>,
): Map<string, AdjacentNode[]> {
  const lists = new Map<string, AdjacentNode[]>();
  for (const [key, { nodes }] of map) {
    if (excluded.has(key)) {
      continue;
    }
    lists.set(
      key,
      // Foreign-key-only edges are left out: the parent is referenced by a declared FK constraint but never read by
      // the model's SQL, so it is not a data-flow edge. The dependency graph keeps them for build order and impact.
      nodes
        .filter((n) => n.edgeType !== "constraint" && !excluded.has(n.key))
        .map(({ key: nodeKey, url }) => ({ key: nodeKey, url })),
    );
  }
  return lists;
}

/**
 * The host's one view of data-flow adjacency: which tables a table is wired to, in each direction, and which edges
 * the lineage view draws. It decides what is left out, in one place: foreign-key-only edges, and every node in
 * `excluded`. An excluded node takes its edges with it, and its parents are not linked to its children.
 *
 * The whole-project request, the neighbourhood requests and the card counts all read this view, so they agree on
 * the same edges for the same tables.
 */
export class LineageAdjacency {
  private readonly lists: Record<Direction, Map<string, AdjacentNode[]>>;
  private readonly urls = new Map<string, string>();

  constructor(
    graphMetaMap: GraphMetaMap,
    excluded: ReadonlySet<string> = NO_EXCLUSIONS,
  ) {
    this.lists = {
      parents: neighbourLists(graphMetaMap.parents, excluded),
      children: neighbourLists(graphMetaMap.children, excluded),
    };
    for (const map of [graphMetaMap.parents, graphMetaMap.children]) {
      for (const { nodes } of map.values()) {
        for (const node of nodes) {
          if (node.url !== undefined && !excluded.has(node.key)) {
            this.urls.set(node.key, node.url);
          }
        }
      }
    }
  }

  /** Whether the graph has `key` in `direction`; an excluded table has none. */
  has(direction: Direction, key: string): boolean {
    return this.lists[direction].has(key);
  }

  /** The neighbours of `key` in `direction`, in the graph's order. */
  neighbours(direction: Direction, key: string): AdjacentNode[] {
    return this.lists[direction].get(key) ?? [];
  }

  /** How many data-flow neighbours `key` has in `direction`. */
  count(direction: Direction, key: string): number {
    return this.neighbours(direction, key).length;
  }

  /** Every table the graph holds in either direction, in the graph's order, without the excluded ones. */
  tableKeys(): string[] {
    return [
      ...new Set([...this.lists.parents.keys(), ...this.lists.children.keys()]),
    ];
  }

  /** The URL of `key`'s file as any edge carries it, when one does. */
  urlOf(key: string): string | undefined {
    return this.urls.get(key);
  }

  /** The data-flow `[parent, child]` pairs with both ends in `tables`. */
  edgesAmong(tables: Iterable<string>): [string, string][] {
    const ids = new Set(tables);
    const edges: [string, string][] = [];
    for (const parent of ids) {
      for (const child of this.neighbours("children", parent)) {
        if (ids.has(child.key)) {
          edges.push([parent, child.key]);
        }
      }
    }
    return edges;
  }
}
