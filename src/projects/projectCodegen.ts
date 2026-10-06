import { existsSync } from "fs";
import * as path from "path";
import {
  commands,
  ProgressLocation,
  RelativePattern,
  Uri,
  ViewColumn,
  window,
  workspace,
} from "vscode";
import type { Log } from "../core/log";
import { ColumnMetaData } from "../core/manifest/types";
import { DBColumn } from "../core/types";
import { ModelNode } from "../local/lineageTypes";
import { readSetting } from "../settings";
import { getColumnNameByCase } from "./columnNames";
import { notifyError, type NotifiableProject } from "./notifications";
import { writeUserFile } from "./userFiles";

async function createUserFile(location: string, text: string): Promise<void> {
  if ((await writeUserFile(Uri.file(location), text)) === "rejected") {
    throw new Error(`the editor rejected creating ${location}`);
  }
}

/** Warehouse column lookups that file generation reads from. */
export interface ColumnSource {
  getColumnsOfModel(modelName: string): Promise<DBColumn[]>;
  getColumnsOfSource(
    sourceName: string,
    tableName: string,
  ): Promise<DBColumn[]>;
}

interface FileNameTemplateMap {
  [key: string]: string;
}

/**
 * Renders a schema YAML document listing `columnsInRelation` under model `modelName`.
 * @internal
 */
export function createYMLContent(
  columnsInRelation: { [key: string]: string }[],
  modelName: string,
): string {
  let yamlString = "version: 2\n\nmodels:\n";
  yamlString += `  - name: ${modelName}\n    description: ""\n    columns:\n`;
  for (const item of columnsInRelation) {
    yamlString += `    - name: ${item.column}\n      description: ""\n`;
  }
  return yamlString;
}

/** Writes and opens `<model>_schema.yml` beside the model unless that file exists. */
export async function generateSchemaYML(
  columns: Pick<ColumnSource, "getColumnsOfModel"> & NotifiableProject,
  modelPath: Uri,
  modelName: string,
): Promise<void> {
  try {
    // Create filePath based on model location
    const currentDir = path.dirname(modelPath.fsPath);
    const location = path.join(currentDir, modelName + "_schema.yml");
    if (!existsSync(location)) {
      const columnsInRelation = await columns.getColumnsOfModel(modelName);
      // Generate yml file content
      const fileContents = createYMLContent(columnsInRelation, modelName);
      await createUserFile(location, fileContents);
      const doc = await workspace.openTextDocument(Uri.file(location));
      window.showTextDocument(doc);
    } else {
      void notifyError(
        columns,
        `A file called ${modelName}_schema.yml already exists in ${currentDir}. Rename or delete it to generate the schema yml again`,
      );
    }
  } catch (exc) {
    void notifyError(columns, "Could not generate schema yaml", exc);
  }
}

/** A source table a code lens offers to generate a staging model from. */
export interface GenerateModelFromSourceParams {
  currentDoc: Uri;
  sourceName: string;
  database: string;
  schema: string;
  tableName: string;
  tableIdentifier?: string | undefined;
}

/** Writes and opens a staging model selecting every column of a source table unless it exists. */
export async function generateModel(
  columns: Pick<ColumnSource, "getColumnsOfSource"> & NotifiableProject,
  terminal: Pick<Log, "debug">,
  sourceName: string,
  tableName: string,
  sourcePath: string,
): Promise<void> {
  await window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: "Generating model...",
      cancellable: false,
    },
    async () => {
      try {
        const prefix = readSetting("generateModel.prefix");

        // Map setting to fileName
        const fileNameTemplateMap: FileNameTemplateMap = {
          "{prefix}_{sourceName}_{tableName}": `${prefix}_${sourceName}_${tableName}`,
          "{prefix}_{sourceName}__{tableName}": `${prefix}_${sourceName}__${tableName}`,
          "{prefix}_{tableName}": `${prefix}_${tableName}`,
          "{tableName}": `${tableName}`,
        };

        // Default filename template
        let fileName = `${prefix}_${sourceName}_${tableName}`;

        const fileNameTemplate = readSetting("generateModel.fileNameTemplate");

        // Parse setting to fileName
        if (fileNameTemplate in fileNameTemplateMap) {
          fileName = fileNameTemplateMap[fileNameTemplate] ?? fileName;
        }
        // Create filePath based on source.yml location
        const location = path.join(sourcePath, fileName + ".sql");
        if (!existsSync(location)) {
          const columnsInRelation = await columns.getColumnsOfSource(
            sourceName,
            tableName,
          );
          terminal.debug(
            "dbtProject:generateModel",
            `Generating columns for source ${sourceName} and table ${tableName}`,
            columnsInRelation,
          );

          const fileContents = `with source as (
        select * from {{ source('${sourceName}', '${tableName}') }}
  ),
  renamed as (
      select
          ${columnsInRelation
            .map((column) => `{{ adapter.quote("${column.column}") }}`)
            .join(",\n        ")}

      from source
  )
  select * from renamed
    `;
          await createUserFile(location, fileContents);
          const doc = await workspace.openTextDocument(Uri.file(location));
          window.showTextDocument(doc);
        } else {
          void notifyError(
            columns,
            `A model called ${fileName} already exists in ${sourcePath}. Rename or delete it to generate the model again`,
          );
        }
      } catch (exc) {
        void notifyError(columns, "Could not generate the model", exc);
      }
    },
  );
}

/** Opens beside the editor the `type` artifact in the target folder that matches the model's path. */
export async function findModelInTargetfolder(
  projectRoot: string,
  targetPath: string | undefined,
  modelPath: Uri,
  type: string,
): Promise<void> {
  if (!targetPath) {
    return;
  }
  const relativePath = path.relative(projectRoot, modelPath.fsPath);

  const targetModels = await workspace.findFiles(
    new RelativePattern(targetPath, path.join(type, "**", relativePath)),
  );
  if (targetModels.length > 0) {
    commands.executeCommand("vscode.open", targetModels[0], {
      preview: false,
      preserveFocus: true,
      viewColumn: ViewColumn.Beside,
    });
  }
}

/** Adds warehouse columns and fills missing data types on `node`; false when there are none. */
export function mergeColumnsFromDB(
  adapterType: string,
  node: Pick<ModelNode, "columns">,
  columnsFromDB: DBColumn[],
): boolean {
  if (!columnsFromDB || columnsFromDB.length === 0) {
    return false;
  }
  const columnsFromManifest: Record<string, ColumnMetaData> = {};
  Object.entries(node.columns).forEach(([k, v]) => {
    columnsFromManifest[getColumnNameByCase(k, adapterType)] = v;
  });

  for (const c of columnsFromDB) {
    const columnNameFromDB = getColumnNameByCase(c.column, adapterType);
    const existing_column = columnsFromManifest[columnNameFromDB];
    if (existing_column) {
      existing_column.data_type = (
        existing_column.data_type || c.dtype
      )?.toLowerCase();
      continue;
    }
    node.columns[columnNameFromDB] = {
      name: columnNameFromDB,
      data_type: c.dtype?.toLowerCase(),
      description: "",
      meta: {},
    };
  }
  return true;
}
