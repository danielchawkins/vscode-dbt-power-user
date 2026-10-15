import type { FusionClient, FusionClientOptions } from "../fusion/fusionClient";
import {
  createFusionLanguageClient,
  type FusionLanguageClientDependencies,
} from "../fusion/fusionLanguageClient";
import type { FusionClientFactory } from "../projects/clients/fusionClientFactory";

/**
 * Builds each Declared Project's Fusion Client over `vscode-languageclient`.
 * @adapter
 */
export class DefaultFusionClientFactory implements FusionClientFactory {
  private readonly deps: FusionLanguageClientDependencies;

  constructor(deps: FusionLanguageClientDependencies = {}) {
    this.deps = deps;
  }

  create(options: FusionClientOptions): FusionClient {
    return createFusionLanguageClient(options, this.deps);
  }
}
