export interface DBTConfiguration {
  getRunModelCommandAdditionalParams(): string[];
  getBuildModelCommandAdditionalParams(): string[];
  getTestModelCommandAdditionalParams(): string[];
  getQueryTemplate(): string;
  getQueryLimit(): number;
}
