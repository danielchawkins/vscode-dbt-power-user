import { readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  lineageLayersBands,
  lineageLayersCardIds,
  lineageLayersDrawnEdges,
  lineageLayersEdges,
  lineageLayersIds,
  lineageLayersRefs,
  lineageLayersStart,
  lineageLayersTables,
} from "../../../webviews/src/test/fixtures/lineageLayers";
import { inferLayer } from "../../core/manifest/modelLayer";
import { esmDirname } from "../esmDirname";
// ast-grep-ignore: ts-suite-no-harness-import -- reads the lineage layers expectations the smoke run checks
import * as smoke from "../smoke/lineageLayersExpected";

interface Relationship {
  from_columns: string[];
  to_columns: string[];
  to: string;
}

interface Meta {
  lineage?: { hidden?: boolean };
  relationships?: Relationship[];
}

interface YamlEntry {
  name: string;
  config?: { meta?: Meta };
}

interface YamlFile {
  models?: YamlEntry[];
  seeds?: YamlEntry[];
  sources?: { name: string; tables: YamlEntry[] }[];
}

type DbtNode = {
  id: string;
  name: string;
  meta?: Meta | undefined;
} & ({ kind: "model" | "seed"; path: string } | { kind: "source" });

const PROJECT = path.join(
  esmDirname(import.meta.url),
  "../fixtures/lineage-layers",
);
const LAYER_OPTIONS = { tagPrefix: "layer/", fromPath: true };
const REF_CALL = /\bref\(\s*["']([^"']+)["']\s*\)/g;
const SOURCE_CALL =
  /\bsource\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/g;
const REF_TARGET = /^ref\(\s*["']([^"']+)["']\s*\)$/;

const read = (file: string): string =>
  readFileSync(path.join(PROJECT, file), "utf8");
const files = readdirSync(PROJECT, { recursive: true })
  .map(String)
  .map((file) => file.split(path.sep).join("/"))
  .toSorted();
const packageName = (parse(read("dbt_project.yml")) as { name: string }).name;

// Models and seeds by name, and source tables by `source.table`, from the YAML beside them.
const entries = new Map<string, YamlEntry>();
const sourceTables = new Map<string, YamlEntry>();
for (const file of files.filter((f) => /^(models|seeds)\/.*\.ya?ml$/.test(f))) {
  const doc = parse(read(file)) as YamlFile;
  for (const entry of [...(doc.models ?? []), ...(doc.seeds ?? [])]) {
    entries.set(entry.name, entry);
  }
  for (const source of doc.sources ?? []) {
    for (const table of source.tables) {
      sourceTables.set(`${source.name}.${table.name}`, table);
    }
  }
}

const nodes: DbtNode[] = [
  ...files
    .filter((f) => /^models\/.*\.sql$/.test(f))
    .map((file): DbtNode => {
      const name = path.basename(file, ".sql");
      return {
        id: `model.${packageName}.${name}`,
        kind: "model",
        name,
        path: file,
        meta: entries.get(name)?.config?.meta,
      };
    }),
  ...files
    .filter((f) => /^seeds\/.*\.csv$/.test(f))
    .map((file): DbtNode => {
      const name = path.basename(file, ".csv");
      return {
        id: `seed.${packageName}.${name}`,
        kind: "seed",
        name,
        path: file,
        meta: entries.get(name)?.config?.meta,
      };
    }),
  ...Array.from(sourceTables, ([key, table]): DbtNode => ({
    id: `source.${packageName}.${key}`,
    kind: "source",
    name: table.name,
    meta: table.config?.meta,
  })),
];

const nodeIdByName = new Map(
  nodes
    .filter((node) => node.kind !== "source")
    .map((node) => [node.name, node.id]),
);
const refId = (name: string): string => {
  const id = nodeIdByName.get(name);
  if (id === undefined) {
    throw new Error(`ref('${name}') names no model or seed in the project`);
  }
  return id;
};
const refName = (target: string): string => {
  const name = REF_TARGET.exec(target)?.[1];
  if (name === undefined) {
    throw new Error(`relationship target ${target} is not a ref()`);
  }
  return name;
};

// The layer a model card shows, as `nodeTable` infers it: the folder or name prefix, with no tags in this project.
const layerOf = (node: DbtNode): string | undefined =>
  node.kind === "model"
    ? inferLayer({ path: node.path, name: node.name }, LAYER_OPTIONS)
    : undefined;

const edges: [string, string][] = [];
const seenEdges = new Set<string>();
const addEdge = (parent: string, child: string): void => {
  if (!seenEdges.has(`${parent} -> ${child}`)) {
    seenEdges.add(`${parent} -> ${child}`);
    edges.push([parent, child]);
  }
};
for (const node of nodes) {
  if (node.kind !== "model") {
    continue;
  }
  const sql = read(node.path);
  for (const match of sql.matchAll(REF_CALL)) {
    addEdge(refId(match[1]), node.id);
  }
  for (const match of sql.matchAll(SOURCE_CALL)) {
    addEdge(`source.${packageName}.${match[1]}.${match[2]}`, node.id);
  }
}

/** One end of a relationship: a node and the columns it joins on. */
interface RelationshipEnd {
  table: string;
  columns: readonly string[];
}

const relationshipKey = (from: RelationshipEnd, to: RelationshipEnd): string =>
  `${from.table}(${from.columns.join(",")}) -> ${to.table}(${to.columns.join(",")})`;
const dbtRelationships = nodes.flatMap((node) =>
  (node.meta?.relationships ?? []).map((rel) =>
    relationshipKey(
      { table: node.id, columns: rel.from_columns },
      { table: refId(refName(rel.to)), columns: rel.to_columns },
    ),
  ),
);
const dbtHidden = nodes
  .filter((node) => node.meta?.lineage?.hidden === true)
  .map((node) => node.id);
const edgeKey = ([parent, child]: [string, string]): string =>
  `${parent} -> ${child}`;

describe("lineage-layers fixture against its dbt project", () => {
  it("has the dbt project's models, seeds and source tables, by ID", () => {
    const ids = nodes.map((node) => node.id).toSorted();
    expect(lineageLayersTables.map((table) => table.table).toSorted()).toEqual(
      ids,
    );
    expect(Object.values(lineageLayersIds).toSorted()).toEqual(ids);
  });

  it("gives each card the name its dbt node has", () => {
    expect(lineageLayersCardIds.toSorted()).toEqual(
      nodes.map((node) => node.name).toSorted(),
    );
  });

  it("puts each table in the layer its dbt folder or name gives", () => {
    const expected = Object.fromEntries(
      nodes.map((node) => [node.id, layerOf(node)]),
    );
    const actual = Object.fromEntries(
      lineageLayersTables.map((table) => [table.table, table.layer]),
    );
    expect(actual).toEqual(expected);
  });

  it("draws the bands the dbt layers give: sources, the layers, then other", () => {
    const layers = [
      ...new Set(nodes.map(layerOf).filter((layer) => layer !== undefined)),
    ];
    const untagged = nodes.some(
      (node) => node.kind === "model" && layerOf(node) === undefined,
    );
    const expected = ["source", ...layers, ...(untagged ? ["other"] : [])];
    expect(lineageLayersBands.toSorted()).toEqual(expected.toSorted());
  });

  it("has the edges the ref() and source() calls make", () => {
    expect(lineageLayersEdges.map(edgeKey).toSorted()).toEqual(
      edges.map(edgeKey).toSorted(),
    );
  });

  it("declares the relationships the YAML meta sets", () => {
    expect(
      lineageLayersRefs
        .map((ref) => relationshipKey(ref.from, ref.to))
        .toSorted(),
    ).toEqual(dbtRelationships.toSorted());
  });

  it("hides the tables the YAML meta hides", () => {
    expect(
      lineageLayersTables
        .filter((table) => table.hidden)
        .map((table) => table.table)
        .toSorted(),
    ).toEqual(dbtHidden.toSorted());
  });

  it("draws the dbt edges that touch no hidden table", () => {
    const hidden = new Set(dbtHidden);
    const drawn = edges.filter(
      ([parent, child]) => !hidden.has(parent) && !hidden.has(child),
    );
    expect(lineageLayersDrawnEdges.map(edgeKey).toSorted()).toEqual(
      drawn.map(edgeKey).toSorted(),
    );
  });

  it("starts from a dbt model", () => {
    expect(nodes.map((node) => node.id)).toContain(
      `model.${packageName}.${lineageLayersStart}`,
    );
  });

  it("matches what the lineage-layers smoke expects to see drawn", () => {
    expect(smoke.START).toBe(lineageLayersStart);
    expect(smoke.CARD_IDS.toSorted()).toEqual(lineageLayersCardIds.toSorted());
    expect(smoke.LAYER_BANDS).toEqual(lineageLayersBands);
    expect(smoke.DRAWN_TABLE_EDGES).toBe(lineageLayersDrawnEdges.length);
  });
});
