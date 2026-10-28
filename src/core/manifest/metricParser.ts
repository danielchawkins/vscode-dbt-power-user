import type { Log } from "../log";
import type { ManifestProject } from "./manifestProject";
import type { ManifestResources, MetricMetaMap } from "./types";

export class MetricParser {
  private terminal: Pick<Log, "debug">;

  constructor(terminal: Pick<Log, "debug">) {
    this.terminal = terminal;
  }

  async createMetricMetaMap(
    metrics: ManifestResources<{ name: string }> | null | undefined,
    project: ManifestProject,
  ): Promise<MetricMetaMap> {
    const projectRoot = project.root.fsPath;
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
