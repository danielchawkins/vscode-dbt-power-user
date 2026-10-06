import { describe, expect, it } from "vitest";
import type { Log } from "../../core/log";
import {
  DocParser,
  MacroParser,
  ManifestProject,
  MetricParser,
  NodeParser,
} from "../../core/manifest";

const logger = { debug: () => undefined } as unknown as Pick<Log, "debug">;

function project(packagePath: string | undefined): ManifestProject {
  return {
    getProjectRoot: () => "/p",
    getProjectName: () => "p",
    getPackageInstallPath: () => packagePath,
    getTargetPath: () => "/p/target",
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
});
