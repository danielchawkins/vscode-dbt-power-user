import { Uri, window } from "vscode";
import { activeModelUri } from "../../projects/previewUri";
import { Projects } from "../../projects/projects";
import { QueryManifestService } from "../../projects/queryManifestService";

/**
 * Handles singular data tests — standalone `.sql` files that live under the
 * project's configured `test-paths` and are executed with `dbt test --select
 * <test_name>`.
 *
 * These are not models and must not be dispatched through `RunModel`: running
 * them as a model spawns `dbt run`, which is never meaningful for a test file.
 * The original command entry points (`fusionPowerUser.runCurrentModel`,
 * `fusionPowerUser.testCurrentModel`, `fusionPowerUser.runTest`) consult this class
 * first and delegate to `RunModel` only when the active file is not a singular
 * test.
 */
export class RunTest {
  constructor(
    private projects: Projects,
    private queryManifestService: QueryManifestService,
  ) {}

  /**
   * Returns the singular test name for the given file URI, or `undefined` if
   * the file is not a singular data test in the current project's manifest.
   *
   * Singular tests are SQL files that appear in the manifest as test resources
   * without `test_metadata` (generic tests like `not_null` / `unique` have
   * `test_metadata` populated and live in `schema.yml`, not in `.sql` files).
   * Detection uses the parsed manifest rather than a hardcoded `tests/`
   * prefix, so projects with custom `test-paths` in their project file are
   * handled correctly.
   */
  getSingularTestName(uri: Uri): string | undefined {
    const event = this.queryManifestService.getEventByDocument(uri);
    if (!event) {
      return undefined;
    }
    const filePath = uri.fsPath;
    for (const [name, testData] of event.testMetaMap) {
      if (testData.test_metadata === undefined && testData.path === filePath) {
        return name;
      }
    }
    return undefined;
  }

  /**
   * Runs the singular test at the given URI via
   * `dbt test --select <test_name>`.
   */
  runSingularTest(uri: Uri, testName: string): void {
    const project = this.projects.get(uri);
    if (!project) {
      return;
    }
    void project.runTest(testName);
  }

  /**
   * Attempts to run the active editor's file as a singular test, after rebuilding a parse that a source change left
   * stale (a test file added while no parse-field view was showing is not in it). Resolves `true` if the file was a
   * singular test and the run was dispatched, `false` otherwise — in which case the caller should fall back to the
   * regular model/test behavior.
   */
  async runSingularTestOnActiveWindowIfApplicable(): Promise<boolean> {
    if (!window.activeTextEditor) {
      return false;
    }
    const uri = activeModelUri(window.activeTextEditor.document.uri);
    await this.queryManifestService.freshManifest(uri);
    const testName = this.getSingularTestName(uri);
    if (testName === undefined) {
      return false;
    }
    this.runSingularTest(uri, testName);
    return true;
  }
}
