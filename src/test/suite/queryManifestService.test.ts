import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Uri, window } from "vscode";
import { QueryManifestService } from "../../services/queryManifestService";

describe("QueryManifestService.rewire", () => {
  let service: QueryManifestService;
  let containerDouble: any;
  let contextDouble: any;

  beforeEach(() => {
    jest.clearAllMocks();
    (window.activeTextEditor as any) = undefined;

    const mockProject = {
      projectRoot: Uri.file("/workspace/projects/general"),
    } as any;
    const declaredProject = {
      root: Uri.file("/workspace/projects/general"),
      contains: (uri: Uri) =>
        uri.fsPath.startsWith("/workspace/projects/general/"),
    };

    containerDouble = {
      findDBTProject: jest.fn((uri: any) =>
        (uri as any)?.fsPath === "/workspace/projects/general"
          ? mockProject
          : undefined,
      ),
      getProjects: jest.fn(() => []),
      getProjectRootpath: jest.fn(() => {
        throw new Error("legacy root lookup must not run");
      }),
      onDBTProjectsInitialization: jest.fn(),
      onManifestChanged: jest.fn(),
    };

    const forResourceMock = jest.fn((uri: any) =>
      (uri as any)?.fsPath ===
      "/workspace/projects/general/models/general_model.sql"
        ? declaredProject
        : undefined,
    );

    contextDouble = {
      forResource: forResourceMock,
      current: declaredProject,
      requireForCommand: jest.fn(),
    };

    service = new QueryManifestService(
      containerDouble as any,
      { debug: jest.fn(), error: jest.fn(), warn: jest.fn() } as any,
      { fire: jest.fn() } as any,
      contextDouble as any,
    );
  });

  describe("getProject", () => {
    it("maps context.current root to DBTProject", () => {
      const result = service.getProject();
      expect(result).toBeDefined();
      expect(containerDouble.findDBTProject).toHaveBeenCalledWith(
        contextDouble.current.root,
      );
    });

    it("returns undefined when current is undefined or no DBTProject at root", () => {
      contextDouble.current = undefined;
      expect(service.getProject()).toBeUndefined();

      contextDouble.current = { root: Uri.file("/nonexistent") };
      expect(service.getProject()).toBeUndefined();
    });
  });

  describe("getProjectByUri", () => {
    it("maps forResource(uri) to DBTProject, no fallback", () => {
      const uri = Uri.file(
        "/workspace/projects/general/models/general_model.sql",
      );
      const result = service.getProjectByUri(uri);

      expect(result).toBeDefined();
      expect(contextDouble.forResource).toHaveBeenCalledWith(uri);
    });

    it("returns undefined for uri outside projects", () => {
      const uri = Uri.file("/outside/file.sql");
      const result = service.getProjectByUri(uri);

      expect(result).toBeUndefined();
      expect(contextDouble.forResource).toHaveBeenCalledWith(uri);
    });

    it("returns undefined when uri is undefined", () => {
      expect(service.getProjectByUri(undefined)).toBeUndefined();
      expect(contextDouble.forResource).not.toHaveBeenCalled();
    });

    it("never substitutes a resource when the declared root is absent", () => {
      const uri = Uri.file(
        "/workspace/projects/general/models/general_model.sql",
      );
      containerDouble.findDBTProject.mockImplementation((candidate: Uri) =>
        candidate === uri ? { projectRoot: Uri.file("/wrong") } : undefined,
      );

      expect(service.getProjectByUri(uri)).toBeUndefined();
      expect(containerDouble.findDBTProject).toHaveBeenCalledTimes(1);
      expect(containerDouble.findDBTProject).toHaveBeenCalledWith(
        contextDouble.current.root,
      );
    });
  });

  describe("getOrPickProjectFromWorkspace", () => {
    it("passes activeEditor.uri to requireForCommand and maps result", async () => {
      const editorUri = Uri.file(
        "/workspace/projects/general/models/general_model.sql",
      );
      (window.activeTextEditor as any) = { document: { uri: editorUri } };

      jest
        .spyOn(contextDouble, "requireForCommand" as any)
        .mockResolvedValue({ root: Uri.file("/workspace/projects/general") });

      const result = await service.getOrPickProjectFromWorkspace();

      expect(contextDouble.requireForCommand).toHaveBeenCalledWith(editorUri);
      expect(result).toBeDefined();
    });

    it("returns undefined when requireForCommand resolves undefined (cancel or no projects)", async () => {
      jest
        .spyOn(contextDouble, "requireForCommand" as any)
        .mockResolvedValue(undefined);

      const result = await service.getOrPickProjectFromWorkspace();
      expect(result).toBeUndefined();
    });

    it("never substitutes the active resource for a picked project", async () => {
      const editorUri = Uri.file("/workspace/pipelines/pipeline.sql");
      const selected = {
        root: Uri.file("/workspace/projects/sox"),
        contains: () => false,
      };
      (window.activeTextEditor as any) = { document: { uri: editorUri } };
      contextDouble.requireForCommand.mockResolvedValue(selected);
      containerDouble.findDBTProject.mockImplementation((uri: Uri) =>
        uri === editorUri ? { projectRoot: Uri.file("/wrong") } : undefined,
      );

      await expect(
        service.getOrPickProjectFromWorkspace(),
      ).resolves.toBeUndefined();
      expect(containerDouble.findDBTProject).toHaveBeenCalledTimes(1);
      expect(containerDouble.findDBTProject).toHaveBeenCalledWith(
        selected.root,
      );
    });
  });

  describe("event lookup consistency", () => {
    it("getEventByDocument uses resolveProject mapper, never direct getProjectRootpath", async () => {
      const mockEvent = {
        project: { projectRoot: Uri.file("/workspace/projects/general") },
      };
      service["eventMap"].set("/workspace/projects/general", mockEvent as any);

      const file = Uri.file(
        "/workspace/projects/general/models/general_model.sql",
      );
      const result = service.getEventByDocument(file);

      expect(result).toBe(mockEvent);
      expect(contextDouble.forResource).toHaveBeenCalledWith(file);
      expect(containerDouble.getProjectRootpath).not.toHaveBeenCalled();
    });

    it("getSourcesInProject and getModelsInProject use same mapper", async () => {
      const mockEvent = {
        sourceMetaMap: new Map([["source", { tables: [{ name: "table1" }] }]]),
        nodeMetaMap: { nodes: () => [{ name: "model1" }] },
      };
      service["eventMap"].set("/workspace/projects/general", mockEvent as any);

      const file = Uri.file(
        "/workspace/projects/general/models/general_model.sql",
      );

      expect(service.getSourcesInProject(file)).toEqual([
        { name: "source", tables: ["table1"] },
      ]);
      expect(contextDouble.forResource).toHaveBeenCalledWith(file);

      jest.clearAllMocks();
      expect(Array.from(service.getModelsInProject(file) ?? [])).toEqual([
        "model1",
      ]);
      expect(contextDouble.forResource).toHaveBeenCalledWith(file);
    });
  });
});
