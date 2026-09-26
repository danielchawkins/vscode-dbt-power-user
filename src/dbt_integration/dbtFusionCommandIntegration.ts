import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import path, { join } from "path";
import { parse } from "yaml";

import { DBTBaseProjectIntegration } from "./dbtBaseProjectIntegration";
import {
  DBTCommand,
  DBTCommandExecutionStrategy,
  DBTCommandFactory,
  DBTProjectIntegration,
  DeferConfig,
  QueryExecution,
  readAndParseProjectConfig,
} from "./dbtIntegration";
import { DBTDiagnosticData } from "./diagnostics";
import {
  Catalog,
  DBColumn,
  DBT_PROJECT_FILE,
  DBTNode,
  NodeMetaData,
} from "./domain";
import { DBTTerminal } from "./terminal";

export class DBTFusionCommandProjectIntegration
  extends DBTBaseProjectIntegration
  implements DBTProjectIntegration
{
  protected selectedTarget?: string;
  protected profilesDir?: string;
  protected availableTargets?: string[];

  constructor(
    protected dbtCommandFactory: DBTCommandFactory,
    protected cliDBTCommandExecutionStrategyFactory: (
      path: string,
      dbtPath: string,
    ) => DBTCommandExecutionStrategy,
    executablePath: string,
    terminal: DBTTerminal,
    projectRoot: string,
    projectConfigDiagnostics: DBTDiagnosticData[],
    deferConfig: DeferConfig,
    onDiagnosticsChanged: () => void,
  ) {
    super(
      projectRoot,
      projectConfigDiagnostics,
      deferConfig,
      onDiagnosticsChanged,
      terminal,
    );
    this.dbtPath = executablePath;
  }

  async refreshProjectConfig(): Promise<void> {
    await this.initializePaths();
  }

  async initializeProject(): Promise<void> {}

  /**
   * Attaches the CLI execution strategy. Subclasses override this to add flags every subcommand needs.
   */
  protected wrapCommand(command: DBTCommand): DBTCommand {
    command.setExecutionStrategy(
      this.cliDBTCommandExecutionStrategyFactory(
        this.projectRoot,
        this.dbtPath,
      ),
    );
    return command;
  }

  getSelectedTarget(): string | undefined {
    return this.selectedTarget;
  }

  async setSelectedTarget(_targetName: string): Promise<void> {
    throw new Error("Method not implemented");
  }

  async getTargetNames(): Promise<string[]> {
    if (!this.availableTargets) {
      await this.initializeSelectedTarget();
    }
    return this.availableTargets || [];
  }

  protected async initializePaths() {
    // No way to get these paths from the fusion executable
    this.targetPath = join(this.projectRoot, "target");
    this.modelPaths = [join(this.projectRoot, "models")];
    this.seedPaths = [join(this.projectRoot, "seeds")];
    this.macroPaths = [join(this.projectRoot, "macros")];
    this.packagesInstallPath = join(this.projectRoot, "dbt_packages");
    try {
      const projectConfig = readAndParseProjectConfig(this.projectRoot);
      this.projectName = projectConfig.name;
    } catch (error) {
      this.terminal.warn(
        "DBTFusionProjectNameFromConfigExceptionError",
        "project name could not be read from dbt_project.yml, ignoring",
        true,
        error,
      );
    }

    // Initialize selected target from dbt debug output
    await this.initializeSelectedTarget();
  }

  private async initializeSelectedTarget(): Promise<void> {
    try {
      const debugCommand = this.wrapCommand(
        new DBTCommand("Initializing target...", ["debug"]),
      );
      const debugOutput = await this.debug(debugCommand);
      this.selectedTarget = this.extractTargetFromDebugOutput(debugOutput);
      this.profilesDir = this.extractProfilesDirFromDebugOutput(debugOutput);
      this.availableTargets = this.getTargetsFromProfiles();
      this.adapterType =
        this.extractAdapterTypeFromDebugOutput(debugOutput) || "unknown";
    } catch (error) {
      this.terminal.warn(
        "DBTFusionCommandInitializeTargetError",
        "Could not initialize selected target from debug output",
        true,
        error,
      );
    }
  }

  private extractTargetFromDebugOutput(
    debugOutput: string,
  ): string | undefined {
    // Example format: "Finished 'debug' target 'dev' in 10s 916ms"
    const targetMatch = debugOutput.match(
      /Finished\s+'debug'\s+target\s+'([^']+)'/,
    );
    return targetMatch ? targetMatch[1] : undefined;
  }

  private extractProfilesDirFromDebugOutput(
    debugOutput: string,
  ): string | undefined {
    // Example format: "   Loading profiles.yml" or "Loading ~/.dbt/profiles.yml"
    // Note: dbt-fusion outputs with leading whitespace and newlines
    const profilesMatch = debugOutput.match(/Loading\s+([^\n]*profiles\.yml)/);
    if (profilesMatch) {
      let profilesPath = profilesMatch[1].trim();
      if (profilesPath.startsWith("~/")) {
        profilesPath = path.join(homedir(), profilesPath.slice(2));
      }
      if (profilesPath === "profiles.yml") {
        return this.projectRoot;
      }
      return path.dirname(profilesPath);
    }
    return undefined;
  }

  private extractAdapterTypeFromDebugOutput(
    debugOutput: string,
  ): string | undefined {
    // Example format: "Debugging adapter type: snowflake (remote)"
    const adapterMatch = debugOutput.match(
      /Debugging\s+adapter\s+type:\s+([^\s(]+)/,
    );
    return adapterMatch ? adapterMatch[1] : undefined;
  }

  private getTargetsFromProfiles(): string[] {
    if (!this.profilesDir) {
      return [];
    }

    const profilesPath = path.join(this.profilesDir, "profiles.yml");

    try {
      if (!existsSync(profilesPath)) {
        return [];
      }

      const projectConfig = readAndParseProjectConfig(this.projectRoot);
      const profileName = projectConfig.profile || this.projectName;

      const profilesContent = readFileSync(profilesPath, "utf8");
      const profilesData = parse(profilesContent);

      const projectProfile = profilesData[profileName];
      if (!projectProfile || !projectProfile.outputs) {
        return [];
      }

      return Object.keys(projectProfile.outputs);
    } catch (error) {
      this.terminal.warn(
        "DBTFusionCommandReadProfilesError",
        "Could not read profiles.yml to get target names",
        true,
        error,
      );
      return [];
    }
  }

  isInitialized(): boolean {
    return true;
  }

  async rebuildManifest(): Promise<void> {
    if (this.rebuildManifestAbortController) {
      this.rebuildManifestAbortController.abort();
      this.rebuildManifestAbortController = undefined;
    }
    const command = this.wrapCommand(
      this.dbtCommandFactory.createParseCommand(),
    );
    command.addArgument("--log-format");
    command.addArgument("json");
    this.rebuildManifestAbortController = new AbortController();
    command.setSignal(this.rebuildManifestAbortController.signal);

    try {
      const result = await command.execute();
      const stderr = result.stderr;
      if (stderr) {
        this.terminal.error(
          "dbtFusionParseProjectUserError",
          "Could not parse project user error",
          new Error(stderr),
          true,
          {
            error: stderr,
            adapter: this.getAdapterType() || "unknown",
          },
        );
      }
      this.terminal.info(
        "dbtFusionParseProject",
        "dbt fusion response",
        false,
        {
          command: command.getCommandAsString(),
          stderr,
        },
      );
      const errorsAndWarnings = stderr
        .trim()
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => Boolean(line))
        .map((line) =>
          this.parseJSON(
            "RebuildManifestErrorsAndWarningsJSONParsing",
            line,
            false,
          ),
        );
      const errors = errorsAndWarnings
        .filter(
          (line) =>
            line &&
            line.hasOwnProperty("info") &&
            line.info.hasOwnProperty("level") &&
            line.info.hasOwnProperty("msg") &&
            ["error", "fatal"].includes(line.info.level),
        )
        .map((line) => line.info.msg);
      const warnings = errorsAndWarnings
        .filter(
          (line) =>
            line &&
            line.hasOwnProperty("info") &&
            line.info.hasOwnProperty("level") &&
            line.info.hasOwnProperty("msg") &&
            line.info.level === "warn",
        )
        .map((line) => line.info.msg);
      this.rebuildManifestDiagnosticsData = [];
      const diagnosticData: DBTDiagnosticData[] = [];
      errors.forEach((error) => {
        diagnosticData.push({
          filePath: path.join(this.projectRoot, DBT_PROJECT_FILE),
          message: error,
          severity: "error",
          range: {
            startLine: 0,
            startColumn: 0,
            endLine: 999,
            endColumn: 999,
          },
          source: "dbt-fusion",
          category: "manifest-rebuild",
        });
      });
      warnings.forEach((warning) => {
        diagnosticData.push({
          filePath: path.join(this.projectRoot, DBT_PROJECT_FILE),
          message: warning,
          severity: "warning",
          range: {
            startLine: 0,
            startColumn: 0,
            endLine: 999,
            endColumn: 999,
          },
          source: "dbt-fusion",
          category: "manifest-rebuild",
        });
      });
      this.rebuildManifestDiagnosticsData = diagnosticData;
    } catch (error) {
      this.terminal.error(
        "dbtFusionCannotParseProjectCommandExecuteError",
        "Could not parse project command execution error",
        error,
        true,
        {
          adapter: this.getAdapterType() || "unknown",
          command: command.getCommandAsString(),
        },
      );
      const errorMessage = "Unable to parse dbt fusion cli response: " + error;
      this.rebuildManifestDiagnosticsData = [
        {
          filePath: path.join(this.projectRoot, DBT_PROJECT_FILE),
          message: errorMessage,
          severity: "error",
          range: {
            startLine: 0,
            startColumn: 0,
            endLine: 999,
            endColumn: 999,
          },
          source: "dbt-fusion",
          category: "command-execution",
        },
      ];
    }
  }

  // -------- dbt commands (passthroughs that wrap and add defer params) --------

  async runModel(command: DBTCommand) {
    return await this.addDeferParams(this.wrapCommand(command));
  }

  async buildModel(command: DBTCommand) {
    return await this.addDeferParams(this.wrapCommand(command));
  }

  async buildProject(command: DBTCommand) {
    return await this.addDeferParams(this.wrapCommand(command));
  }

  async runTest(command: DBTCommand) {
    return await this.addDeferParams(this.wrapCommand(command));
  }

  async runModelTest(command: DBTCommand) {
    return await this.addDeferParams(this.wrapCommand(command));
  }

  async compileModel(command: DBTCommand): Promise<DBTCommand | undefined> {
    return await this.addDeferParams(this.wrapCommand(command));
  }

  async generateDocs(_: DBTCommand): Promise<DBTCommand | undefined> {
    throw new Error("dbt fusion does not support docs generation");
  }

  async clean(command: DBTCommand): Promise<string> {
    const { stdout, stderr } = await this.wrapCommand(command).execute();
    if (stderr) {
      throw new Error(stderr);
    }
    return stdout;
  }

  async executeCommandImmediately(command: DBTCommand) {
    return await this.wrapCommand(command).execute();
  }

  async deps(command: DBTCommand): Promise<string> {
    const { stdout, stderr } = await this.wrapCommand(command).execute();
    if (stderr) {
      throw new Error(stderr);
    }
    return stdout;
  }

  async debug(command: DBTCommand): Promise<string> {
    const { stdout, stderr } = await this.wrapCommand(command).execute();
    if (stderr) {
      this.terminal.debug(
        "DBTFusionDebugStderr",
        "Debug command produced stderr output (ignoring): " + stderr,
      );
    }
    return stdout;
  }

  // -------- altimate commands (Fusion-dialect compile/query/catalog) --------

  async executeSQL(
    query: string,
    limit: number,
    modelName: string,
  ): Promise<QueryExecution> {
    const showCommand = this.wrapCommand(
      new DBTCommand("Running sql...", [
        "show",
        "--log-level",
        "debug",
        "--inline",
        query,
        "--limit",
        limit.toString(),
        "--output",
        "json",
        "--log-format",
        "json",
      ]),
    );
    const abortController = new AbortController();
    showCommand.setSignal(abortController.signal);
    return new QueryExecution(
      async () => {
        abortController.abort();
      },
      async () => {
        const { stdout, stderr } = await showCommand.execute(
          abortController.signal,
        );
        const exception = this.processJSONErrors(stderr);
        if (exception) {
          throw exception;
        }
        const parsedLines = stdout
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line.trim()));
        const previewLine = parsedLines.filter(
          (line) =>
            line.hasOwnProperty("data") && line.data.hasOwnProperty("preview"),
        );
        if (previewLine.length === 0) {
          throw new Error("Could not find previewLine in " + stdout);
        }
        const compiledSqlLines = parsedLines.filter(
          (line) =>
            line.hasOwnProperty("data") && line.data.hasOwnProperty("sql"),
        );
        const preview = JSON.parse(previewLine[0].data.preview);
        let compiledSql = "";
        // TODO: is there a way to get the last compiled SQL line in fusion?
        if (compiledSqlLines.length !== 0) {
          compiledSql = compiledSqlLines[compiledSqlLines.length - 1].data.sql;
        }
        return {
          table: {
            column_names: preview.length > 0 ? Object.keys(preview[0]) : [],
            column_types:
              preview.length > 0
                ? Object.keys(preview[0]).map(() => "string")
                : [],
            rows: preview.map((obj: any) => Object.values(obj)),
          },
          compiled_sql: compiledSql,
          raw_sql: query,
          modelName,
        };
      },
    );
  }

  async unsafeCompileNode(modelName: string): Promise<string> {
    const compileQueryCommand = this.wrapCommand(
      new DBTCommand("Compiling model...", [
        "compile",
        "--select",
        modelName,
        "--output",
        "json",
        "--log-format",
        "json",
        "--log-level",
        "debug",
      ]),
    );
    const { stdout, stderr } = await compileQueryCommand.execute();
    const exception = this.processJSONErrors(stderr);
    if (exception) {
      throw exception;
    }
    const allCompiledLines = stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line.trim()))
      .filter((line) => line.data?.hasOwnProperty("compiled"));
    // dbt Fusion 1.8+ compiles related test nodes (relationships, unit tests) when
    // selecting a model, so allCompiledLines may contain multiple entries. Filter for
    // the model node via unique_id prefix ("model.<pkg>.<name>") or
    // node_info.resource_type, falling back to the first compiled line for older dbt
    // versions that omit those fields.
    const modelLine =
      allCompiledLines.find((line) =>
        line.data?.unique_id?.startsWith("model."),
      ) ??
      allCompiledLines.find(
        (line) => line.node_info?.resource_type === "model",
      ) ??
      allCompiledLines[0];
    return modelLine.data.compiled;
  }

  async unsafeCompileQuery(
    query: string,
    _originalModelName?: string,
  ): Promise<string> {
    const compileQueryCommand = this.wrapCommand(
      new DBTCommand("Compiling sql...", [
        "compile",
        "--inline",
        query,
        "--output",
        "json",
        "--log-format",
        "json",
        "--log-level",
        "debug",
      ]),
    );
    const { stdout, stderr } = await compileQueryCommand.execute();
    const compiledLine = stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line.trim()))
      .filter((line) => line.data?.hasOwnProperty("compiled"));
    const exception = this.processJSONErrors(stderr);
    if (exception) {
      throw exception;
    }
    return compiledLine[0].data.compiled;
  }

  async validateSQLDryRun(query: string): Promise<{ bytes_processed: string }> {
    const adapterType = this.getAdapterType();
    if (adapterType !== "bigquery") {
      throw new Error(
        `validateSQLDryRun is only supported for the BigQuery adapter; current adapter is "${adapterType ?? "unknown"}"`,
      );
    }
    const validateSqlCommand = this.wrapCommand(
      new DBTCommand("Estimating BigQuery cost...", [
        "compile",
        "--inline",
        `{{ validate_sql('${query}') }}`,
        "--output",
        "json",
        "--log-format",
        "json",
        "--log-level",
        "debug",
      ]),
    );
    const { stdout, stderr } = await validateSqlCommand.execute();
    const compiledLine = stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line.trim()))
      .filter((line) => line.data?.hasOwnProperty("compiled"));
    const exception = this.processJSONErrors(stderr);
    if (exception) {
      throw exception;
    }
    return JSON.parse(compiledLine[0].data.compiled);
  }

  async getColumnsOfSource(
    sourceName: string,
    tableName: string,
  ): Promise<DBColumn[]> {
    const compileQueryCommand = this.wrapCommand(
      new DBTCommand("Getting columns of source...", [
        "compile",
        "--inline",
        `{% set output = [] %}{% for result in adapter.get_columns_in_relation(source('${sourceName}', '${tableName}')) %} {% do output.append({"column": result.name, "dtype": result.dtype}) %} {% endfor %} {{ tojson(output) }}`,
        "--quiet",
      ]),
    );
    const { stdout, stderr } = await compileQueryCommand.execute();
    if (stderr) {
      throw new Error(stderr);
    }
    return JSON.parse(stdout.trim());
  }

  async getColumnsOfModel(modelName: string): Promise<DBColumn[]> {
    const compileQueryCommand = this.wrapCommand(
      new DBTCommand("Getting columns of model...", [
        "compile",
        "--inline",
        `{% set output = [] %}{% for result in adapter.get_columns_in_relation(ref('${modelName}')) %} {% do output.append({"column": result.name, "dtype": result.dtype}) %} {% endfor %} {{ tojson(output) }}`,
        "--output",
        "json",
        "--log-format",
        "json",
        "--log-level",
        "debug",
      ]),
    );
    const { stdout } = await compileQueryCommand.execute();
    const compiledLine = stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line.trim()))
      .filter((line) => line.data?.hasOwnProperty("compiled"));
    // TODO: Exception handling commented out for now as it causes issues with some fusion outputs
    return JSON.parse(compiledLine[0].data.compiled);
  }

  async getBulkSchemaFromDB(
    nodes: DBTNode[],
    signal: AbortSignal,
  ): Promise<Record<string, DBColumn[]>> {
    if (nodes.length === 0) {
      return {};
    }
    const bulkModelQuery = `
{% set result = {} %}
{% for n in ${JSON.stringify(nodes)} %}
  {% set columns = adapter.get_columns_in_relation(ref(n["name"])) %}
  {% set new_columns = [] %}
  {% for column in columns %}
    {% do new_columns.append({"column": column.name, "dtype": column.dtype}) %}
  {% endfor %}
  {% do result.update({n["unique_id"]:new_columns}) %}
{% endfor %}
{% for n in graph.sources.values() %}
  {% set columns = adapter.get_columns_in_relation(source(n["source_name"], n["identifier"])) %}
  {% set new_columns = [] %}
  {% for column in columns %}
    {% do new_columns.append({"column": column.name, "dtype": column.dtype}) %}
  {% endfor %}
  {% do result.update({n["unique_id"]:new_columns}) %}
{% endfor %}
{{ tojson(result) }}`;
    const compileQueryCommand = this.wrapCommand(
      new DBTCommand("Getting catalog...", [
        "compile",
        "--inline",
        bulkModelQuery.trim().split("\n").join(""),
        "--output",
        "json",
        "--log-format",
        "json",
        "--log-level",
        "debug",
      ]),
    );
    const { stdout } = await compileQueryCommand.execute(signal);
    const compiledLine = stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line.trim()))
      .filter((line) => line.data?.hasOwnProperty("compiled"));
    return JSON.parse(compiledLine[0].data.compiled);
  }

  async getBulkCompiledSQL(
    models: NodeMetaData[],
  ): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const node of models) {
      try {
        result[node.unique_id] = await this.unsafeCompileNode(node.name);
      } catch (e) {
        this.terminal.error(
          "getBulkCompiledSQL",
          `Unable to compile sql for model ${node.unique_id}`,
          e,
          true,
        );
      }
    }
    return result;
  }

  async getCatalog(): Promise<Catalog> {
    // Fusion engine doesn't emit `data.compiled` events for the standard
    // `graph.nodes.values()` Jinja shape — the project-graph compile path
    // sends Z050 orchestration events instead. We work around it by
    // reading the manifest in TypeScript, batching model and source names,
    // and issuing `compile --inline` queries that use only explicit
    // `ref()` / `source()` calls. Each batch is a real Jinja compile that
    // does emit `data.compiled`, so the engine's normal compile path
    // returns rendered SQL we can JSON-parse.
    const manifest = this.readTargetManifest();
    if (!manifest) {
      this.terminal.warn(
        "DBTFusionCommandProjectIntegration",
        "target/manifest.json not found or unreadable; returning empty catalog",
        false,
      );
      return [];
    }

    const modelEntries = collectModelEntries(manifest);
    const sourceEntries = collectSourceEntries(manifest);
    const catalog: Catalog = [];

    for (let i = 0; i < modelEntries.length; i += GET_CATALOG_BATCH_SIZE) {
      const batch = modelEntries.slice(i, i + GET_CATALOG_BATCH_SIZE);
      const rows = await this.fetchModelColumnRows(batch.map((e) => e.name));
      const entriesByName = new Map(batch.map((e) => [e.name, e]));
      for (const row of rows) {
        const entry = entriesByName.get(row.ref_name);
        if (!entry) {
          continue;
        }
        catalog.push({
          table_database: entry.database,
          table_schema: entry.schema,
          table_name: entry.name,
          column_name: row.column_name,
          column_type: row.column_type,
        });
      }
    }

    for (let i = 0; i < sourceEntries.length; i += GET_CATALOG_BATCH_SIZE) {
      const batch = sourceEntries.slice(i, i + GET_CATALOG_BATCH_SIZE);
      const rows = await this.fetchSourceColumnRows(
        batch.map((e) => ({
          source_name: e.source_name,
          identifier: e.identifier,
        })),
      );
      const entriesByKey = new Map(
        batch.map((e) => [`${e.source_name}.${e.identifier}`, e]),
      );
      for (const row of rows) {
        const entry = entriesByKey.get(`${row.source_name}.${row.identifier}`);
        if (!entry) {
          continue;
        }
        catalog.push({
          table_database: entry.database,
          table_schema: entry.schema,
          table_name: entry.name,
          column_name: row.column_name,
          column_type: row.column_type,
        });
      }
    }

    return catalog;
  }

  private readTargetManifest(): {
    nodes?: Record<string, unknown>;
    sources?: Record<string, unknown>;
  } | null {
    const manifestPath = path.join(this.projectRoot, "target", "manifest.json");
    if (!existsSync(manifestPath)) {
      return null;
    }
    try {
      return JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (e) {
      this.terminal.warn(
        "DBTFusionCommandProjectIntegration",
        "Failed to parse target/manifest.json: " + (e as Error).message,
        false,
      );
      return null;
    }
  }

  private async fetchModelColumnRows(
    names: string[],
  ): Promise<
    Array<{ ref_name: string; column_name: string; column_type: string }>
  > {
    if (names.length === 0) {
      return [];
    }
    const namesList = names.map((n) => JSON.stringify(n)).join(", ");
    const query = `
{% set result = [] %}
{% for name in [${namesList}] %}
  {% set columns = adapter.get_columns_in_relation(ref(name)) %}
  {% for column in columns %}
    {% do result.append({"ref_name": name, "column_name": column.name, "column_type": column.dtype}) %}
  {% endfor %}
{% endfor %}
{{ tojson(result) }}`
      .trim()
      .split("\n")
      .join("");
    return this.runCatalogBatchQuery<{
      ref_name: string;
      column_name: string;
      column_type: string;
    }>(query, "model");
  }

  private async fetchSourceColumnRows(
    refs: Array<{ source_name: string; identifier: string }>,
  ): Promise<
    Array<{
      source_name: string;
      identifier: string;
      column_name: string;
      column_type: string;
    }>
  > {
    if (refs.length === 0) {
      return [];
    }
    const refsJson = JSON.stringify(refs);
    const query = `
{% set result = [] %}
{% for src in ${refsJson} %}
  {% set columns = adapter.get_columns_in_relation(source(src["source_name"], src["identifier"])) %}
  {% for column in columns %}
    {% do result.append({"source_name": src["source_name"], "identifier": src["identifier"], "column_name": column.name, "column_type": column.dtype}) %}
  {% endfor %}
{% endfor %}
{{ tojson(result) }}`
      .trim()
      .split("\n")
      .join("");
    return this.runCatalogBatchQuery<{
      source_name: string;
      identifier: string;
      column_name: string;
      column_type: string;
    }>(query, "source");
  }

  private async runCatalogBatchQuery<T>(
    query: string,
    kind: "model" | "source",
  ): Promise<T[]> {
    const command = this.wrapCommand(
      new DBTCommand(`Getting catalog batch (${kind})...`, [
        "compile",
        "--inline",
        query,
        "--output",
        "json",
        "--log-format",
        "json",
        "--log-level",
        "debug",
      ]),
    );
    const { stdout } = await command.execute();
    const compiledLine = stdout
      .trim()
      .split("\n")
      .map((line) => {
        try {
          return JSON.parse(line.trim());
        } catch {
          return undefined;
        }
      })
      .filter((line) => line && line.data?.hasOwnProperty("compiled"));
    if (compiledLine.length === 0) {
      throw new Error(
        `getCatalog: could not locate data.compiled in stdout for ${kind} batch`,
      );
    }
    return JSON.parse(compiledLine[0].data.compiled) as T[];
  }
}

interface ManifestNodeEntry {
  name: string;
  database: string;
  schema: string;
}

interface ManifestSourceEntry {
  name: string;
  database: string;
  schema: string;
  source_name: string;
  identifier: string;
}

const GET_CATALOG_BATCH_SIZE = 50;

function collectModelEntries(manifest: {
  nodes?: Record<string, unknown>;
}): ManifestNodeEntry[] {
  const entries: ManifestNodeEntry[] = [];
  for (const raw of Object.values(manifest.nodes ?? {})) {
    const node = raw as
      | {
          name?: string;
          database?: string;
          schema?: string;
          resource_type?: string;
          config?: { materialized?: string };
        }
      | undefined;
    if (!node?.name) {
      continue;
    }
    if (
      node.resource_type === "test" ||
      node.resource_type === "analysis" ||
      node.resource_type === "sql_operation"
    ) {
      continue;
    }
    // Skip non-materialised pseudo-nodes that don't resolve to warehouse
    // tables: `ephemeral` is never materialised, `inline` is a manifest
    // artefact emitted by `dbt compile --inline` runs.
    const materialized = node.config?.materialized;
    if (materialized === "ephemeral" || materialized === "inline") {
      continue;
    }
    entries.push({
      name: node.name,
      database: node.database ?? "",
      schema: node.schema ?? "",
    });
  }
  return entries;
}

function collectSourceEntries(manifest: {
  sources?: Record<string, unknown>;
}): ManifestSourceEntry[] {
  const entries: ManifestSourceEntry[] = [];
  for (const raw of Object.values(manifest.sources ?? {})) {
    const src = raw as
      | {
          name?: string;
          database?: string;
          schema?: string;
          source_name?: string;
          identifier?: string;
        }
      | undefined;
    if (!src?.source_name || !src.identifier) {
      continue;
    }
    entries.push({
      name: src.name ?? src.identifier,
      database: src.database ?? "",
      schema: src.schema ?? "",
      source_name: src.source_name,
      identifier: src.identifier,
    });
  }
  return entries;
}
