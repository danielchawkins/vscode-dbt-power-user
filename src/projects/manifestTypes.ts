import type { ParsedManifest } from "../dbt_integration/domain";

/** One complete manifest publication for a project. */
export interface Manifest extends ParsedManifest {
  /** Client-owned counter for one published projection of this project. */
  readonly publicationEpoch: number;
  /** Stable identity of the component that produced this projection. */
  readonly metadataProducer: "manifest";
  /** Producer-supplied revision token, when one exists. */
  readonly producerRevision?: string;
}
