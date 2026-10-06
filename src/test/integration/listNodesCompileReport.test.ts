import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { EventEmitter } from "vscode";
import { FusionCommandError } from "../../core/lsp";
import { createFusionCommands } from "../../fusion/fusionCommands";
import type { FusionClient } from "../../fusion/fusionLanguageClient";
import { ServerMetadataSource } from "../../metadata/serverMetadataSource";
import { checkFusionVersion, fixturePath } from "./helpers/testFixtures";
import { createLspFixture, type LspFixture } from "./lspFixture";

/**
 * Pins what the Server Producer relies on. Every `dbt.listNodes` makes the server send one
 * `dbt/lspCompileComplete` and, about 1.3 s later, one `dbt/lspBackgroundCompileComplete`; `dbt.getProjectInfo` and
 * `dbt.compileFile` on a compiled file send none. A refresh that followed every report would loop; the second test
 * drives the real producer against the real server and counts its requests.
 */
const REPORTS = ["dbt/lspCompileComplete", "dbt/lspBackgroundCompileComplete"];
const LAST_REPORT_WAIT_MS = 4_000;
const SETTLE_MS = 6_000;

const fileUri = (fsPath: string): string => pathToFileURL(fsPath).href;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function openCompiledProject(): Promise<{
  fixture: LspFixture;
  file: string;
}> {
  const sourceRoot = fixturePath("single-project");
  const fixture = await createLspFixture(sourceRoot, sourceRoot);
  try {
    await fixture.connect(10_000);
    const root = fixture.projectRoot;
    await fixture.request("initialize", {
      processId: process.pid,
      rootUri: fileUri(root),
      workspaceFolders: [{ uri: fileUri(root), name: path.basename(root) }],
      capabilities: {
        window: { workDoneProgress: true },
        workspace: { configuration: true },
        textDocument: { synchronization: { dynamicRegistration: true } },
      },
    });
    fixture.notify("initialized", {});
    const file = path.join(root, "models", "child.sql");
    fixture.notify("textDocument/didOpen", {
      textDocument: {
        uri: fileUri(file),
        languageId: "jinja-sql",
        version: 1,
        text: fs.readFileSync(file, "utf-8"),
      },
    });
    await fixture.waitForNotification(
      "dbt/lspBackgroundCompileComplete",
      () => true,
      60_000,
    );
    await sleep(SETTLE_MS);
    return { fixture, file };
  } catch (error) {
    await fixture.close();
    throw error;
  }
}

suite("Compile reports caused by our own requests", function () {
  this.timeout(120_000);

  const verdict = checkFusionVersion();

  suiteSetup(function () {
    if (verdict.kind !== "ok") {
      console.warn("Skipping compile report test: Fusion 2.0.6+ required.");
      this.skip();
    }
  });

  test("listNodes is answered by one report of each kind; the other commands by none", async function () {
    const { fixture, file } = await openCompiledProject();
    try {
      const counts = () =>
        REPORTS.map((method) => fixture.notificationCount(method));
      const run = async (command: string, args: unknown[]) => {
        const before = counts();
        await fixture.request("workspace/executeCommand", {
          command,
          arguments: args,
        });
        await sleep(LAST_REPORT_WAIT_MS);
        return counts().map((count, index) => count - before[index]);
      };

      assert.deepStrictEqual(
        await run("dbt.listNodes", ["+package:single_project"]),
        [1, 1],
        "listNodes",
      );
      assert.deepStrictEqual(
        await run("dbt.getProjectInfo", []),
        [0, 0],
        "getProjectInfo",
      );
      assert.deepStrictEqual(
        await run("dbt.compileFile", [fileUri(file)]),
        [0, 0],
        "compileFile",
      );
    } finally {
      await fixture.close();
    }
  });

  test("the Server Producer sends one listNodes per source change, however late the server reports", async function () {
    const { fixture, file } = await openCompiledProject();
    const reports = new EventEmitter<void>();
    const sourceChanged = new EventEmitter<void>();
    const clientChanged = new EventEmitter<void>();
    const subscriptions = REPORTS.map((method) =>
      fixture.onNotification(method, () => reports.fire()),
    );
    let listNodesRequests = 0;
    const client = {
      state: "running",
      request: async (command: string, payload: unknown) => {
        if (command === "dbt.listNodes") {
          listNodesRequests += 1;
        }
        try {
          return await fixture.request("workspace/executeCommand", {
            command,
            arguments: payload,
          });
        } catch (error) {
          throw new FusionCommandError("server", String(error));
        }
      },
    } as unknown as FusionClient;
    const source = new ServerMetadataSource(
      createFusionCommands(() => client),
      () => "single_project",
      {
        compileComplete: reports.event,
        sourceChanged: sourceChanged.event,
        clientChanged: clientChanged.event,
      },
      { debug: () => undefined, warn: () => undefined },
    );
    try {
      reports.fire();
      await sleep(SETTLE_MS);
      assert.strictEqual(
        listNodesRequests,
        1,
        "the first fetch's own reports must start nothing",
      );
      assert.ok(source.current(), "the first fetch must produce a value");

      const text = `${fs.readFileSync(file, "utf-8")}\n-- edit\n`;
      fs.writeFileSync(file, text);
      fixture.notify("textDocument/didChange", {
        textDocument: { uri: fileUri(file), version: 2 },
        contentChanges: [{ text }],
      });
      fixture.notify("textDocument/didSave", {
        textDocument: { uri: fileUri(file) },
      });
      await sleep(500);
      sourceChanged.fire();
      await sleep(SETTLE_MS);
      assert.strictEqual(
        listNodesRequests,
        2,
        "a source change costs one listNodes, and the reports it causes start no more",
      );
    } finally {
      subscriptions.forEach((subscription) => subscription.dispose());
      source.dispose();
      reports.dispose();
      sourceChanged.dispose();
      clientChanged.dispose();
      await fixture.close();
    }
  });
});
