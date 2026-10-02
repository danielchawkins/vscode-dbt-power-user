import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { describe, expect, it, vi } from "vitest";
import { Uri, workspace } from "vscode";
import {
  createYMLContent,
  generateSchemaYML,
  mergeColumnsFromDB,
} from "../../projects/projectCodegen";
import type { WorkspaceEdit } from "../mock/vscode";

describe("projectCodegen", () => {
  it("creates the schema YAML through a WorkspaceEdit", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "codegen-"));
    try {
      vi.mocked(workspace.applyEdit).mockClear();
      vi.mocked(workspace.applyEdit).mockResolvedValue(true);
      const columns = { getColumnsOfModel: async () => [{ column: "id" }] };

      await generateSchemaYML(
        columns as never,
        Uri.file(path.join(root, "orders.sql")) as never,
        "orders",
      );

      const edit = vi.mocked(workspace.applyEdit).mock
        .calls[0][0] as unknown as WorkspaceEdit;
      const [created] = edit.createdFiles;
      expect(created.uri).toBe(Uri.file(path.join(root, "orders_schema.yml")));
      expect(new TextDecoder().decode(created.options?.contents)).toBe(
        createYMLContent([{ column: "id" }], "orders"),
      );
      expect(existsSync(path.join(root, "orders_schema.yml"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("renders a schema YAML document with one entry per column", () => {
    expect(
      createYMLContent([{ column: "id" }, { column: "name" }], "orders"),
    ).toBe(
      "version: 2\n\nmodels:\n" +
        '  - name: orders\n    description: ""\n    columns:\n' +
        '    - name: id\n      description: ""\n' +
        '    - name: name\n      description: ""\n',
    );
  });

  it("reports no merge when the warehouse returns no columns", () => {
    const node = { columns: {} };
    expect(mergeColumnsFromDB("postgres", node, [])).toBe(false);
    expect(node.columns).toEqual({});
  });

  it("adds warehouse columns and keeps existing data types", () => {
    const node = {
      columns: {
        id: { name: "id", data_type: "BIGINT", description: "key", meta: {} },
        name: { name: "name", description: "", meta: {} },
      } as Record<string, any>,
    };

    const merged = mergeColumnsFromDB("snowflake", node, [
      { column: "ID", dtype: "INTEGER" },
      { column: "NAME", dtype: "TEXT" },
      { column: "CREATED_AT", dtype: "TIMESTAMP" },
    ]);

    expect(merged).toBe(true);
    expect(node.columns.id.data_type).toBe("bigint");
    expect(node.columns.name.data_type).toBe("text");
    expect(node.columns.created_at).toEqual({
      name: "created_at",
      data_type: "timestamp",
      description: "",
      meta: {},
    });
  });
});
