import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Uri, window, workspace } from "vscode";
import { parse } from "yaml";
import { DbtTestService } from "../../features/docs/dbtTestService";
import { DocsEditViewPanel } from "../../features/docs/docsEditPanel";
import {
  getTestDataByColumn,
  getTestDataByModel,
} from "../../features/docs/docsTestData";
import { createMockTextDocument, type WorkspaceEdit } from "../mock/vscode";

const deps = {
  terminal: { debug: vi.fn(), error: vi.fn() },
  dbtTestService: Object.create(DbtTestService.prototype),
} as never as {
  terminal: never;
  dbtTestService: never;
};

const modelTest = {
  test_metadata: { name: "unique_combo", kwargs: { model: "orders" } },
};
const columnTest = {
  column_name: "id",
  test_metadata: { name: "not_null", kwargs: { column_name: "id" } },
};

/** A panel for the project at `root`, built without its constructor's collaborators. */
function savePanel(root: string): SavePanel {
  const project = {
    projectRoot: Uri.file(root),
    getAdapterType: () => "duckdb",
  };
  return Object.assign(Object.create(DocsEditViewPanel.prototype), {
    dbtTestService: deps.dbtTestService,
    dbtTerminal: deps.terminal,
    projects: { get: () => project },
    getProject: () => project,
  });
}

/** The text after `edit`'s single replacement; the mock document reports offsets as the character of line 0. */
function applied(edit: WorkspaceEdit, before: string): string {
  const [replacement] = edit.replacements;
  return (
    before.slice(0, replacement.range.start.character) +
    replacement.newText +
    before.slice(replacement.range.end.character)
  );
}

describe("docs editor test key", () => {
  const model = (message: object, existing?: object) =>
    getTestDataByModel(message, "orders", existing, deps);
  const column = (message: object, existing?: object) =>
    getTestDataByColumn(message, "id", existing, deps);

  it("writes data_tests for a model whose YAML has no tests key", () => {
    const message = { updatedTests: [modelTest] };
    expect(model(message, {})).toEqual({ data_tests: ["unique_combo"] });
    expect(model(message)).toEqual({ data_tests: ["unique_combo"] });
  });

  it("keeps tests for a model whose YAML already uses tests", () => {
    const message = { updatedTests: [modelTest] };
    expect(model(message, { tests: [] })).toEqual({ tests: ["unique_combo"] });
  });

  it("writes data_tests for an existing column without a tests key", () => {
    const message = { updatedTests: [columnTest] };
    expect(column(message, { name: "id" })).toEqual({
      data_tests: ["not_null"],
    });
  });

  it("keeps tests for a column whose YAML already uses tests", () => {
    const message = { updatedTests: [columnTest] };
    expect(column(message, { name: "id", tests: [] })).toEqual({
      tests: ["not_null"],
    });
  });
});

describe("docs editor save", () => {
  const schemaYaml =
    "models:\n  - name: orders\n    columns:\n      - name: amount\n";
  let root: string;
  let panel: SavePanel;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "docs-save-"));
    mkdirSync(path.join(root, "models"));
    writeFileSync(path.join(root, "models", "schema.yml"), schemaYaml);
    vi.mocked(workspace.openTextDocument).mockResolvedValue(
      createMockTextDocument(schemaYaml) as never,
    );
    vi.mocked(workspace.applyEdit).mockClear();
    panel = savePanel(root);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const save = (patchPath?: string, dialogType?: string) =>
    panel.saveDocumentation({
      name: "orders",
      filePath: path.join(root, "models", "orders.sql"),
      patchPath,
      dialogType,
      columns: [{ name: "id" }],
      updatedTests: [columnTest],
    });

  it("writes data_tests for a column added to a model that already has YAML", async () => {
    expect(await save("project://models/schema.yml")).toBe(true);

    const edit = vi.mocked(workspace.applyEdit).mock
      .calls[0][0] as unknown as WorkspaceEdit;
    expect(edit.replacements).toHaveLength(1);
    const written = parse(applied(edit, schemaYaml));
    expect(written.models[0].columns[1]).toEqual({
      name: "id",
      data_tests: ["not_null"],
    });
    expect(readFileSync(path.join(root, "models", "schema.yml"), "utf8")).toBe(
      schemaYaml,
    );
  });

  it("applies to a schema file with unsaved changes, leaves it unsaved and says so", async () => {
    const unsaved = `${schemaYaml}      - name: draft\n`;
    const document = createMockTextDocument(unsaved, true);
    vi.mocked(workspace.openTextDocument).mockResolvedValue(document as never);
    vi.mocked(window.showWarningMessage).mockClear();

    expect(await save("project://models/schema.yml")).toBe(true);

    const edit = vi.mocked(workspace.applyEdit).mock
      .calls[0][0] as unknown as WorkspaceEdit;
    const columns = parse(applied(edit, unsaved)).models[0].columns;
    expect(columns.map((c: { name: string }) => c.name)).toEqual([
      "amount",
      "draft",
      "id",
    ]);
    expect(document.save).not.toHaveBeenCalled();
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      "schema.yml has unsaved changes; your documentation was applied but not saved",
    );
  });

  it("creates a new schema file chosen in the save dialog", async () => {
    vi.mocked(window.showSaveDialog).mockResolvedValue(
      Uri.file(path.join(root, "models", "new.yml")),
    );

    expect(await save(undefined, "New file")).toBe(true);

    const edit = vi.mocked(workspace.applyEdit).mock
      .calls[0][0] as unknown as WorkspaceEdit;
    expect(edit.replacements).toHaveLength(0);
    const contents = edit.createdFiles[0].options?.contents;
    expect(parse(new TextDecoder().decode(contents)).models[0].name).toBe(
      "orders",
    );
  });

  it("reports not saved and edits nothing when the dialog is cancelled", async () => {
    vi.mocked(window.showSaveDialog).mockResolvedValue(undefined);

    expect(await save(undefined, "New file")).toBe(false);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });
});

interface SavePanel {
  saveDocumentation(message: unknown): Promise<boolean>;
}
