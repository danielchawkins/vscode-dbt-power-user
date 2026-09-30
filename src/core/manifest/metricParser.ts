import { ManifestLogger } from "./logger";
import { ManifestProject } from "./manifestProject";
import { MetricMetaMap } from "./types";

export class MetricParser {
  constructor(private terminal: ManifestLogger) {}

  createMetricMetaMap(
    metrics: any[],
    project: ManifestProject,
  ): Promise<MetricMetaMap> {
    return new Promise(async (resolve) => {
      const projectRoot = project.getProjectRoot();
      const projectName = project.getProjectName();
      this.terminal.debug(
        "MetricParser",
        `Parsing metrics for "${projectName}" at ${projectRoot}`,
      );
      const metricMetaMap: MetricMetaMap = new Map();
      if (metrics === null || metrics === undefined) {
        resolve(metricMetaMap);
      }
      for (const key in metrics) {
        const metric = metrics[key];
        metricMetaMap.set(metric.name, { name: metric.name });
      }
      this.terminal.debug(
        "MetricParser",
        `Returning metrics for "${projectName}" at ${projectRoot}`,
        metricMetaMap,
      );
      resolve(metricMetaMap);
    });
  }
}
