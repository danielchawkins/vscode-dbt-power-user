// ── Types ──────────────────────────────────────────────────────────────

export interface SqlEngineModel {
  alias?: string;
  name: string;
  database?: string;
  schema?: string;
  columns: Record<
    string,
    { name: string; data_type?: string; description?: string }
  >;
}

export interface SqlEngineModelInfo {
  model_node: {
    alias?: string;
    name: string;
    schema?: string;
    database?: string;
    uniqueId: string;
    columns: Record<
      string,
      { name: string; data_type?: string; description?: string }
    >;
  };
  compiled_sql?: string;
}

export interface ColumnLineageEntry {
  source: [string, string];
  target: [string, string];
  type: string;
  viewsType: string;
  viewsCode: string[];
}

export interface ColumnLineageResult {
  column_lineage: ColumnLineageEntry[];
  confidence: { confidence: string };
  errors?: Record<string, string[]>;
}

export interface ComputeColumnLineageOptions {
  showIndirectEdges?: boolean;
  isCancelled?: () => boolean;
}

// ── Internal helpers ───────────────────────────────────────────────────

let altimateCoreCache: any | undefined;

async function getAltimateCore(): Promise<any | null> {
  if (altimateCoreCache !== undefined) {
    return altimateCoreCache;
  }
  try {
    altimateCoreCache = await import("@altimateai/altimate-core");
    return altimateCoreCache;
  } catch (error) {
    altimateCoreCache = null;
    return null;
  }
}

function buildSchemaJson(
  dialect: string,
  tables: {
    tableName: string;
    database?: string | null;
    schema?: string | null;
    columns: { name: string; data_type?: string; description?: string }[];
  }[],
): string {
  return JSON.stringify({
    version: "1",
    dialect,
    tables: Object.fromEntries(
      tables.map((t) => [
        t.tableName,
        {
          ...(t.database ? { database: t.database } : {}),
          ...(t.schema ? { schema: t.schema } : {}),
          columns: t.columns.map((c) => ({
            name: c.name,
            type: c.data_type || "TEXT",
            nullable: true,
            description: c.description || null,
          })),
        },
      ]),
    ),
  });
}

// ── Public functions ───────────────────────────────────────────────────

/**
 * Extract the output column names from a SQL SELECT statement.
 * Uses @altimateai/altimate-core (native, no Python required).
 * Throws if altimate-core is unavailable — caller should fall back to DB schema.
 */
export async function extractOutputColumns(
  sql: string,
  dialect: string,
): Promise<string[]> {
  const sg = await getAltimateCore();
  if (!sg) {
    throw new Error("extractOutputColumns: altimate-core is not available");
  }
  return sg.extractOutputColumns(sql, dialect);
}

/**
 * Compute column-level lineage using @altimateai/altimate-core.
 * Returns null if altimate-core is unavailable (caller should use its own fallback).
 */
export async function computeColumnLineage(
  dialect: string,
  modelInfos: SqlEngineModelInfo[],
  options?: ComputeColumnLineageOptions,
): Promise<ColumnLineageResult | null> {
  const sg = await getAltimateCore();
  if (!sg) {
    return null;
  }

  try {
    const showIndirectEdges = options?.showIndirectEdges ?? true;
    const isCancelled = options?.isCancelled ?? (() => false);

    // Build a fully-qualified quoted object name from a model node
    const qualifiedName = (node: {
      alias?: string;
      name: string;
      schema?: string;
      database?: string;
    }): string => {
      const alias = (node.alias || node.name).toLowerCase();
      if (node.database && node.schema) {
        return `"${node.database.toLowerCase()}"."${node.schema.toLowerCase()}"."${alias}"`;
      }
      if (node.schema) {
        return `"${node.schema.toLowerCase()}"."${alias}"`;
      }
      return `"${alias}"`;
    };

    // Build table name → uniqueId lookup
    const tableToUniqueId: Record<string, string> = {};
    for (const info of modelInfos) {
      const node = info.model_node;
      const alias = (node.alias || node.name).toLowerCase();
      tableToUniqueId[`"${alias}"`] = node.uniqueId;
      if (node.schema) {
        tableToUniqueId[`"${node.schema.toLowerCase()}"."${alias}"`] =
          node.uniqueId;
      }
      if (node.database && node.schema) {
        tableToUniqueId[qualifiedName(node)] = node.uniqueId;
      }
    }

    // Build Schema from all models' columns
    const schemaJson = buildSchemaJson(
      dialect,
      modelInfos.map((info) => ({
        tableName: info.model_node.alias || info.model_node.name,
        database: info.model_node.database || null,
        schema: info.model_node.schema || null,
        columns: Object.values(info.model_node.columns),
      })),
    );
    const schema = sg.Schema.fromJson(schemaJson);

    // Call columnLineage() for each model with compiled SQL
    const allLineageEntries: ColumnLineageEntry[] = [];
    const allErrors: string[] = [];

    for (const info of modelInfos) {
      if (!info.compiled_sql) {
        continue;
      }
      if (isCancelled()) {
        break;
      }

      const result = sg.columnLineage(
        info.compiled_sql,
        dialect,
        schema,
        info.model_node.database || null,
        info.model_node.schema || null,
      );

      if (result.errors.length > 0) {
        allErrors.push(...result.errors);
      }

      for (const entry of result.column_lineage) {
        if (!showIndirectEdges && entry.lineage_type === "indirect") {
          continue;
        }

        // Parse "table.column" — last dot separates column from table ref
        const srcLastDot = entry.source.lastIndexOf(".");
        if (srcLastDot === -1) {
          continue;
        }

        const srcTable = entry.source.substring(0, srcLastDot).toLowerCase();
        const srcCol = entry.source
          .substring(srcLastDot + 1)
          .slice(1, -1)
          .toLowerCase();
        const tgtTable = qualifiedName(info.model_node);
        const tgtCol = entry.target.toLowerCase();

        // Resolve table names to uniqueIds
        const resolveId = (t: string) => {
          if (tableToUniqueId[t]) {
            return tableToUniqueId[t];
          }
          const parts = t.split(".");
          if (parts.length >= 2) {
            const two = parts.slice(-2).join(".");
            if (tableToUniqueId[two]) {
              return tableToUniqueId[two];
            }
          }
          return tableToUniqueId[parts[parts.length - 1]];
        };

        const srcId = resolveId(srcTable);
        const tgtId = resolveId(tgtTable);
        if (!srcId || !tgtId) {
          continue;
        }

        allLineageEntries.push({
          source: [srcId, srcCol],
          target: [tgtId, tgtCol],
          type: entry.lineage_type,
          viewsType: entry.lens_type,
          viewsCode: entry.lens_code.map(
            (step: { expression: string }) => step.expression,
          ),
        });
      }
    }

    return {
      column_lineage: allLineageEntries,
      confidence: { confidence: "high" },
      errors: allErrors.length > 0 ? { altimate_core: allErrors } : undefined,
    };
  } catch {
    return null;
  }
}
