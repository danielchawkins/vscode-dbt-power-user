import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter, Uri } from "vscode";
import type { ParsedManifest } from "../../core/dbt/domain";
import { ManifestMetadataSource } from "../../metadata/manifestMetadataSource";
import type { Project } from "../../projects/project/project";
import type { DeclaredProject } from "../../projects/registry/projectRegistry";

describe("ManifestMetadataSource", () => {
  let source: ManifestMetadataSource;
  let parsed: EventEmitter<ParsedManifest>;
  let rebuildManifest: ReturnType<typeof vi.fn>;

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

  it("delegates refresh to project.rebuildManifest and propagates its errors", async () => {
    await source.refresh();
    expect(rebuildManifest).toHaveBeenCalled();
    rebuildManifest.mockRejectedValueOnce(new Error("Rebuild failed"));
    await expect(source.refresh()).rejects.toThrow("Rebuild failed");
  });
});
