import type { ParsedManifest } from "../dbt_integration";
import type { Project } from "./project";

/** One complete manifest publication for a project. */
export interface Manifest extends ParsedManifest {
  project: Project;
  /** Client-owned counter for one published projection of this project. */
  readonly publicationEpoch: number;
  /** Stable identity of the component that produced this projection. */
  readonly metadataProducer: "manifest";
  /** Producer-supplied revision token, when one exists. */
  readonly producerRevision?: string;
}

export interface RebuildManifestStatusChange {
  project: Project;
  inProgress: boolean;
}

export interface RebuildManifestCombinedStatusChange {
  projects: Project[];
  inProgress: boolean;
}
