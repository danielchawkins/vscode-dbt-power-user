import type { lineage } from "@fusion-power-user/webview-contract";
import * as path from "node:path";
import { type CancellationToken, Uri, workspace } from "vscode";
import type {
  ColumnEdge,
  ColumnLineage,
  InferredColumn,
} from "../../core/lineage";
import {
  columnEdges,
  columnLineageArgs,
  inferredColumns,
  toPanelLineage,
} from "../../core/lineage";
import type { ListNodesResult } from "../../core/lsp";
import type {
  NeedsStrict,
  StrictInputs,
} from "../../core/snapshot/strictNeeded";
import {
  needsStrict,
  STRICT_FIX,
  strictNeededMessage,
} from "../../core/snapshot/strictNeeded";
import { failureSummary } from "../../core/text";
import type {
  FusionClient,
  FusionClientState,
} from "../../fusion/fusionClient";
import type { FusionCommands } from "../../fusion/fusionCommands";
import type { Manifest } from "../../projects/manifest/manifestTypes";
import type { CurrentProject } from "../../projects/project/currentProject";
import { readSetting } from "../../settings";
import { type Direction, LineageAdjacency } from "./lineageAdjacency";
import { lineageTable } from "./lineageTables";

/** The lineage component's `getConnectedColumns` body, restricted to the fields this service reads. */
export interface ConnectedColumnsRequest {
  /** `[table, column]` pairs; the table is the node's unique ID, as `createTable` keys it. */
  targets: [string, string][];
  /** The component's right-hand expansion: true asks for the targets' children, false for their parents. */
  upstreamExpansion: boolean;
}

/** Why a request produced no column lineage. */
export type NoLineage =
  | {
      kind: "notRunning";
      state: FusionClientState;
      failure?: string | undefined;
    }
  /** No column nodes while the project's effective mode computes none. */
  | ({ kind: "staticAnalysis" } & NeedsStrict)
  | { kind: "empty" }
  | { kind: "failed"; message: string };

export type ConnectedColumnsResult =
  | {
      kind: "lineage";
      columnLineage: ColumnLineage[];
      /** Targets whose request failed while others answered. */
      failures?: TargetFailure[];
    }
  | { kind: "noLineage"; reason: NoLineage };

export interface TargetFailure {
  target: [string, string];
  message: string;
}

/** One sentence for the panel's per-table tooltip. */
export function describeNoLineage(reason: NoLineage): string {
  switch (reason.kind) {
    case "notRunning":
      return `The dbt Fusion language server for this project is ${reason.state}; column lineage needs it running.${
        reason.failure ? ` ${reason.failure}` : ""
      }`;
    case "staticAnalysis":
      return `${strictNeededMessage(reason)} ${STRICT_FIX}`;
    case "empty":
      return "dbt Fusion has no recorded column lineage for this column. If the model is new, save it.";
    case "failed":
      return `Could not read column lineage: ${reason.message}`;
  }
}

export class LineageService {
  private currentProject: CurrentProject;
  /** The Fusion Client of the Current Project. */
  private currentClient: () => FusionClient | undefined;
  /** The Current Project's configuration error, which explains a lineage request that found no nodes. */
  private currentError: () => string | undefined;
  /** Whether the Current Project opts into `+static_analysis: strict`, and the folder the strict fix changes. */
  private currentStrict: () => StrictInputs;

  public constructor({
    currentProject,
    currentClient = () => undefined,
    currentError = () => undefined,
    currentLsp,
    currentStrict = () => ({ strict: false }),
  }: {
    currentProject: CurrentProject;
    currentClient?: () => FusionClient | undefined;
    currentError?: () => string | undefined;
    /** The Current Project's server commands, which schedule the lineage requests. */
    currentLsp: () => FusionCommands | undefined;
    currentStrict?: () => StrictInputs;
  }) {
    this.currentProject = currentProject;
    this.currentClient = currentClient;
    this.currentError = currentError;
    this.currentStrict = currentStrict;
    this.currentLsp = currentLsp;
  }

  private readonly currentLsp: () => FusionCommands | undefined;

  /** Each manifest's adjacency, built on first use; see {@link adjacencyOf}. */
  private adjacencies: WeakMap<Manifest, LineageAdjacency> | undefined;

  /**
   * Answers the panel's column click from the Fusion Client's `dbt.listNodes`, one request per distinct target
   * column. Only edges with a requested column on the side the component expands from are kept, spelled as
   * requested. A failed request drops only its target when another answered. The token ends every wait early.
   */
  async getConnectedColumns(
    request: ConnectedColumnsRequest,
    token: CancellationToken,
  ): Promise<ConnectedColumnsResult> {
    const client = this.currentClient();
    const lsp = this.currentLsp();
    if (!client || !lsp || client.state !== "running") {
      return {
        kind: "noLineage",
        reason: {
          kind: "notRunning",
          state: client?.state ?? "stopped",
          failure: failureSummary(client?.failureReason),
        },
      };
    }
    const targets = distinctTargets(request.targets);
    const settled = await Promise.allSettled(
      targets.map(([table, column]) =>
        lsp.listNodes(columnLineageArgs(table, column), {
          purpose: "columnLineage",
          token,
        }),
      ),
    );
    const results: ListNodesResult[] = [];
    const failures: TargetFailure[] = [];
    settled.forEach((outcome, index) => {
      const target = targets[index];
      if (outcome.status === "fulfilled") {
        results.push(outcome.value);
      } else if (target) {
        failures.push({
          target,
          message: errorMessage(outcome.reason),
        });
      }
    });
    if (results.length === 0) {
      return {
        kind: "noLineage",
        reason: {
          kind: "failed",
          message: [...new Set(failures.map((f) => f.message))].join("; "),
        },
      };
    }
    if (failures.length === 0 && results.every((r) => !r.nodes?.length)) {
      return { kind: "noLineage", reason: this.whyEmpty() };
    }
    return {
      kind: "lineage",
      columnLineage: toPanelLineage(
        adjacentEdges(
          results.flatMap((result) => columnEdges(result)),
          targets,
          request.upstreamExpansion,
        ),
      ),
      ...(failures.length > 0 ? { failures } : {}),
    };
  }

  /** Why every target answered with no nodes: a configuration error, a static-analysis mode, or no lineage. */
  private whyEmpty(): NoLineage {
    const error = this.currentError();
    if (error) {
      return { kind: "failed", message: error };
    }
    const needs = this.columnsNeedStrict();
    return needs ? { kind: "staticAnalysis", ...needs } : { kind: "empty" };
  }

  /** The effective mode when it computes no column lineage for a running client, else `undefined`. */
  columnsNeedStrict(): NeedsStrict | undefined {
    return needsStrict(this.currentClient(), this.currentStrict());
  }

  /**
   * The columns the Fusion Client infers for the node defined in `file`, from `dbt.getCurrentNode`. A null answer,
   * seen before any document of the project was opened, opens the document without showing it and asks once more.
   * `undefined` when the client is not running, fails, or still names no node.
   */
  async getInferredColumns(
    projectRoot: string,
    file: string,
  ): Promise<InferredColumn[] | undefined> {
    const client = this.currentClient();
    const lsp = this.currentLsp();
    if (!client || !lsp || client.state !== "running") {
      return undefined;
    }
    const relativePath = path
      .relative(projectRoot, file)
      .split(path.sep)
      .join("/");
    const ask = async () =>
      inferredColumns(
        await lsp.getCurrentNode(relativePath, { purpose: "columns" }),
      );
    try {
      const columns = await ask();
      if (columns !== undefined) {
        return columns;
      }
      await workspace.openTextDocument(Uri.file(file));
      return await ask();
    } catch {
      return undefined;
    }
  }

  /** Returns the tables that depend on `table` (its dbt children). */
  getChildTables({ table }: { table: string }) {
    return { tables: this.getConnectedTables("children", table) };
  }

  /** Returns the tables `table` depends on (its dbt parents). */
  getParentTables({ table }: { table: string }) {
    return { tables: this.getConnectedTables("parents", table) };
  }

  /**
   * Returns every data-flow `[parent, child]` pair among `tables`, so the panel can draw an edge between two drawn
   * tables whichever expansion drew them. Foreign-key-only edges are left out, as in `getConnectedTables`.
   */
  getTableEdges({ tables }: { tables: readonly string[] }): {
    edges: [string, string][];
  } {
    const manifest = this.currentProject.current?.manifest;
    if (!manifest) {
      return { edges: [] };
    }
    return {
      edges: this.adjacencyOf(manifest).edgesAmong(tables),
    };
  }

  /**
   * Every table of the project's lineage graph and the data-flow pairs among them, for the whole-project view. A
   * table's URL is the one a neighbour's edge carries for it, when one does.
   */
  getProjectGraph(): {
    tables: lineage.LineageTable[];
    edges: [string, string][];
  } {
    const manifest = this.currentProject.current?.manifest;
    if (!manifest) {
      return { tables: [], edges: [] };
    }
    const adjacency = this.adjacencyOf(manifest);
    const tables: lineage.LineageTable[] = [];
    for (const key of adjacency.tableKeys()) {
      const table = this.createTable(manifest, adjacency.urlOf(key), key);
      if (table) {
        tables.push(table);
      }
    }
    return {
      tables,
      edges: adjacency.edgesAmong(tables.map((table) => table.table)),
    };
  }

  private getConnectedTables(
    direction: Direction,
    table: string,
  ): lineage.LineageTable[] | undefined {
    const manifest = this.currentProject.current?.manifest;
    if (!manifest) {
      return;
    }
    const adjacency = this.adjacencyOf(manifest);
    if (!adjacency.has(direction, table)) {
      return;
    }
    const tables = new Map<string, lineage.LineageTable>();
    for (const { url, key } of adjacency.neighbours(direction, table)) {
      const node = this.createTable(manifest, url, key);
      if (!node) {
        continue;
      }
      if (!tables.has(node.table)) {
        tables.set(node.table, node);
      }
    }
    return [...tables.values()].sort((a, b) => a.table.localeCompare(b.table));
  }

  /**
   * The data-flow adjacency the lineage requests answer from; see {@link LineageAdjacency}. Built once per manifest,
   * so a request does not rebuild the graph for each card it draws.
   */
  private adjacencyOf(manifest: Manifest): LineageAdjacency {
    this.adjacencies ??= new WeakMap();
    let adjacency = this.adjacencies.get(manifest);
    if (!adjacency) {
      adjacency = new LineageAdjacency(manifest.graphMetaMap);
      this.adjacencies.set(manifest, adjacency);
    }
    return adjacency;
  }

  /**
   * The lineage table for the node `key`; see {@link lineageTable}. The card's counts come from the manifest's
   * adjacency, the same one the edge requests read.
   */
  createTable(
    manifest: Manifest,
    tableUrl: string | undefined,
    key: string,
  ): lineage.LineageTable | undefined {
    return lineageTable(manifest, key, {
      url: tableUrl,
      rootPackage: this.currentProject.current?.getProjectName(),
      layer: {
        tagPrefix: readSetting("lineage.layer.tagPrefix") ?? "layer/",
        fromPath: readSetting("lineage.layer.inferFromPath") ?? true,
      },
      adjacency: this.adjacencyOf(manifest),
    });
  }
}

const columnKey = (table: string, column: string) =>
  `${table}\u0000${column.toLowerCase()}`;

/** The targets with case-insensitive duplicate columns dropped, keeping the first spelling. */
function distinctTargets(targets: [string, string][]): [string, string][] {
  const seen = new Map<string, [string, string]>();
  for (const [table, column] of targets) {
    const key = columnKey(table, column);
    if (!seen.has(key)) {
      seen.set(key, [table, column]);
    }
  }
  return [...seen.values()];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Edges one hop from a requested column in the requested direction, deduplicated across requests. The requested
 * end carries the column as the panel spelled it, because the component matches column names exactly.
 */
function adjacentEdges(
  edges: ColumnEdge[],
  targets: [string, string][],
  upstreamExpansion: boolean,
): ColumnEdge[] {
  const wanted = new Map(
    targets.map(([table, column]) => [columnKey(table, column), column]),
  );
  const kept = new Map<string, ColumnEdge>();
  for (const edge of edges) {
    const end = upstreamExpansion ? edge.parent : edge.child;
    const spelling = wanted.get(columnKey(end.uniqueId, end.column));
    const parentKey = columnKey(edge.parent.uniqueId, edge.parent.column);
    const childKey = columnKey(edge.child.uniqueId, edge.child.column);
    const id = `${parentKey}\u0000${childKey}`;
    if (spelling === undefined || kept.has(id)) {
      continue;
    }
    const requested = { ...end, column: spelling };
    kept.set(
      id,
      upstreamExpansion
        ? { ...edge, parent: requested }
        : { ...edge, child: requested },
    );
  }
  return [...kept.values()];
}
