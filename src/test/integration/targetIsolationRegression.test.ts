import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { checkFusionVersion, fixturePath } from "./helpers/testFixtures";
import { createLspFixture, type LspFixture } from "./lspFixture";

/**
 * Target isolation regression: verify DBT_LSP_USE_TARGET_LSP=1 behavior.
 *
 * Opt-in: FPU_RUN_TARGET_ISOLATION_CAPTURE=1
 * Optional binary override: FPU_TARGET_ISOLATION_DBT=/absolute/path/to/dbt
 *
 * Contracts:
 * - compile outputs to target/.lsp (not target/compiled)
 * - clearTarget removes target/.lsp while preserving manifest.json, target/compiled, seeded files
 */

const RUN = process.env.FPU_RUN_TARGET_ISOLATION_CAPTURE === "1";
const TIMEOUT_MS = 30_000;

function runSuite(): void {
  let fixture: LspFixture | undefined;

  teardown(async () => {
    if (fixture) {
      await fixture.close();
    }
  });

  test("isolates compile output to target/.lsp; clearTarget preserves target/compiled", async function () {
    this.timeout(TIMEOUT_MS);

    const verdict = await checkFusionVersion();
    const executable = process.env.FPU_TARGET_ISOLATION_DBT;
    if (!executable && verdict.kind !== "ok") {
      this.skip();
      return;
    }
    if (executable) {
      assert.ok(
        path.isAbsolute(executable),
        "binary override must be absolute",
      );
      assert.ok(fs.existsSync(executable), "binary override must exist");
    }

    const projectRoot = fixturePath("single-project");

    // Prepare a parse-clean project.
    const prepareProject = (tempRoot: string) => {
      const modelsDir = path.join(tempRoot, "models");
      const plainModelPath = path.join(modelsDir, "plain.sql");

      fs.rmSync(path.join(modelsDir, "broken_ref.sql"), { force: true });
      fs.rmSync(path.join(modelsDir, "child.sql"), { force: true });
      fs.writeFileSync(plainModelPath, "select 1");
    };

    fixture = await createLspFixture(projectRoot, projectRoot, {
      prepareProject,
      env: {
        DBT_LSP_USE_TARGET_LSP: "1",
      },
      executable,
      useProjectRootAsCwd: true,
    });

    await fixture.connect(TIMEOUT_MS);
    await fixture.request("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL(fixture.projectRoot).href,
      workspaceFolders: [
        {
          uri: pathToFileURL(fixture.projectRoot).href,
          name: path.basename(fixture.projectRoot),
        },
      ],
      capabilities: {
        window: { workDoneProgress: true },
        workspace: {
          configuration: true,
          didChangeWatchedFiles: { dynamicRegistration: true },
        },
        textDocument: {
          synchronization: { dynamicRegistration: true },
          publishDiagnostics: {},
        },
      },
    });
    fixture.notify("initialized", {});

    // Open plain.sql to trigger initial parse/compile
    const modelFile = path.join(fixture.projectRoot, "models", "plain.sql");
    fixture.notify("textDocument/didOpen", {
      textDocument: {
        uri: pathToFileURL(modelFile).href,
        languageId: "sql",
        version: 1,
        text: fs.readFileSync(modelFile, "utf-8"),
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 8_000));
    await fixture.request("workspace/executeCommand", {
      command: "dbt.listNodes",
      arguments: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 2_000));

    await fixture.request("workspace/executeCommand", {
      command: "dbt.compileLsp",
      arguments: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 2_000));

    // Record state after compile
    const tempTarget = path.join(fixture.projectRoot, "target");
    const tempCompiled = path.join(tempTarget, "compiled");
    const tempLsp = path.join(tempTarget, ".lsp");
    const tempManifest = path.join(tempTarget, "manifest.json");
    const tempSentinel = path.join(tempCompiled, ".fpu_isolation_sentinel");

    const lspContentAfterCompile = fs.existsSync(tempLsp)
      ? findFilesRecursive(tempLsp)
      : [];

    assert.ok(
      lspContentAfterCompile.length > 0,
      "target/.lsp must contain server-created compiled output after compileLsp",
    );
    assert.strictEqual(
      fs.existsSync(tempCompiled),
      false,
      "compileLsp must not write target/compiled when isolation is enabled",
    );
    assert.strictEqual(
      fs.existsSync(tempManifest),
      false,
      "compileLsp must not write target/manifest.json",
    );

    fs.mkdirSync(tempCompiled, { recursive: true });
    fs.writeFileSync(tempManifest, JSON.stringify({ metadata: "seeded" }));
    fs.writeFileSync(tempSentinel, "isolation-marker-v1");

    // Issue clearTarget
    await fixture.request("workspace/executeCommand", {
      command: "dbt.clearTarget",
      arguments: [],
    });

    // Record state after clearTarget
    const lspExistsAfterClear = fs.existsSync(tempLsp);
    const manifestExistsAfterClear = fs.existsSync(tempManifest);
    const sentinelExistsAfterClear = fs.existsSync(tempSentinel);
    const compiledDirExistsAfterClear = fs.existsSync(tempCompiled);

    console.log("Target Isolation Evidence:", {
      lsp_removed_by_clearTarget: !lspExistsAfterClear,
      manifest_json_survived: manifestExistsAfterClear,
      compiled_sentinel_survived: sentinelExistsAfterClear,
      compiled_dir_survived: compiledDirExistsAfterClear,
    });

    // Assert isolation contract
    assert.strictEqual(
      lspExistsAfterClear,
      false,
      "target/.lsp must be removed by clearTarget",
    );
    assert.strictEqual(
      manifestExistsAfterClear,
      true,
      "target/manifest.json must survive clearTarget",
    );
    assert.strictEqual(
      sentinelExistsAfterClear,
      true,
      "seeded target/compiled/.fpu_isolation_sentinel must survive clearTarget",
    );
    assert.strictEqual(
      compiledDirExistsAfterClear,
      true,
      "target/compiled directory must survive clearTarget",
    );
  });
}

function findFilesRecursive(dir: string): string[] {
  const files: string[] = [];
  const walk = (current: string) => {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  };
  walk(dir);
  return files;
}

if (RUN) {
  suite("Target Isolation Regression (DBT_LSP_USE_TARGET_LSP=1)", runSuite);
} else {
  suite("Target Isolation Regression (DBT_LSP_USE_TARGET_LSP=1)", () => {
    test("set FPU_RUN_TARGET_ISOLATION_CAPTURE=1 to run", function () {
      this.skip();
    });
  });
}
