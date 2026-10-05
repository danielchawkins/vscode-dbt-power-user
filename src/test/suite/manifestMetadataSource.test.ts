import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  type Mocked,
  vi,
} from "vitest";
import { EventEmitter, Uri } from "vscode";
import { ManifestMetadataSource } from "../../metadata/manifestMetadataSource";
import { Manifest } from "../../projects/manifestTypes";
import { Project } from "../../projects/project";
import { DeclaredProject } from "../../projects/projectRegistry";

describe("ManifestMetadataSource", () => {
  let source: ManifestMetadataSource;
  let mockDeclaredProject: Mocked<DeclaredProject>;
  let mockProject: Mocked<Project>;
  let manifestChangedEmitter: EventEmitter<Project>;
  let mockManifest: Manifest | undefined;

  const publish = (manifest: Manifest) => {
    mockManifest = manifest;
    manifestChangedEmitter.fire(mockProject);
  };

  const createTestMetadata = (): Manifest => ({
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
      contains: vi.fn(),
      dispose: vi.fn(),
    } as unknown as Mocked<DeclaredProject>;

    mockManifest = undefined;
    manifestChangedEmitter = new EventEmitter<Project>();

    mockProject = {
      projectRoot: Uri.file("/test/project"),
      get manifest() {
        return mockManifest;
      },
      onDidChangeManifest: manifestChangedEmitter.event,
      rebuildManifest: vi.fn().mockImplementation(() => Promise.resolve()),
      dispose: vi.fn(),
    } as unknown as Mocked<Project>;

    source = new ManifestMetadataSource(mockDeclaredProject, mockProject);
  });

  afterEach(() => {
    source.dispose();
    manifestChangedEmitter.dispose();
  });

  it("should initialize with undefined current when no snapshot exists", () => {
    expect(source.current()).toBeUndefined();
  });

  it("should capture current snapshot on initialization", () => {
    const testMetadata = createTestMetadata();
    mockManifest = testMetadata;
    const source2 = new ManifestMetadataSource(
      mockDeclaredProject,
      mockProject,
    );
    expect(source2.current()).toBe(testMetadata);
    source2.dispose();
  });

  it("should read the latest published manifest", () => {
    const newMetadata = createTestMetadata();
    publish(newMetadata);

    expect(source.current()).toBe(newMetadata);
  });

  it("should delegate refresh to project.rebuildManifest", async () => {
    await source.refresh();
    expect(mockProject.rebuildManifest).toHaveBeenCalled();
  });

  it("should propagate errors from refresh", async () => {
    const error = new Error("Rebuild failed");
    (mockProject.rebuildManifest as Mock).mockRejectedValueOnce(error as never);

    await expect(source.refresh()).rejects.toThrow("Rebuild failed");
  });

  it("should preserve metadata structure", () => {
    const richMetadata = createTestMetadata();
    richMetadata.modelDepthMap.set("model1", 2);
    publish(richMetadata);

    expect(source.current()?.modelDepthMap).toBe(richMetadata.modelDepthMap);
  });
});
