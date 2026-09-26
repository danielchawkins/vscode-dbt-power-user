export type MacroMetaMap = Map<string, MacroMetaData>;
export type MetricMetaMap = Map<string, MetricMetaData>;
export type SourceMetaMap = Map<string, SourceMetaData>;
export type TestMetaMap = Map<string, TestMetaData>;
export type UnitTestMetaMap = Map<string, UnitTestMetaData>;
export type ExposureMetaMap = Map<string, ExposureMetaData>;
export type FunctionMetaMap = Map<string, FunctionMetaData>;
export type DocMetaMap = Map<string, DocMetaData>;
export type SemanticModelMetaMap = Map<string, SemanticModelMetaData>;
export type NodeMetaType = NodeMetaData;
export type SourceMetaType = SourceTable;

export interface ProjectInfo {
  projectRoot: string | undefined;
  projectName: string | undefined;
  selectedTarget: string | undefined;
  targetNames: string[] | undefined;
  targetPath: string | undefined;
  packageInstallPath: string | undefined;
  modelPaths: string[] | undefined;
  seedPaths: string[] | undefined;
  macroPaths: string[] | undefined;
  manifestPath: string | undefined;
  catalogPath: string | undefined;
  dbtVersion: string | undefined;
  adapterType: string | undefined;
}

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
export type ResourceType = "model" | "test" | "seed" | "snapshot" | "analysis";

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

type ConfigOption =
  | { configPath: string; configType: "Manual" }
  | {
      config: unknown;
      config_schema: { files_required: string }[];
      configType: "Saas";
    }
  | { configType: "All" };

export type DataPilotHealtCheckParams = { projectRoot: string } & ConfigOption;

export type NodeResourceType = "model" | "seed" | "analysis" | "snapshot";

export interface NodeMetaMap {
  lookupByBaseName(
    modelBaseName: string,
    resourceType?: NodeResourceType,
  ): NodeMetaData | undefined;
  lookupByUniqueId(uniqueId: string): NodeMetaData | undefined;
  nodes(): Iterable<NodeMetaData>;
}

export interface MacroMetaData {
  path: string | undefined; // in dbt cloud, packages are not downloaded locally
  line: number;
  character: number;
  unique_id: string;
  description?: string;
  arguments?: { name: string; type: string; description: string }[];
  name: string;
  depends_on: DependsOn;
}

interface MetricMetaData {
  name: string;
}

/**
 * Entity types in a dbt semantic model. Two-way joins arise from a `foreign`
 * entity in one semantic_model pointing at a `primary` (or `unique`) entity
 * in another.
 */
export type SemanticEntityType = "primary" | "foreign" | "unique" | "natural";

export interface SemanticEntity {
  name: string;
  type: SemanticEntityType;
  /** SQL column expression. Defaults to `name` when omitted. */
  expr?: string;
  description?: string;
  role?: string;
}

/**
 * Captured for ERD overlay derivation. Existing `MetricMetaData` is kept
 * shallow to avoid disturbing consumers that don't need entity data
 * (tree view, lineage graph). Phase 4 of the ERD overlay reads from this
 * map exclusively.
 */
export interface SemanticModelMetaData {
  unique_id: string;
  name: string;
  package_name: string;
  /** unique_id of the anchor model resolved via `model: ref('...')`. May be undefined if resolution fails. */
  model_unique_id?: string;
  /** Raw `model` field from manifest (e.g. `"ref('orders')"`). Kept for diagnostics. */
  model_ref?: string;
  entities: SemanticEntity[];
  description?: string;
  meta?: Record<string, unknown>;
  path?: string;
}

export interface NodeMetaData {
  unique_id: string;
  path: string | undefined; // in dbt cloud, packages are not downloaded locally
  database: string;
  schema: string;
  alias: string;
  name: string;
  package_name: string;
  description: string;
  patch_path: string;
  columns: { [columnName: string]: ColumnMetaData };
  config: Config;
  resource_type: string;
  depends_on: DependsOn;
  is_external_project: boolean;
  compiled_path: string;
  meta: any;
  /** Model-level constraints (dbt 1.5+ contracts). May reference multiple columns. */
  constraints?: ModelLevelConstraint[];
  /** `relation_name` from manifest (quoted, fully-qualified). Used by FK constraint resolution. */
  relation_name?: string;
}

export interface ColumnMetaData {
  name: string;
  description: string;
  data_type: string;
  meta: any;
  /** Column-level constraints (dbt 1.5+ contracts). */
  constraints?: ColumnLevelConstraint[];
}

/**
 * dbt constraint types. `foreign_key` is the one we care about for ERD overlay;
 * the rest are kept for completeness so consumers can introspect contracts.
 */
export type ConstraintType =
  "check" | "not_null" | "unique" | "primary_key" | "foreign_key" | "custom";

export interface ColumnLevelConstraint {
  type: ConstraintType;
  name?: string;
  expression?: string;
  warn_unenforced?: boolean;
  warn_unsupported?: boolean;
  /** Target relation. Either a `ref('...')` / `source('...')` expression or a fully-qualified relation name. */
  to?: string;
  /** Target columns. For column-level FK, typically a single column. */
  to_columns?: string[];
}

export interface ModelLevelConstraint extends ColumnLevelConstraint {
  /** Source columns this model-level constraint binds. For FK, the local FK columns. */
  columns?: string[];
}

export type Table = {
  label: string;
  table: string;
  url: string | undefined;
  downstreamCount: number;
  upstreamCount: number;
  nodeType: string;
  materialization?: string;
  description?: string;
  tests: any[];
  meta?: Map<string, any>;
  isExternalProject: boolean;
  columns: { [columnName: string]: ColumnMetaData };
  patchPath?: string;
  packageName?: string;
};

interface Config {
  materialized: string;
}

export interface SourceMetaData {
  unique_id: string;
  name: string;
  database: string;
  schema: string;
  tables: SourceTable[];
  package_name: string;
  is_external_project: boolean;
  meta: any;
}

export interface SourceTable {
  name: string;
  identifier: string;
  path: string | undefined; // in dbt cloud, packages are not downloaded locally
  description: string;
  columns: { [columnName: string]: ColumnMetaData };
}

interface DocMetaData {
  path: string;
  line: number;
  character: number;
}

interface TestMetadataSpecification {
  column_name: string;
  model: string;
}

// for accepted_values
export interface TestMetadataAcceptedValues extends TestMetadataSpecification {
  values?: string[];
}

// for relationship
export interface TestMetadataRelationships extends TestMetadataSpecification {
  field?: string;
  to?: string;
}

interface DependsOn {
  macros: [string];
  nodes: [string];
  sources: [string];
}

export interface TestMetaData {
  path: string | undefined; // in dbt cloud, packages are not downloaded locally
  database: string;
  schema: string;
  alias: string;
  raw_sql: string;
  column_name?: string;
  test_metadata?: {
    kwargs: TestMetadataAcceptedValues | TestMetadataRelationships;
    name: string;
    namespace?: string;
  };
  attached_node?: string;
  depends_on: DependsOn;
  unique_id: string;
  /**
   * Merged meta from the test node and the parent column (column meta wins
   * on conflict). Populated by `TestParser`. ERD overlay reads
   * `meta.relationship_type` for cardinality override and `meta.ignore_in_erd`
   * to suppress edges.
   */
  meta?: Record<string, unknown>;
}

export interface ExposureMetaData {
  description?: string;
  depends_on: DependsOn;
  label?: string;
  maturity?: string;
  name: string;
  owner: { email: string; name: string };
  tags: [string];
  url?: string;
  type: string;
  config: { enabled: boolean };
  path: string | undefined; // in dbt cloud, packages are not downloaded locally
  unique_id: string;
  sources?: [string];
  metrics?: unknown[];
  meta?: Record<string, unknown>;
}

export interface FunctionArgument {
  name: string;
  data_type: string;
  description?: string;
  default_value?: string;
}

export interface FunctionReturns {
  data_type: string;
  description?: string;
}

export interface FunctionMetaData {
  unique_id: string;
  name: string;
  database?: string;
  schema?: string;
  description?: string;
  depends_on: DependsOn;
  path: string | undefined;
  package_name: string;
  is_external_project: boolean;
  resource_type: string;
  config: {
    materialized?: string;
    type?: string;
    volatility?: string;
    runtime_version?: string;
    entry_point?: string;
  };
  arguments?: FunctionArgument[];
  returns?: FunctionReturns;
  meta?: Record<string, unknown>;
}

export interface NodeData {
  label: string;
  key: string;
  url?: string;
  resourceType: string;
  /**
   * How this edge was derived. `"data"` (default) means the parent is referenced
   * by the model's SQL — a real data-flow edge. `"constraint"` means the edge
   * exists only because of a declared foreign-key constraint (`to: ref(...)`) and
   * the parent's relation never appears in the model's SQL. Consumers that render
   * data-flow lineage may hide or style `"constraint"` edges; the dependency graph
   * itself still contains them (build order, impact analysis, depth are unaffected).
   */
  edgeType?: "data" | "constraint";
}

interface NodeGraphMetaData {
  currentNode: NodeData;
  nodes: NodeData[];
}

interface ModelGraphMetaData {
  uniqueId: string;
  name: string;
  dependencies?: string[];
}

export type NodeGraphMap = Map<string, NodeGraphMetaData>;
export type ModelGraphMetaMap = Map<string, ModelGraphMetaData>;

export interface GraphMetaMap {
  parents: NodeGraphMap;
  children: NodeGraphMap;
  tests: NodeGraphMap;
  metrics: NodeGraphMap;
}

/**
 * Source of a relationship ref.
 * - `test`: derived from a dbt `relationships` data test
 * - `contract`: derived from a `foreign_key` model contract constraint
 * - `semantic`: derived from paired semantic-layer primary/foreign entities
 * - `inferred`: derived from naming-convention inference
 */
export type RefSource = "test" | "contract" | "semantic" | "inferred";

export type Cardinality =
  "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many";

/**
 * Endpoint of a relationship ref. Columns are ordered and always provided
 * as an array to support composite keys.
 */
export interface RefEndpoint {
  /** unique_id of the referenced model, source, or seed. */
  table: string;
  columns: string[];
}

/**
 * A relationship between two nodes. Used by the lineage ERD overlay to draw
 * FK edges and PK/FK badges on column nodes.
 */
export interface Ref {
  /** Stable, source-specific identifier. Safe to use as a React key. */
  id: string;
  from: RefEndpoint;
  to: RefEndpoint;
  cardinality: Cardinality;
  source: RefSource;
  /** Optional edge label supplied by the user (e.g. dbterd's `relationship_label`). */
  label?: string;
  /** Confidence score in [0, 1]. Set only for `source: "inferred"`. */
  confidence?: number;
  /** unique_id of the source test node. Set only for `source: "test"`. */
  test_node_id?: string;
}

export enum RunModelType {
  RUN_PARENTS,
  RUN_CHILDREN,
  BUILD_PARENTS,
  BUILD_CHILDREN,
  BUILD_CHILDREN_PARENTS,
  TEST,
  SNAPSHOT,
}

export interface EnvironmentVariables {
  [key: string]: string | undefined;
}

export const DBT_PROJECT_FILE = "dbt_project.yml";
/** dbt's default `packages-install-path`. */
export const DEFAULT_PACKAGES_INSTALL_DIR = "dbt_packages";
/**
 * Directory names whose nested `dbt_project.yml` files belong to installed
 * packages or a Python virtualenv rather than to a standalone dbt project.
 *
 * A project may point `packages-install-path` somewhere outside this list,
 * which it cannot know about — use `resolvePackagesInstallPath` to cover the
 * configured location.
 */
export const EXCLUDED_PROJECT_DIRS = [
  DEFAULT_PACKAGES_INSTALL_DIR,
  "site-packages",
  "dbt_internal_packages",
];
export const MANIFEST_FILE = "manifest.json";
export const RUN_RESULTS_FILE = "run_results.json";
export const CATALOG_FILE = "catalog.json";
export const RESOURCE_TYPE_MODEL = "model";
export const RESOURCE_TYPE_MACRO = "macro";
export const RESOURCE_TYPE_ANALYSIS = "analysis";
export const RESOURCE_TYPE_SOURCE = "source";
export const RESOURCE_TYPE_EXPOSURE = "exposure";
export const RESOURCE_TYPE_SEED = "seed";
export const RESOURCE_TYPE_SNAPSHOT = "snapshot";
export const RESOURCE_TYPE_TEST = "test";
export const RESOURCE_TYPE_METRIC = "semantic_model";
export const RESOURCE_TYPE_FUNCTION = "function";
export const RESOURCE_TYPE_UNIT_TEST = "unit_test";

export function isResourceNode(resourceType: string): boolean {
  return (
    resourceType === RESOURCE_TYPE_MODEL ||
    resourceType === RESOURCE_TYPE_SEED ||
    resourceType === RESOURCE_TYPE_ANALYSIS ||
    resourceType === RESOURCE_TYPE_SNAPSHOT
  );
}

export function isResourceHasDbColumns(resourceType: string): boolean {
  return (
    resourceType === RESOURCE_TYPE_MODEL ||
    resourceType === RESOURCE_TYPE_SEED ||
    resourceType === RESOURCE_TYPE_SNAPSHOT
  );
}
export interface DBTCommandExecution {
  command: (signal?: AbortSignal) => Promise<void>;
  statusMessage: string;
  showProgress?: boolean;
  focus?: boolean;
  signal?: AbortSignal;
}

export enum ManifestPathType {
  LOCAL = "local",
  REMOTE = "remote",
}

export interface RunModelParams {
  plusOperatorLeft: string;
  modelName: string;
  plusOperatorRight: string;
}

export type DBColumn = { column: string; dtype: string };

export type Node = {
  unique_id: string;
  name: string;
  resource_type: string;
};

export type SourceNode = {
  unique_id: string;
  name: string;
  resource_type: "source";
  table: string;
};

export type DBTNode = Node | SourceNode;

type CatalogItem = {
  table_database: string;
  table_schema: string;
  table_name: string;
  column_name: string;
  column_type: string;
};

export type Catalog = CatalogItem[];
export interface HealthcheckArgs {
  manifestPath: string;
  catalogPath?: string;
  config?: any;
  configPath?: string;
}

export interface SqlDryRunResult {
  bytes_processed: string;
}

export interface QueryExecutionResult {
  columnNames: string[];
  columnTypes: string[];
  data: Record<string, unknown>[];
  rawSql: string;
  compiledSql: string;
}

export interface UnitTestMetaData {
  name: string;
  path?: string;
  original_file_path: string;
  model: string;
  unique_id: string;
}
