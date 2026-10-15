import type {
  FusionClient,
  FusionClientOptions,
} from "../../fusion/fusionClient";

/**
 * Builds the Fusion Client the pool runs for one Declared Project.
 * @port
 */
export interface FusionClientFactory {
  create(options: FusionClientOptions): FusionClient;
}
