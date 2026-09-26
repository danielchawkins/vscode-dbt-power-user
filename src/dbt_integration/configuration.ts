export interface DBTConfiguration {
  getRunModelCommandAdditionalParams(): string[];
  getBuildModelCommandAdditionalParams(): string[];
  getTestModelCommandAdditionalParams(): string[];
  getQueryTemplate(): string;
  getQueryLimit(): number;
}

export const DEFAULT_CONFIGURATION_VALUES = {
  runModelCommandAdditionalParams: [] as string[],
  buildModelCommandAdditionalParams: [] as string[],
  testModelCommandAdditionalParams: [] as string[],
  queryTemplate: "select * from ({query}) as query limit {limit}",
  queryLimit: 500,
} as const;
