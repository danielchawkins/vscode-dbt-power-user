import { readFileSync } from "node:fs";
import * as path from "node:path";
import type { Uri } from "vscode";
import { parse, stringify } from "yaml";
import type { Log } from "../../core/log";
import { getColumnTestConfigFromYml } from "../../core/manifest/testConfig";
import type {
  MacroMetaMap,
  TestMetaData,
  TestMetadataAcceptedValues,
  TestMetadataRelationships,
  UnitTestMetaData,
} from "../../core/manifest/types";
import { removeProtocol } from "../../core/text";
import { isColumnNameEqual } from "../../projects/project/columnNames";
import type { CurrentProject } from "../../projects/project/currentProject";

export class ModelTestService {
  private currentProject: CurrentProject;

  public constructor(currentProject: CurrentProject) {
    this.currentProject = currentProject;
  }

  // Remove duplicate tests from tests array
  public removeDuplicateTests(
    tests: (
      | string
      | TestMetadataAcceptedValues
      | TestMetadataRelationships
      | {
          [x: string]: unknown;
        }
      | null
    )[],
  ) {
    const seen = new Set();
    return tests.filter((item) => {
      const stringified = JSON.stringify(item);
      if (seen.has(stringified)) {
        return false;
      }
      seen.add(stringified);
      return true;
    });
  }

  private returnTestMetadataFromKwargs(test: TestMetaData) {
    // If this is new test added in doc editor webview panel and not saved yet, return the config from kwargs
    if (test.test_metadata?.kwargs) {
      const { model: _model, ...rest } = test.test_metadata.kwargs;
      if (Object.keys(rest).length > 0) {
        return stringify(rest);
      }
    }
  }

  private filterAndStringifyTest = (
    testsPerColumnOrModelFromYml: Record<string, Record<string, unknown>>[],
    test: TestMetaData,
    log: Log,
  ) => {
    if (!testsPerColumnOrModelFromYml?.length) {
      return this.returnTestMetadataFromKwargs(test);
    }

    // Ignore these generic fields, as we handle these fields differently in UI
    const ignoredFields = new Set([
      "model",
      "column_name",
      "field",
      "to",
      "values",
    ]);

    if (!test.test_metadata) {
      return;
    }
    const { name, namespace } = test.test_metadata;
    const fullName = namespace ? `${namespace}.${name}` : name;

    const existingConfig = getColumnTestConfigFromYml(
      testsPerColumnOrModelFromYml,
      test.test_metadata.kwargs,
      fullName,
    );

    if (!existingConfig) {
      log.debug("getDbtTestCode", "no test available in yml");
      return this.returnTestMetadataFromKwargs(test);
    }

    log.debug(
      "getDbtTestCode",
      "sending selected config from yml",
      existingConfig,
    );

    // Remove fields which are already handled in UI
    const filteredConfig = Object.entries(existingConfig).reduce(
      (acc: Record<string, unknown>, [key, value]) => {
        if (ignoredFields.has(key)) {
          return acc;
        }

        acc[key] = value;
        return acc;
      },
      {},
    );
    // If test is from external package ex: dbt_utils, show the package namespace as well
    const refinedTestConfig = namespace
      ? {
          [fullName]: filteredConfig,
        }
      : filteredConfig;
    return stringify(refinedTestConfig);
  };

  /**
   * Find the extra config for test from schema.yml, if available
   */
  public getConfigByTest(
    test: TestMetaData,
    modelName: string,
    options: {
      columnNameFromTestMetadata?: string | undefined;
      /** The request's model; without it, the active editor's. */
      uri?: Uri | undefined;
    } = {},
  ) {
    const { columnNameFromTestMetadata, uri } = options;
    const project = this.currentProject.forResource(uri);
    const manifest = project?.manifest;
    if (!project || !manifest) {
      return;
    }
    const { nodeMetaMap } = manifest;
    const node = nodeMetaMap.lookupByBaseName(modelName);
    if (!node) {
      return;
    }
    const { log } = project;

    const patchPath = node?.patch_path?.includes("://")
      ? path.join(project.root.fsPath, removeProtocol(node.patch_path))
      : node.patch_path;

    if (!patchPath) {
      log.debug("getDbtTestCode", "unable to find patch path", patchPath);
      return null;
    }
    log.debug("getDbtTestCode", "finding test from yaml", patchPath);
    const parsedDocFile = parse(
      readFileSync(patchPath, { encoding: "utf-8" }),
      {
        strict: false,
        uniqueKeys: false,
        maxAliasCount: -1,
      },
    );

    if (!parsedDocFile) {
      log.debug(
        "getDbtTestCode",
        "yml file does not have any content",
        patchPath,
      );
      return null;
    }

    const model = parsedDocFile.models?.find(
      (m: { name: string }) => m.name === modelName,
    );

    // model test
    if (!columnNameFromTestMetadata) {
      log.debug(
        "getDbtTestCode",
        "finding model test from yml",
        parsedDocFile,
        model,
      );
      return this.filterAndStringifyTest(model?.tests, test, log);
    }

    const column = model.columns?.find((yamlColumn: { name: string }) =>
      isColumnNameEqual(yamlColumn.name, columnNameFromTestMetadata),
    );
    log.debug(
      "getDbtTestCode",
      "finding column test from yml",
      parsedDocFile,
      model,
      column,
    );

    return this.filterAndStringifyTest(column?.tests, test, log);
  }

  // Find the file path of test macro
  private getMacroFilePath = ({
    macros,
    projectName,
    macroMetaMap,
    testName,
  }: {
    macros: [string];
    projectName: string;
    macroMetaMap: MacroMetaMap;
    testName: string | undefined;
  }) => {
    if (!testName) {
      return;
    }

    // Find if current test depends on test macro in current project
    const macro = macros.find(
      (m) => m === `macro.${projectName}.test_${testName}`,
    );

    if (macro) {
      // return the file path if it ends with sql
      const macroData = macroMetaMap.get(`test_${testName}`);
      return macroData?.path?.endsWith(".sql") ? macroData?.path : undefined;
    }
  };

  public async getTestsForCurrentModel() {
    const active = this.currentProject.activeEditor();
    if (!active?.project?.manifest) {
      return undefined;
    }

    const modelName = path.basename(active.modelUri.fsPath, ".sql");
    return this.getTestsForModel(modelName);
  }

  public async getTestsForModel(modelName: string) {
    const project = this.currentProject.current;
    const manifest = project?.manifest;
    if (!project || !manifest) {
      return undefined;
    }
    const projectName = project.getProjectName();

    const { nodeMetaMap, graphMetaMap, testMetaMap, macroMetaMap } = manifest;

    project.log.debug(
      "dbtTests",
      "getting tests by modelName:",
      false,
      modelName,
    );
    const _node = nodeMetaMap.lookupByBaseName(modelName);
    if (!_node) {
      project.log.debug("no node for tableName:", modelName);
      return;
    }
    const key = _node.unique_id;
    return (graphMetaMap["tests"].get(key)?.nodes ?? [])
      .map((n) => {
        const testKey = n.label.split(".")[0] ?? "";
        const testData = testMetaMap.get(testKey);

        if (!testData) {
          return null;
        }

        // For singular tests, attached_node will be undefined
        if (!testData.attached_node) {
          return { ...testData, key: testKey };
        }

        // dbt sends tests (ex: relationships) to both source and connected models
        // do not send the test which has different model in attached_node
        if (testData.attached_node !== key) {
          return null;
        }

        const {
          depends_on: { macros },
          test_metadata,
        } = testData;

        const macroFilepath = this.getMacroFilePath({
          macros,
          projectName,
          macroMetaMap,
          testName: test_metadata?.name,
        });

        return {
          ...testData,
          path: (macroFilepath ?? "") || testData.path,
          key: testKey,
        };
      })
      .filter((t) => t !== null);
  }

  public async getUnitTestsForCurrentModel(): Promise<
    { name: string; path?: string | undefined }[] | undefined
  > {
    const active = this.currentProject.activeEditor();
    if (!active) {
      return undefined;
    }

    const modelName = path.basename(active.modelUri.fsPath, ".sql");
    return this.getUnitTestsForModel(modelName);
  }

  private getUnitTestsForModel(
    modelName: string,
  ): { name: string; path?: string | undefined }[] {
    const manifest = this.currentProject.current?.manifest;
    if (!manifest) {
      return [];
    }

    const { unitTestMetaMap } = manifest;
    if (!unitTestMetaMap) {
      return [];
    }

    return [...unitTestMetaMap.values()]
      .filter((ut: UnitTestMetaData) => ut.model === modelName)
      .map((ut: UnitTestMetaData) => ({ name: ut.name, path: ut.path }));
  }
}
