import type {
  DocMetaMap,
  ExposureMetaMap,
  FunctionMetaMap,
  GraphMetaMap,
  MacroMetaMap,
  MetricMetaMap,
  NodeMetaMap,
  SemanticModelMetaMap,
  SourceMetaMap,
  TestMetaMap,
  UnitTestMetaMap,
} from "../manifest/types";

export interface ParsedManifest {
  nodeMetaMap: NodeMetaMap;
  macroMetaMap: MacroMetaMap;
  metricMetaMap: MetricMetaMap;
  sourceMetaMap: SourceMetaMap;
  graphMetaMap: GraphMetaMap;
  testMetaMap: TestMetaMap;
  unitTestMetaMap: UnitTestMetaMap;
  docMetaMap: DocMetaMap;
  exposureMetaMap: ExposureMetaMap;
  functionMetaMap: FunctionMetaMap;
  semanticModelMetaMap: SemanticModelMetaMap;
  modelDepthMap: Map<string, number>;
}

// ============================================================================
// Run Results Types
// Schema reference: https://schemas.getdbt.com/dbt/run-results/v6/index.html
// ============================================================================

/**
 * Normalized status values for run results.
 * Maps various dbt status strings to a consistent set of values.
 */
export type RunStatus = "success" | "error" | "warn" | "skipped";

/**
 * Valid dbt resource types that can appear in run results.
 */
type ResourceType = "model" | "test" | "seed" | "snapshot" | "analysis";

/**
 * Individual resource result in a run history entry.
 * This is the unified format exposed to consumers.
 */
export interface RunResultEntry {
  /** Resource name extracted from unique_id */
  name: string;
  /** Full dbt unique_id (e.g., "model.project.my_model") */
  uniqueId: string;
  /** Normalized status: success, error, warn, or skipped */
  status: RunStatus;
  /** Execution time in seconds, null if not available */
  executionTime: number | null;
  /** Optional message (typically for errors) */
  message?: string;
  /** Resource type: model, test, seed, or snapshot */
  resourceType: ResourceType;
}

/**
 * A completed dbt command execution with all results.
 * This is the unified format emitted when run results are parsed.
 * All version differences are handled internally by the parser.
 */
export interface RunResultsEventData {
  /** Unique identifier for this run (from invocation_id or generated) */
  id: string;
  /** Full reconstructed dbt command (e.g., "dbt build --select +model+ --full-refresh") */
  command: string;
  /** Selection arguments passed to the command */
  args: string[];
  /** When the run completed */
  completedAt: Date;
  /** Name of the dbt project */
  projectName: string;
  /** Individual resource results */
  results: RunResultEntry[];
  /** Total elapsed time in seconds */
  elapsedTime: number;
}

export const RunModelType = {
  RUN_PARENTS: 0,
  RUN_CHILDREN: 1,
  BUILD_PARENTS: 2,
  BUILD_CHILDREN: 3,
  BUILD_CHILDREN_PARENTS: 4,
  TEST: 5,
} as const;
export type RunModelType = (typeof RunModelType)[keyof typeof RunModelType];

export const MANIFEST_FILE = "manifest.json";
export const RUN_RESULTS_FILE = "run_results.json";
export const CATALOG_FILE = "catalog.json";

export interface RunModelParams {
  plusOperatorLeft: string;
  modelName: string;
  plusOperatorRight: string;
}

export interface QueryExecutionResult {
  columnNames: string[];
  columnTypes: string[];
  data: Record<string, unknown>[];
  rawSql: string;
  compiledSql: string;
}
