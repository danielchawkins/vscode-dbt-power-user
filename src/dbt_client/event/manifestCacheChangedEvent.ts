import {
  DocMetaMap,
  ExposureMetaMap,
  FunctionMetaMap,
  GraphMetaMap,
  MacroMetaMap,
  MetricMetaMap,
  NodeMetaMap,
  SemanticModelMetaMap,
  SourceMetaMap,
  TestMetaMap,
  UnitTestMetaMap,
} from "@altimateai/dbt-integration";
import { Uri } from "vscode";

import { DBTProject } from "../dbtProject";

export interface ManifestCacheProjectAddedEvent {
  project: DBTProject;
  nodeMetaMap: NodeMetaMap;
  macroMetaMap: MacroMetaMap;
  metricMetaMap: MetricMetaMap;
  sourceMetaMap: SourceMetaMap;
  graphMetaMap: GraphMetaMap;
  testMetaMap: TestMetaMap;
  unitTestMetaMap: UnitTestMetaMap;
  docMetaMap: DocMetaMap;
  exposureMetaMap: ExposureMetaMap;
  functionMetaMap: FunctionMetaMap;
  semanticModelMetaMap: SemanticModelMetaMap;
  modelDepthMap: Map<string, number>;
  /** Client-owned counter for one published projection of this project. */
  readonly publicationEpoch: number;
  /** Stable identity of the component that produced this projection. */
  readonly metadataProducer: "manifest";
  /** Producer-supplied revision token, when one exists. */
  readonly producerRevision?: string;
}

export interface ManifestCacheProjectRemovedEvent {
  projectRoot: Uri;
}

export interface ManifestCacheChangedEvent {
  added?: ManifestCacheProjectAddedEvent[];
  removed?: ManifestCacheProjectRemovedEvent[];
}

export interface RebuildManifestStatusChange {
  project: DBTProject;
  inProgress: boolean;
}

export interface RebuildManifestCombinedStatusChange {
  projects: DBTProject[];
  inProgress: boolean;
}
