import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Uri } from "vscode";
import { DocGenService } from "../../features/docs/docGenService";

interface Setup {
  node?: Record<string, unknown>;
  modelPaths?: string[] | undefined;
  diagnostics?: Error;
  noProject?: boolean;
}

const makeService = (root: string, setup: Setup = {}) => {
  const project = setup.noProject
    ? undefined
    : {
        projectRoot: Uri.file(root),
        getModelPaths: () => setup.modelPaths ?? [path.join(root, "models")],
        log: { error: vi.fn() },
      };
  const projects = { get: () => project };
  const queryManifestService = {
    getEventByCurrentProject: () => ({
      event: { nodeMetaMap: { lookupByBaseName: () => setup.node } },
    }),
    getProjectByUri: () => ({
      throwDiagnosticsErrorIfAvailable: () => {
        if (setup.diagnostics) {
          throw setup.diagnostics;
        }
      },
    }),
  };
  return new DocGenService(projects as never, queryManifestService as never);
};

const node = (overrides: Record<string, unknown> = {}) => ({
  unique_id: "model.p.orders",
  resource_type: "model",
  description: "Orders",
  patch_path: "p://models/schema.yml",
  columns: {
    id: { name: "id", description: "Key", data_type: "INT" },
  },
  ...overrides,
});

const workspace = () => {
  const root = mkdtempSync(path.join(tmpdir(), "docgen-"));
  mkdirSync(path.join(root, "models"));
  return { root, file: path.join(root, "models", "orders.sql") };
};

describe("DocGenService", () => {
  it("warns for files that are not SQL", async () => {
    const { root } = workspace();
    const result = await makeService(root).getCompiledDocumentation(
      path.join(root, "models", "orders.py"),
    );
    expect(result.documentation).toBeUndefined();
    expect(result.message?.type).toBe("warning");
    expect(result.message?.message).toContain(".sql");
  });

  it("surfaces a project diagnostics error", async () => {
    const { root, file } = workspace();
    const result = await makeService(root, {
      diagnostics: new Error("broken project"),
    }).getCompiledDocumentation(file);
    expect(result).toEqual({
      documentation: undefined,
      message: { message: "broken project", type: "error" },
    });
  });

  it("reports a missing project, model path, node and resource type", async () => {
    const { root, file } = workspace();
    const message = async (setup: Setup) =>
      (await makeService(root, setup).getCompiledDocumentation(file)).message
        ?.message;
    expect(await message({ noProject: true })).toContain("dbt project");
    expect(
      await message({
        modelPaths: [path.join(root, "elsewhere")],
        node: node(),
      }),
    ).toContain("valid dbt model file");
    expect(await message({})).toContain("Model not found");
    expect(await message({ node: node({ resource_type: "seed" }) })).toContain(
      "only available for dbt models",
    );
  });

  it("builds compiled documentation from the manifest node", async () => {
    const { root, file } = workspace();
    const { documentation } = await makeService(root, {
      node: node(),
    }).getCompiledDocumentation(file);
    expect(documentation).toMatchObject({
      name: "orders",
      description: "Orders",
      uniqueId: "model.p.orders",
      filePath: file,
      generated: false,
      columns: [{ name: "id", description: "Key", type: "int" }],
    });
  });

  it("returns an empty skeleton without a patch path", async () => {
    const { root, file } = workspace();
    const { documentation } = await makeService(root, {
      node: node({ patch_path: undefined }),
    }).getUncompiledDocumentation(file);
    expect(documentation).toMatchObject({ description: "", columns: [] });
  });

  it("reads uncompiled documentation from the YAML file", async () => {
    const { root, file } = workspace();
    writeFileSync(
      path.join(root, "models", "schema.yml"),
      [
        "models:",
        "  - name: orders",
        "    description: From yaml",
        "    columns:",
        "      - name: id",
        "        data_type: BIGINT",
        "",
      ].join("\n"),
    );
    const { documentation } = await makeService(root, {
      node: node(),
    }).getUncompiledDocumentation(file);
    expect(documentation).toMatchObject({
      description: "From yaml",
      patchPath: "p://models/schema.yml",
      columns: [{ name: "id", description: "", type: "bigint" }],
    });
  });

  it("returns the skeleton when the YAML lacks the model", async () => {
    const { root, file } = workspace();
    writeFileSync(
      path.join(root, "models", "schema.yml"),
      "models:\n  - name: other\n",
    );
    const { documentation } = await makeService(root, {
      node: node(),
    }).getUncompiledDocumentation(file);
    expect(documentation).toMatchObject({ description: "", columns: [] });
  });

  it("falls back to the compiled documentation when the YAML cannot be read", async () => {
    const { root, file } = workspace();
    const { documentation } = await makeService(root, {
      node: node(),
    }).getUncompiledDocumentation(file);
    expect(documentation).toMatchObject({ description: "Orders" });
  });
});
