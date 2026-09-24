import * as path from "path";

import { RESOURCE_TYPE_TEST, TestMetaMap } from "../domain";
import { ManifestProject } from "../manifestProject";
import { DBTTerminal } from "../terminal";

export class TestParser {
  constructor(private terminal: DBTTerminal) {}

  private getColumnNameWithoutQuotes(columnName: string): string | undefined {
    if (!columnName) {
      return undefined;
    }

    if (columnName.startsWith('"') && columnName.endsWith('"')) {
      return columnName.slice(1, -1);
    }

    return columnName;
  }
  createTestMetaMap(
    testsMap: any[],
    project: ManifestProject,
  ): Promise<TestMetaMap> {
    return new Promise((resolve) => {
      const projectRoot = project.getProjectRoot();
      const projectName = project.getProjectName();
      this.terminal.debug(
        "TestParser",
        `Parsing tests for "${projectName}" at ${projectRoot}`,
      );
      const testMetaMap: TestMetaMap = new Map();
      if (testsMap === null || testsMap === undefined) {
        resolve(testMetaMap);
      }
      Object.values(testsMap)
        .filter((test) => test.resource_type === RESOURCE_TYPE_TEST)
        .forEach((test) => {
          const {
            name,
            raw_sql,
            original_file_path,
            database,
            schema,
            alias,
            column_name,
            test_metadata,
            attached_node,
            depends_on,
            unique_id,
            meta: testMeta,
          } = test;
          const fullPath = path.join(projectRoot, original_file_path);
          // Merge meta from the test node and the parent column it's attached
          // to. Column meta wins on conflict — that's the level dbt-side
          // configs like `meta.relationship_type` / `meta.ignore_in_erd` are
          // typically declared at.
          const cleanColumnName = this.getColumnNameWithoutQuotes(column_name);
          const parent = attached_node ? testsMap[attached_node] : undefined;
          const columnMeta =
            parent && cleanColumnName
              ? parent.columns?.[cleanColumnName]?.meta
              : undefined;
          const meta = { ...(testMeta ?? {}), ...(columnMeta ?? {}) };
          testMetaMap.set(name, {
            path: fullPath,
            raw_sql,
            database,
            schema,
            alias,
            // for quoted column names, remove the quotes
            // ex: in manifest, it will be stored as "column_name": "\"Customer ID\"" for tests
            // here we remove the enclosing quotes
            column_name: cleanColumnName,
            test_metadata,
            attached_node,
            depends_on,
            unique_id,
            meta,
          });
        });
      this.terminal.debug(
        "TestParser",
        `Returning tests for "${projectName}" at ${projectRoot}`,
        testMetaMap,
      );
      resolve(testMetaMap);
    });
  }
}
