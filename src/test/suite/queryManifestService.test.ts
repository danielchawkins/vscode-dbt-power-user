import { beforeEach, describe, expect, it, vi } from "vitest";
import { Uri } from "vscode";
import { QueryManifestService } from "../../projects/project/queryManifestService";

describe("QueryManifestService", () => {
  const modelPath = "/workspace/projects/general/models/general_model.sql";
  let service: QueryManifestService;
  let project: any;
  let currentProject: any;

  beforeEach(() => {
    project = {
      manifest: { publicationEpoch: 1 },
      ensureParsed: vi.fn(async () => undefined),
    };
    // The Project of a resource is resolved by CurrentProject; an omitted resource is the active editor's.
    currentProject = {
      current: project,
      forResource: vi.fn((uri?: Uri) =>
        uri === undefined || uri.fsPath === modelPath ? project : undefined,
      ),
    };
    service = new QueryManifestService(currentProject);
  });

  it("reads the manifest of the Project that owns the resource", () => {
    const uri = Uri.file(modelPath);

    expect(service.manifestFor(uri)).toBe(project.manifest);
    expect(currentProject.forResource).toHaveBeenCalledWith(uri);
  });

  it("returns undefined for a resource outside every Project", () => {
    expect(service.manifestFor(Uri.file("/outside/file.sql"))).toBeUndefined();
  });

  it("reads the Current Project's manifest when no resource is given", () => {
    expect(service.manifestFor()).toBe(project.manifest);
    expect(currentProject.forResource).toHaveBeenCalledWith(undefined);
  });

  it("parses the Project before reading its manifest", async () => {
    const order: string[] = [];
    project.ensureParsed = vi.fn(async () => void order.push("parsed"));
    vi.spyOn(service, "manifestFor").mockImplementation(() => {
      order.push("read");
      return undefined;
    });

    await service.freshManifest();

    expect(order).toEqual(["parsed", "read"]);
  });
});
