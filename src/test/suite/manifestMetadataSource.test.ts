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
import { ManifestMetadataSource } from "../../metadata/manifestMetadataSource";
import { Manifest } from "../../projects/manifestTypes";
import { DeclaredProject } from "../../projects/projectRegistry";

describe("ManifestMetadataSource", () => {
  let source: ManifestMetadataSource;
  let mockDeclaredProject: jest.Mocked<DeclaredProject>;
  let mockDbtProject: jest.Mocked<DBTProject>;
  let manifestChangedEmitter: EventEmitter<DBTProject>;
  let mockManifest: Manifest | undefined;

  const publish = (manifest: Manifest) => {
    mockManifest = manifest;
    manifestChangedEmitter.fire(mockDbtProject);
  };

  const createTestMetadata = (project: DBTProject): Manifest => ({
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

    mockManifest = undefined;
    manifestChangedEmitter = new EventEmitter<DBTProject>();

    mockDbtProject = {
      projectRoot: Uri.file("/test/project"),
      get manifest() {
        return mockManifest;
      },
      onDidChangeManifest: manifestChangedEmitter.event,
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
    mockManifest = testMetadata;
    const source2 = new ManifestMetadataSource(
      mockDeclaredProject,
      mockDbtProject,
    );
    expect(source2.current()).toBe(testMetadata);
    source2.dispose();
  });

  it("should read the latest published manifest", () => {
    const newMetadata = createTestMetadata(mockDbtProject);
    publish(newMetadata);

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

  it("should preserve metadata structure", () => {
    const richMetadata = createTestMetadata(mockDbtProject);
    richMetadata.modelDepthMap.set("model1", 2);
    publish(richMetadata);

    expect(source.current()?.modelDepthMap).toBe(richMetadata.modelDepthMap);
  });
});
