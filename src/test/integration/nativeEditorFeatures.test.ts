import * as assert from "assert";
import { spawnSync } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import which from "which";
import { getExtensionRoot } from "./helpers/testFixtures";
import { waitForExtensionActivation } from "./helpers/workspaceHelper";

/**
 * Records what native Fusion LSP editor features return through VS Code, vscode-languageclient and this
 * extension. runTests.ts opens a fresh native-editor fixture copy once per static-analysis mode when
 * FPU_RUN_NATIVE_EDITOR_EVIDENCE=1, naming the mode in FPU_NATIVE_EDITOR_MODE. Each launch merges its results
 * into the JSON file at NATIVE_EDITOR_EVIDENCE_OUT (default under os.tmpdir()).
 */

const MODE = process.env.FPU_NATIVE_EDITOR_MODE;
const READY_TIMEOUT_MS = 90_000;
const COLUMN_SETTLE_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 250;
const EVIDENCE_PATH =
  process.env.NATIVE_EDITOR_EVIDENCE_OUT ??
  path.join(os.tmpdir(), "fpu-native-editor-evidence.json");

type Recorded =
  | { ok: true; value: unknown; elapsedMs: number; attempts: number }
  | { ok: false; error: string; elapsedMs: number; attempts: number };

interface Probe {
  file: string;
  find: string;
  offset: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rangeText(range: vscode.Range): string {
  return `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
}

function serializeLocations(
  value: (vscode.Location | vscode.LocationLink)[] | undefined,
) {
  return (value ?? []).map((location) =>
    "targetUri" in location
      ? {
          file: path.basename(location.targetUri.fsPath),
          range: rangeText(location.targetRange),
          selectionRange: location.targetSelectionRange
            ? rangeText(location.targetSelectionRange)
            : undefined,
        }
      : {
          file: path.basename(location.uri.fsPath),
          range: rangeText(location.range),
        },
  );
}

function serializeHovers(hovers: vscode.Hover[] | undefined) {
  return (hovers ?? []).map((hover) => ({
    range: hover.range ? rangeText(hover.range) : undefined,
    contents: hover.contents.map((content) =>
      typeof content === "string"
        ? content
        : "value" in content
          ? content.value
          : String(content),
    ),
  }));
}

function serializeWorkspaceEdit(edit: vscode.WorkspaceEdit | undefined) {
  return edit?.entries().map(([uri, edits]) => ({
    file: path.basename(uri.fsPath),
    edits: edits.map((textEdit) => ({
      range: rangeText(textEdit.range),
      newText: textEdit.newText,
    })),
  }));
}

function serializeCodeLenses(lenses: vscode.CodeLens[] | undefined) {
  return (lenses ?? []).map((lens) => ({
    range: rangeText(lens.range),
    title: lens.command?.title,
    command: lens.command?.command,
  }));
}

function serializePrepareRename(
  value:
    { range: vscode.Range; placeholder: string } | vscode.Range | undefined,
) {
  if (value === undefined || value === null) {
    return value;
  }
  return value instanceof vscode.Range
    ? { range: rangeText(value) }
    : { range: rangeText(value.range), placeholder: value.placeholder };
}

function isNonEmpty(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : value != null;
}

/** Runs a call, retrying until it returns something non-empty or `settleMs` passes; records the last outcome. */
async function record<T>(
  call: () => Thenable<T>,
  serialize: (value: T) => unknown,
  settleMs = 0,
): Promise<Recorded> {
  const started = Date.now();
  let attempts = 0;
  for (;;) {
    attempts += 1;
    let outcome: Recorded;
    try {
      const value = serialize(await call());
      outcome = { ok: true, value, elapsedMs: Date.now() - started, attempts };
      if (isNonEmpty(value)) {
        return outcome;
      }
    } catch (error) {
      outcome = {
        ok: false,
        error: errorText(error),
        elapsedMs: Date.now() - started,
        attempts,
      };
    }
    if (Date.now() - started >= settleMs) {
      return outcome;
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

function fusionProcesses(projectDir: string): string[] {
  const ps = spawnSync("ps", ["-axww", "-o", "command="], {
    encoding: "utf-8",
  });
  return (ps.stdout ?? "")
    .split("\n")
    .filter((line) => line.includes(" lsp ") && line.includes(projectDir));
}

function describeDbtOnHostPath(): Record<string, unknown> {
  const resolved = which.sync("dbt", { nothrow: true });
  const real = resolved ? fs.realpathSync(resolved) : null;
  const version = spawnSync("dbt", ["--version"], {
    encoding: "utf-8",
    timeout: 10_000,
  });
  return {
    whichDbt: resolved,
    realpath: real,
    sha256: real
      ? createHash("sha256").update(fs.readFileSync(real)).digest("hex")
      : null,
    version: (version.stdout || version.stderr || "").trim(),
    configuredDbtPath:
      vscode.workspace.getConfiguration("fusionPowerUser").get("dbtPath") ??
      null,
  };
}

function languageClientVersion(): string {
  const manifest = path.join(
    getExtensionRoot(),
    "node_modules",
    "vscode-languageclient",
    "package.json",
  );
  return (JSON.parse(fs.readFileSync(manifest, "utf-8")) as { version: string })
    .version;
}

function readEvidence(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(EVIDENCE_PATH, "utf-8")) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

suite("Native Fusion editor features through VS Code (evidence)", function () {
  this.timeout(10 * 60_000);

  const results: Record<string, Recorded> = {};
  const meta: Record<string, unknown> = {};
  let projectDir = "";

  suiteSetup(async function () {
    if (!MODE) {
      this.skip();
      return;
    }
    await waitForExtensionActivation(30_000);
    projectDir = vscode.workspace.workspaceFolders![0].uri.fsPath;
    const setupFile = path.join(projectDir, ".native-editor-setup.json");
    Object.assign(meta, {
      recordedAt: new Date().toISOString(),
      vscodeVersion: vscode.version,
      vscodeLanguageclientVersion: languageClientVersion(),
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      projectDir,
      configuredStaticAnalysis: vscode.workspace
        .getConfiguration("fusionPowerUser", vscode.Uri.file(projectDir))
        .get("staticAnalysis"),
      setupRaw: fs.existsSync(setupFile)
        ? JSON.parse(fs.readFileSync(setupFile, "utf-8"))
        : null,
      dbtOnExtensionHostPath: describeDbtOnHostPath(),
      extensionHostEnv: {
        FUSION_POWER_USER_SCHEMA_ORIGIN:
          process.env.FUSION_POWER_USER_SCHEMA_ORIGIN ?? null,
        DBT_PROFILES_DIR: process.env.DBT_PROFILES_DIR ?? null,
      },
    });
  });

  suiteTeardown(async function () {
    if (!MODE) {
      return;
    }
    const evidence = readEvidence();
    evidence[MODE] = { meta, results };
    fs.mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
    fs.writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`native editor evidence (${MODE}) written to ${EVIDENCE_PATH}`);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test(`records hover, definition, references, rename and codeLens (${MODE ?? "unset"})`, async function () {
    const documents = new Map<string, vscode.TextDocument>();
    for (const name of [
      "stg_orders.sql",
      "order_totals.sql",
      "totals_downstream.sql",
      "hard.sql",
    ]) {
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.file(path.join(projectDir, "models", name)),
      );
      await vscode.window.showTextDocument(document, { preview: false });
      documents.set(name, document);
    }
    meta.languageIds = Object.fromEntries(
      [...documents].map(([name, document]) => [name, document.languageId]),
    );

    const at = (probe: Probe): [vscode.Uri, vscode.Position] => {
      const document = documents.get(probe.file)!;
      const index = document.getText().indexOf(probe.find);
      assert.ok(index >= 0, `${probe.find} not found in ${probe.file}`);
      return [document.uri, document.positionAt(index + probe.offset)];
    };
    const hover = (probe: Probe) => () =>
      vscode.commands.executeCommand<vscode.Hover[]>(
        "vscode.executeHoverProvider",
        ...at(probe),
      );
    const definition = (probe: Probe) => () =>
      vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
        "vscode.executeDefinitionProvider",
        ...at(probe),
      );
    const rename = (probe: Probe, newName: string) => () =>
      vscode.commands.executeCommand<vscode.WorkspaceEdit>(
        "vscode.executeDocumentRenameProvider",
        ...at(probe),
        newName,
      );

    const refStgOrders = {
      file: "order_totals.sql",
      find: "stg_orders",
      offset: 2,
    };
    const aliasTotal = {
      file: "order_totals.sql",
      find: "as total",
      offset: 4,
    };
    const customerId = {
      file: "order_totals.sql",
      find: "customer_id,",
      offset: 2,
    };
    const downstreamTotal = {
      file: "totals_downstream.sql",
      find: "total as",
      offset: 1,
    };

    // Hover on ref() answers in every mode once the server has loaded the project, so it gates the rest.
    results["hover ref('stg_orders') (readiness)"] = await record(
      hover(refStgOrders),
      serializeHovers,
      READY_TIMEOUT_MS,
    );
    // Column answers may lag table-level ones; the first column request gets time to settle.
    results["hover * in stg_orders"] = await record(
      hover({ file: "stg_orders.sql", find: "*", offset: 0 }),
      serializeHovers,
      COLUMN_SETTLE_TIMEOUT_MS,
    );
    results["hover customer_id in order_totals"] = await record(
      hover(customerId),
      serializeHovers,
    );
    results["hover alias total in order_totals"] = await record(
      hover(aliasTotal),
      serializeHovers,
    );
    results["definition customer_id in order_totals"] = await record(
      definition(customerId),
      serializeLocations,
    );
    results["definition total in totals_downstream"] = await record(
      definition(downstreamTotal),
      serializeLocations,
    );
    results["references alias total"] = await record(
      () =>
        vscode.commands.executeCommand<vscode.Location[]>(
          "vscode.executeReferenceProvider",
          ...at(aliasTotal),
        ),
      serializeLocations,
    );
    results["prepareRename alias total"] = await record(
      () =>
        vscode.commands.executeCommand<
          { range: vscode.Range; placeholder: string } | vscode.Range
        >("vscode.prepareRename", ...at(aliasTotal)),
      serializePrepareRename,
    );
    results["rename alias total -> total_amount"] = await record(
      rename(aliasTotal, "total_amount"),
      serializeWorkspaceEdit,
    );
    results["rename customer_id -> cust_id"] = await record(
      rename(customerId, "cust_id"),
      serializeWorkspaceEdit,
    );
    results["rename alias label in hard.sql -> customer_name"] = await record(
      rename(
        { file: "hard.sql", find: "as label", offset: 4 },
        "customer_name",
      ),
      serializeWorkspaceEdit,
    );
    results["codeLens order_totals"] = await record(
      () =>
        vscode.commands.executeCommand<vscode.CodeLens[]>(
          "vscode.executeCodeLensProvider",
          documents.get("order_totals.sql")!.uri,
        ),
      serializeCodeLenses,
    );
    meta.fusionLspProcesses = fusionProcesses(fs.realpathSync(projectDir));

    // Assertions are written from the first recorded run; the evidence file is the primary output.
    assertObserved(MODE!, results);
  });
});

function valueOf(results: Record<string, Recorded>, key: string): unknown {
  const outcome = results[key];
  assert.ok(outcome?.ok, `${key} rejected: ${JSON.stringify(outcome)}`);
  return outcome.value;
}

function errorOf(results: Record<string, Recorded>, key: string): string {
  const outcome = results[key];
  assert.ok(
    outcome && !outcome.ok,
    `${key} resolved: ${JSON.stringify(outcome)}`,
  );
  return outcome.error;
}

/** Written from the first recorded run (Fusion 2.0.6, VS Code 1.128.0, vscode-languageclient 10.1.1). */
function assertObserved(mode: string, results: Record<string, Recorded>) {
  const json = (key: string) => JSON.stringify(valueOf(results, key));
  // Fusion advertises renameProvider without prepareProvider, so VS Code answers prepareRename itself.
  assert.deepStrictEqual(valueOf(results, "prepareRename alias total"), {
    range: "0:35-0:40",
    placeholder: "total",
  });
  // Only the extension's own SqlActionsCodeLensProvider contributes lenses.
  assert.deepStrictEqual(
    (valueOf(results, "codeLens order_totals") as { command: string }[]).map(
      (lens) => lens.command,
    ),
    ["fusionPowerUser.executeSQL", "fusionPowerUser.DocsEdit.focus"],
  );
  assert.match(
    json("hover ref('stg_orders') (readiness)"),
    /Parent Models.*orders.*Children Models.*order_totals/,
  );

  if (mode === "strict") {
    assert.match(json("hover * in stg_orders"), /amount \| decimal\(10, 2\)/);
    assert.match(
      json("hover customer_id in order_totals"),
      /customer_id \| integer \| probe\.main\.stg_orders/,
    );
    assert.match(
      json("hover alias total in order_totals"),
      /total \| decimal\(38, 2\)/,
    );
    assert.deepStrictEqual(
      valueOf(results, "definition customer_id in order_totals"),
      [{ file: "stg_orders.sql", range: "0:7-0:8" }],
    );
    assert.deepStrictEqual(
      valueOf(results, "definition total in totals_downstream"),
      [{ file: "order_totals.sql", range: "0:20-0:40" }],
    );
    assert.deepStrictEqual(valueOf(results, "references alias total"), [
      { file: "order_totals.sql", range: "0:35-0:40" },
      { file: "totals_downstream.sql", range: "0:20-0:25" },
    ]);
    assert.deepStrictEqual(
      valueOf(results, "rename alias total -> total_amount"),
      [
        {
          file: "order_totals.sql",
          edits: [{ range: "0:35-0:40", newText: "total_amount" }],
        },
        {
          file: "totals_downstream.sql",
          edits: [{ range: "0:20-0:25", newText: "total_amount" }],
        },
      ],
    );
    assert.strictEqual(
      errorOf(results, "rename customer_id -> cust_id"),
      "Cannot rename a column that is not an alias.",
    );
    assert.deepStrictEqual(
      valueOf(results, "rename alias label in hard.sql -> customer_name"),
      [
        {
          file: "hard.sql",
          edits: [{ range: "6:19-6:24", newText: "customer_name" }],
        },
      ],
    );
    return;
  }

  for (const key of [
    "hover * in stg_orders",
    "hover customer_id in order_totals",
    "hover alias total in order_totals",
    "definition customer_id in order_totals",
    "definition total in totals_downstream",
    "references alias total",
  ]) {
    assert.deepStrictEqual(valueOf(results, key), [], key);
  }
  for (const key of [
    "rename alias total -> total_amount",
    "rename customer_id -> cust_id",
    "rename alias label in hard.sql -> customer_name",
  ]) {
    assert.strictEqual(errorOf(results, key), "No result.", key);
  }
}
