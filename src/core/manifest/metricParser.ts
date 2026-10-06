import type { Log } from "../log";
import { ManifestProject } from "./manifestProject";
import { MetricMetaMap } from "./types";

export class MetricParser {
  constructor(private terminal: Pick<Log, "debug">) {}

  async createMetricMetaMap(
    metrics: Record<string, any> | null | undefined,
    project: ManifestProject,
  ): Promise<MetricMetaMap> {
    const projectRoot = project.getProjectRoot();
    const projectName = project.getProjectName();
    this.terminal.debug(
      "MetricParser",
      `Parsing metrics for "${projectName}" at ${projectRoot}`,
    );
    const metricMetaMap: MetricMetaMap = new Map();
    if (metrics === null || metrics === undefined) {
      return metricMetaMap;
    }
    for (const metric of Object.values(metrics)) {
      metricMetaMap.set(metric.name, { name: metric.name });
    }
    this.terminal.debug(
      "MetricParser",
      `Returning metrics for "${projectName}" at ${projectRoot}`,
      metricMetaMap,
    );
    return metricMetaMap;
  }
}
