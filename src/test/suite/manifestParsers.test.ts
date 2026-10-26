import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Log } from "../../core/log";
import type { ManifestProject } from "../../core/manifest";
import {
  DocParser,
  MacroParser,
  MetricParser,
  NodeParser,
  SourceParser,
} from "../../core/manifest";
import { RelationshipParser } from "../../core/manifest/relationshipParser";
import type { ProjectPaths } from "../../core/snapshot";

const logger = { debug: () => undefined } as unknown as Pick<Log, "debug">;

function project(packagePath: string | undefined): ManifestProject {
  return {
    getProjectRoot: () => "/p",
    getProjectName: () => "p",
    paths: () =>
      ({
        packagesInstallPath: packagePath,
        targetPath: "/p/target",
      }) as Pick<ProjectPaths, "targetPath" | "packagesInstallPath">,
  };
}

const docs = {
  "doc.p.d": { package_name: "p", name: "d", original_file_path: "d.md" },
};
const nodes = {
  "model.p.m": { resource_type: "model", name: "m", package_name: "p" },
};

describe("manifest parsers", () => {
  it("reject instead of hanging when the package path is unknown", async () => {
    await expect(
      new NodeParser(logger).createNodeMetaMap(
        nodes as never,
        project(undefined),
      ),
    ).rejects.toThrow("packagePath is not defined");
    await expect(
      new MacroParser(logger).createMacroMetaMap({}, project(undefined)),
    ).rejects.toThrow("packagePath is not defined");
    await expect(
      new DocParser(logger).createDocMetaMap(docs as never, project(undefined)),
    ).rejects.toThrow("packagePath is not defined");
  });

  it("keep parsing later docs when an earlier doc's package is not installed", async () => {
    const root = mkdtempSync(join(tmpdir(), "doc-parser-"));
    try {
      mkdirSync(join(root, "docs"));
      writeFileSync(
        join(root, "docs", "d.md"),
        "{% docs d %}\nbody\n{% enddocs %}\n",
      );
      const rootProject: ManifestProject = {
        getProjectRoot: () => root,
        getProjectName: () => "p",
        paths: () => ({
          packagesInstallPath: join(root, "dbt_packages"),
          targetPath: join(root, "target"),
        }),
      };
      const map = await new DocParser(logger).createDocMetaMap(
        {
          "doc.other.x": {
            package_name: "other",
            name: "x",
            original_file_path: "docs/x.md",
          },
          "doc.p.d": {
            package_name: "p",
            name: "d",
            original_file_path: "docs/d.md",
          },
        } as never,
        rootProject,
      );
      expect([...map.keys()]).toEqual(["d"]);
      expect(map.get("d")?.line).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("return an empty map for an absent section", async () => {
    const p = project("/p/dbt_packages");
    expect(
      (await new MacroParser(logger).createMacroMetaMap(undefined, p)).size,
    ).toBe(0);
    expect(
      (await new MetricParser(logger).createMetricMetaMap(null, p)).size,
    ).toBe(0);
    expect(
      (await new DocParser(logger).createDocMetaMap(undefined, p)).size,
    ).toBe(0);
    expect([
      ...(await new NodeParser(logger).createNodeMetaMap(undefined, p)).nodes(),
    ]).toEqual([]);
  });

  it("key metrics by name across the record", async () => {
    const metrics = await new MetricParser(logger).createMetricMetaMap(
      {
        "semantic_model.p.a": { name: "a" },
        "semantic_model.p.b": { name: "b" },
      },
      project("/p/dbt_packages"),
    );
    expect([...metrics.keys()]).toEqual(["a", "b"]);
  });

  it("keep each source table's own meta, so a hidden table stays hidden", async () => {
    const sources = {
      "source.p.raw.events": {
        resource_type: "source",
        source_name: "raw",
        name: "events",
        database: "RAW",
        schema: "landing",
        unique_id: "source.p.raw.events",
        original_file_path: "models/sources.yml",
        description: "",
        columns: {},
        package_name: "p",
        meta: { lineage: { hidden: true } },
      },
    };
    const map = await new SourceParser(logger).createSourceMetaMap(
      sources as never,
      project("/p/dbt_packages"),
    );
    expect(map.get("raw")?.tables[0]?.meta).toEqual({
      lineage: { hidden: true },
    });
  });

  it("read a source table's meta.relationships from config.meta into a declared ref", async () => {
    const relationships = [
      { from_columns: ["hub_id"], to: "ref('hub')", to_columns: ["id"] },
    ];
    const sources = {
      "source.p.raw.events": {
        resource_type: "source",
        source_name: "raw",
        name: "events",
        unique_id: "source.p.raw.events",
        original_file_path: "models/sources.yml",
        description: "",
        columns: {},
        package_name: "p",
        config: { meta: { relationships } },
      },
    };
    const nodes = {
      "model.p.hub": {
        resource_type: "model",
        name: "hub",
        unique_id: "model.p.hub",
        original_file_path: "models/hub.sql",
        package_name: "p",
      },
    };
    const p = project("/p/dbt_packages");
    const nodeMetaMap = await new NodeParser(logger).createNodeMetaMap(
      nodes as never,
      p,
    );
    const map = await new SourceParser(logger).createSourceMetaMap(
      sources as never,
      p,
    );

    const table = map.get("raw")?.tables[0];
    expect(table?.configMeta).toEqual({ relationships });
    expect(table?.unique_id).toBe("source.p.raw.events");

    expect(new RelationshipParser(logger).fromMeta(nodeMetaMap, map)).toEqual([
      {
        id: "meta:source.p.raw.events[0]",
        from: { table: "source.p.raw.events", columns: ["hub_id"] },
        to: { table: "model.p.hub", columns: ["id"] },
        cardinality: "many-to-one",
        source: "meta",
      },
    ]);
  });
});
