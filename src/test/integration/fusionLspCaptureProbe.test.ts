import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { checkFusionVersion, fixturePath } from "./helpers/testFixtures";
import { createLspFixture } from "./lspFixture";

function fileUri(fsPath: string): string {
  return pathToFileURL(fsPath).href;
}

function progressValue(
  params: unknown,
): { kind?: string; title?: string; message?: string } | undefined {
  if (typeof params !== "object" || params === null) {
    return undefined;
  }
  const value = (params as { value?: unknown }).value;
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  return value as { kind?: string; title?: string; message?: string };
}

function progressToken(params: unknown): string {
  if (typeof params !== "object" || params === null) {
    return "";
  }
  return String((params as { token?: string }).token ?? "");
}

function isLineageProgress(params: unknown, kind: "begin" | "end"): boolean {
  const value = progressValue(params);
  if (!value || value.kind !== kind) {
    return false;
  }
  if (value.title === "Computing Lineage") {
    return true;
  }
  if (progressToken(params).includes("listNodes")) {
    return true;
  }
  return (
    typeof value.message === "string" &&
    value.message.includes("Waiting for compilation")
  );
}

function isAnalyzingProgress(params: unknown): boolean {
  const value = progressValue(params);
  if (!value) {
    return false;
  }
  return value.title === "Analyzing" || value.message === "Analyzing";
}

function fusionSkipReason(
  verdict: ReturnType<typeof checkFusionVersion>,
): string {
  switch (verdict.kind) {
    case "notFusion":
      return "dbt Fusion was not found on PATH";
    case "tooOld":
      return "dbt Fusion on PATH is older than 2.0.5";
    case "untestedMajor":
      return "dbt Fusion major version is untested";
    default:
      return "dbt Fusion on PATH is not supported for this probe";
  }
}

suite("Fusion LSP capture probe", function () {
  this.timeout(30_000);

  const fusionVerdict = checkFusionVersion();

  suiteSetup(function () {
    if (fusionVerdict.kind !== "ok") {
      console.warn(
        `Skipping Fusion LSP capture probe: ${fusionSkipReason(fusionVerdict)}.`,
      );
      this.skip();
    }
  });

  // Capture-client health probe: verifies stable cursors and retention over a
  // read-shaped command in a temp copy. Not product bootstrap or load proof.
  test("retains Computing Lineage progress after listNodes", async function () {
    const sourceRoot = fixturePath("single-project");
    const plainModelPath = "models/plain.sql";
    const fixture = await createLspFixture(sourceRoot, sourceRoot, {
      prepareProject(tempRoot) {
        fs.writeFileSync(
          path.join(tempRoot, plainModelPath),
          "select 1 as id\n",
        );
      },
    });

    try {
      await fixture.connect(10_000);
      const projectRoot = fixture.projectRoot;
      const plainUri = fileUri(path.join(projectRoot, plainModelPath));

      await fixture.request("initialize", {
        processId: process.pid,
        rootUri: fileUri(projectRoot),
        workspaceFolders: [
          { uri: fileUri(projectRoot), name: path.basename(projectRoot) },
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

      const openFiles = [
        path.join(projectRoot, "dbt_project.yml"),
        path.join(projectRoot, "models", "child.sql"),
        path.join(projectRoot, "models", "broken_ref.sql"),
        path.join(projectRoot, plainModelPath),
      ];

      for (const [index, filePath] of openFiles.entries()) {
        const text = fs.readFileSync(filePath, "utf-8");
        fixture.notify("textDocument/didOpen", {
          textDocument: {
            uri: fileUri(filePath),
            languageId: filePath.endsWith(".yml") ? "yaml" : "jinja-sql",
            version: index + 1,
            text,
          },
        });
      }

      await fixture.waitForNotification(
        "window/logMessage",
        (params) => {
          if (typeof params !== "object" || params === null) {
            return false;
          }
          const message = (params as { message?: string }).message ?? "";
          return message.includes("Did open:") && message.includes(plainUri);
        },
        15_000,
      );

      const progressCursor = fixture.notificationCount("$/progress");

      await fixture.request("workspace/executeCommand", {
        command: "dbt.listNodes",
        arguments: [],
      });

      await fixture.waitForNotification(
        "$/progress",
        (params) => isLineageProgress(params, "begin"),
        15_000,
        progressCursor,
      );
      await fixture.waitForNotification(
        "$/progress",
        (params) => isLineageProgress(params, "end"),
        15_000,
        progressCursor,
      );

      const progress = fixture.getNotificationsSince(
        "$/progress",
        progressCursor,
      );
      assert.ok(
        progress.some((params) => isLineageProgress(params, "begin")),
        "capture should retain Computing Lineage begin after listNodes cursor",
      );
      assert.ok(
        progress.some((params) => isLineageProgress(params, "end")),
        "capture should retain Computing Lineage end after listNodes cursor",
      );
      assert.strictEqual(fixture.getErrors().length, 0);

      void fixture
        .request("workspace/executeCommand", {
          command: "dbt.compileLsp",
          arguments: [],
        })
        .catch(() => {});
      void fixture
        .request("workspace/executeCommand", {
          command: "dbt.clearTarget",
          arguments: [],
        })
        .catch(() => {});

      const analyzing = fixture
        .getNotificationsSince("$/progress", progressCursor)
        .filter((params) => isAnalyzingProgress(params));
      if (analyzing.length > 0) {
        console.warn(
          `Optional Analyzing progress observed (${analyzing.length}); not required for capture health.`,
        );
      }
    } finally {
      await fixture.close();
    }
  });
});
