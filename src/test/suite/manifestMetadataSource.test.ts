import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { EventEmitter, Uri } from "vscode";
import { DBTProject } from "../../dbt_client/dbtProject";
import {
  ManifestCacheChangedEvent,
  ManifestCacheProjectAddedEvent,
} from "../../dbt_client/event/manifestCacheChangedEvent";
import { ManifestMetadataSource } from "../../metadata/manifestMetadataSource";
import { DeclaredProject } from "../../projects/projectRegistry";

describe("ManifestMetadataSource", () => {
  let source: ManifestMetadataSource;
  let mockDeclaredProject: jest.Mocked<DeclaredProject>;
  let mockDbtProject: jest.Mocked<DBTProject>;
  let manifestChangedEmitter: EventEmitter<ManifestCacheChangedEvent>;

  const createTestMetadata = (
    project: DBTProject,
  ): ManifestCacheProjectAddedEvent => ({
    project,
    nodeMetaMap: {
      lookupByBaseName: new Map(),
      lookupByUniqueId: new Map(),
      nodes: new Map(),
    } as any,
    macroMetaMap: new Map(),
    metricMetaMap: new Map(),
    sourceMetaMap: new Map(),
    graphMetaMap: {
      parents: new Map(),
      children: new Map(),
      tests: new Map(),
      metrics: new Map(),
    } as any,
    testMetaMap: new Map(),
    unitTestMetaMap: new Map(),
    docMetaMap: new Map(),
    exposureMetaMap: new Map(),
    functionMetaMap: new Map(),
    semanticModelMetaMap: new Map(),
    modelDepthMap: new Map(),
    publicationEpoch: 1,
    metadataProducer: "manifest",
  });

  beforeEach(() => {
    mockDeclaredProject = {
      root: Uri.file("/test/project"),
      name: "test-project",
      folder: {
        uri: Uri.file("/test"),
        name: "test",
        index: 0,
      },
      contains: jest.fn(),
      dispose: jest.fn(),
    } as unknown as jest.Mocked<DeclaredProject>;

    manifestChangedEmitter = new EventEmitter<ManifestCacheChangedEvent>();

    mockDbtProject = {
      projectRoot: Uri.file("/test/project"),
      getMetadataSnapshot: jest.fn().mockReturnValue(undefined),
      onManifestChanged: manifestChangedEmitter.event,
      rebuildManifest: jest.fn().mockImplementation(() => Promise.resolve()),
      dispose: jest.fn(),
    } as unknown as jest.Mocked<DBTProject>;

    source = new ManifestMetadataSource(mockDeclaredProject, mockDbtProject);
  });

  afterEach(() => {
    source.dispose();
    manifestChangedEmitter.dispose();
  });

  it("should initialize with undefined current when no snapshot exists", () => {
    expect(source.current()).toBeUndefined();
  });

  it("should capture current snapshot on initialization", () => {
    const testMetadata = createTestMetadata(mockDbtProject);
    (mockDbtProject.getMetadataSnapshot as jest.Mock).mockReturnValue(
      testMetadata,
    );
    const source2 = new ManifestMetadataSource(
      mockDeclaredProject,
      mockDbtProject,
    );
    expect(source2.current()).toBe(testMetadata);
    source2.dispose();
  });

  it("should forward manifest events unchanged", () => {
    const eventSpy = jest.fn();
    source.onDidChangeMetadata(eventSpy);

    const newMetadata = createTestMetadata(mockDbtProject);
    mockDbtProject.getMetadataSnapshot.mockReturnValue(newMetadata);

    manifestChangedEmitter.fire({ added: [newMetadata] });

    expect(eventSpy).toHaveBeenCalledWith(newMetadata);
    expect(source.current()).toBe(newMetadata);
  });

  it("should delegate refresh to dbtProject.rebuildManifest", async () => {
    await source.refresh();
    expect(mockDbtProject.rebuildManifest).toHaveBeenCalled();
  });

  it("should propagate errors from refresh", async () => {
    const error = new Error("Rebuild failed");
    (mockDbtProject.rebuildManifest as jest.Mock).mockRejectedValueOnce(
      error as never,
    );

    await expect(source.refresh()).rejects.toThrow("Rebuild failed");
  });

  it("should unsubscribe from events on dispose", () => {
    const eventSpy = jest.fn();
    source.onDidChangeMetadata(eventSpy);

    source.dispose();

    const newMetadata = createTestMetadata(mockDbtProject);

    manifestChangedEmitter.fire({ added: [newMetadata] });

    expect(eventSpy).not.toHaveBeenCalled();
  });

  it("should preserve metadata event structure", () => {
    const eventSpy = jest.fn();
    source.onDidChangeMetadata(eventSpy);

    const richMetadata = createTestMetadata(mockDbtProject);
    richMetadata.modelDepthMap.set("model1", 2);
    mockDbtProject.getMetadataSnapshot.mockReturnValue(richMetadata);

    manifestChangedEmitter.fire({ added: [richMetadata] });

    expect(eventSpy).toHaveBeenCalledWith(richMetadata);
    expect(source.current()?.modelDepthMap).toBe(richMetadata.modelDepthMap);
  });
});
