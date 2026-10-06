import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter, Uri } from "vscode";
import type { ParsedManifest } from "../../dbt_integration/domain";
import { ManifestMetadataSource } from "../../metadata/manifestMetadataSource";
import type { Project } from "../../projects/project";
import type { DeclaredProject } from "../../projects/projectRegistry";

describe("ManifestMetadataSource", () => {
  let source: ManifestMetadataSource;
  let parsed: EventEmitter<ParsedManifest>;
  let rebuildManifest: ReturnType<typeof vi.fn>;

  const parse = {} as ParsedManifest;

  beforeEach(() => {
    parsed = new EventEmitter<ParsedManifest>();
    rebuildManifest = vi.fn(async () => undefined);
    const project = {
      projectRoot: Uri.file("/test/project"),
      onDidParse: parsed.event,
      rebuildManifest,
    } as unknown as Project;
    source = new ManifestMetadataSource(
      { root: Uri.file("/test/project") } as DeclaredProject,
      project,
    );
  });

  afterEach(() => {
    source.dispose();
    parsed.dispose();
  });

  it("has no parse result before the first parse", () => {
    expect(source.current()).toBeUndefined();
  });

  it("forwards each parse result and keeps the latest", () => {
    const seen: ParsedManifest[] = [];
    source.onDidParse((p) => seen.push(p));
    parsed.fire(parse);
    expect(seen).toEqual([parse]);
    expect(source.current()).toBe(parse);
  });

  it("delegates refresh to project.rebuildManifest and propagates its errors", async () => {
    await source.refresh();
    expect(rebuildManifest).toHaveBeenCalled();
    rebuildManifest.mockRejectedValueOnce(new Error("Rebuild failed"));
    await expect(source.refresh()).rejects.toThrow("Rebuild failed");
  });
});
