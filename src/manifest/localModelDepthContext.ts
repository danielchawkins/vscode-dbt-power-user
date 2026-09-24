import { ModelDepthParser } from "@altimateai/dbt-integration";

/** Local subset of the integration client used by ModelDepthParser. */
interface LocalModelDepthContext {
  throwIfNotAuthenticated(): void;
}

export const createLocalModelDepthContext = (): ConstructorParameters<
  typeof ModelDepthParser
>[1] =>
  ({
    throwIfNotAuthenticated: () => undefined,
  }) satisfies LocalModelDepthContext as unknown as ConstructorParameters<
    typeof ModelDepthParser
  >[1];
