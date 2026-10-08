import * as path from "path";
import { Uri, workspace } from "vscode";
import {
  ColumnEdge,
  columnEdges,
  ColumnLineage,
  columnLineageArgs,
  InferredColumn,
  inferredColumns,
  toPanelLineage,
} from "../../core/lineage";
import { FusionCommandError, type ListNodesResult } from "../../core/lsp";
import {
  GraphMetaMap,
  NodeGraphMap,
  RESOURCE_TYPE_EXPOSURE,
  RESOURCE_TYPE_FUNCTION,
  RESOURCE_TYPE_METRIC,
  RESOURCE_TYPE_SOURCE,
} from "../../core/manifest/types";
import { Table } from "../../dbt_integration/domain";
import {
  createFusionCommands,
  type FusionCommands,
} from "../../fusion/fusionCommands";
import {
  FusionClient,
  FusionClientState,
} from "../../fusion/fusionLanguageClient";
import { failureSummary } from "../../projects/fusionStatus";
import type { Manifest } from "../../projects/manifestTypes";
import { QueryManifestService } from "../../projects/queryManifestService";
import {
  NeedsStrict,
  needsStrict,
  STRICT_FIX,
  StrictInputs,
  strictNeededMessage,
} from "./strictNeeded";

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

export class DbtLineageService {
  public constructor(
    private queryManifestService: QueryManifestService,
    /** The Fusion Client of the Current Project. */
    private currentClient: () => FusionClient | undefined = () => undefined,
    /** The Current Project's configuration error, which explains a lineage request that found no nodes. */
    private currentError: () => string | undefined = () => undefined,
    /** The Current Project's server commands; defaults to commands over `currentClient`. */
    currentLsp?: () => FusionCommands | undefined,
    /** Whether the Current Project opts into `+static_analysis: strict`, and the folder the strict fix changes. */
    private currentStrict: () => StrictInputs = () => ({ strict: false }),
  ) {
    const fallback = createFusionCommands(() => this.currentClient());
    this.currentLsp = currentLsp ?? (() => fallback);
  }

  private readonly currentLsp: () => FusionCommands | undefined;

  /**
   * Answers the panel's column click from the Fusion Client's `dbt.listNodes`, one request per distinct target
   * column. Only edges with a requested column on the side the component expands from are kept, spelled as
   * requested. A failed request drops only its target when another answered.
   */
  async getConnectedColumns(
    request: ConnectedColumnsRequest,
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
    const listNodes = async (table: string, column: string) => {
      return lsp.listNodes(columnLineageArgs(table, column));
    };
    const settled = await Promise.allSettled(
      targets.map(async ([table, column]) => {
        try {
          return await listNodes(table, column);
        } catch (error) {
          if (!isCancelled(error)) {
            throw error;
          }
          return await listNodes(table, column);
        }
      }),
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
      inferredColumns(await lsp.getCurrentNode(relativePath));
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

  private getConnectedTables(
    key: keyof GraphMetaMap,
    table: string,
  ): Table[] | undefined {
    const _event = this.queryManifestService.getEventByCurrentProject();
    if (!_event) {
      return;
    }
    const { event } = _event;
    if (!event) {
      return;
    }
    const { graphMetaMap } = event;
    const dependencyNodes = graphMetaMap[key];
    const node = dependencyNodes.get(table);
    if (!node) {
      return;
    }
    const tables: Map<string, Table> = new Map();
    node.nodes
      // Hide foreign-key-only edges: the parent is referenced by a declared FK
      // constraint but never read by the model's SQL, so it isn't a data-flow
      // edge. The edge still exists in graphMetaMap for build order / impact
      // analysis; only this data-flow lineage view drops it.
      .filter((n) => n.edgeType !== "constraint")
      .forEach(({ url, key }) => {
        const _node = this.createTable(event, url, key);
        if (!_node) {
          return;
        }
        if (!tables.has(_node.table)) {
          tables.set(_node.table, _node);
        }
      });
    return Array.from(tables.values()).sort((a, b) =>
      a.table.localeCompare(b.table),
    );
  }

  createTable(
    event: Manifest,
    tableUrl: string | undefined,
    key: string,
  ): Table | undefined {
    const splits = key.split(".");
    const at = (index: number) => splits[index] ?? "";
    const nodeType = at(0);
    const { graphMetaMap, testMetaMap } = event;
    const childCount = this.getConnectedNodeCount(
      graphMetaMap["children"],
      key,
    );
    const parentCount = this.getConnectedNodeCount(
      graphMetaMap["parents"],
      key,
    );
    if (nodeType === RESOURCE_TYPE_SOURCE) {
      const { sourceMetaMap } = event;
      const schema = at(2);
      const table = at(3);
      const _node = sourceMetaMap.get(schema);
      if (!_node) {
        return;
      }
      const _table = _node.tables.find((t) => t.name === table);
      if (!_table) {
        return;
      }
      return {
        table: key,
        label: table,
        url: tableUrl,
        childCount,
        parentCount,
        nodeType,
        tests: (graphMetaMap["tests"].get(key)?.nodes || []).map((n) => {
          const testKey = n.label.split(".")[0] ?? "";
          return { ...testMetaMap.get(testKey), key: testKey };
        }),
        columns: _table.columns,
        description: _table?.description,
        packageName: _node.package_name,
      };
    }
    if (nodeType === RESOURCE_TYPE_METRIC) {
      return {
        table: key,
        label: at(2),
        url: tableUrl,
        childCount,
        parentCount,
        nodeType,
        materialization: undefined,
        tests: [],
        columns: {},
      };
    }
    const { nodeMetaMap } = event;

    const table = at(2);
    if (nodeType === RESOURCE_TYPE_EXPOSURE) {
      return {
        table: key,
        label: table,
        url: tableUrl,
        childCount,
        parentCount,
        nodeType,
        materialization: undefined,
        tests: [],
        columns: {},
      };
    }

    if (nodeType === RESOURCE_TYPE_FUNCTION) {
      const { functionMetaMap } = event;
      const fn = functionMetaMap.get(table);
      const fnType = fn?.config?.type;
      return {
        table: key,
        label: table,
        url: tableUrl,
        childCount,
        parentCount,
        nodeType,
        materialization: fnType ? `${fnType} function` : "function",
        tests: [],
        columns: {},
      };
    }

    const node = nodeMetaMap.lookupByUniqueId(key);
    if (!node) {
      return;
    }

    const materialization = node.config.materialized ?? undefined;
    return {
      table: key,
      label: node.alias,
      url: tableUrl,
      childCount,
      parentCount,
      nodeType,
      materialization,
      description: node.description,
      columns: node.columns,
      patchPath: node.patch_path ?? "",
      tests: (graphMetaMap["tests"].get(key)?.nodes || []).map((n) => {
        const testKey = n.label.split(".")[0] ?? "";
        return { ...testMetaMap.get(testKey), key: testKey };
      }),
      packageName: node.package_name,
      meta: node.meta,
    };
  }

  private getConnectedNodeCount(g: NodeGraphMap, key: string) {
    // Exclude FK-only edges so the upstream/downstream counts match the
    // data-flow edges actually drawn in the lineage panel.
    return (g.get(key)?.nodes || []).filter((n) => n.edgeType !== "constraint")
      .length;
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

function isCancelled(error: unknown): boolean {
  return error instanceof FusionCommandError && error.kind === "cancelled";
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
