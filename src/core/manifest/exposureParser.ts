import * as path from "path";

import { ManifestLogger } from "./logger";
import { ManifestProject } from "./manifestProject";
import { ExposureMetaMap, RESOURCE_TYPE_EXPOSURE } from "./types";

export class ExposureParser {
  constructor(private terminal: ManifestLogger) {}

  createExposureMetaMap(
    exposuresMap: Record<string, any>,
    project: ManifestProject,
  ): Promise<ExposureMetaMap> {
    return new Promise((resolve) => {
      const projectRoot = project.getProjectRoot();
      const projectName = project.getProjectName();
      this.terminal.debug(
        "ExposureParser",
        `Parsing exposures for "${projectName}" at ${projectRoot}`,
      );
      const exposureMetaMap: ExposureMetaMap = new Map();
      if (exposuresMap === null || exposuresMap === undefined) {
        resolve(exposureMetaMap);
      }
      Object.values(exposuresMap)
        .filter((exposure) => exposure.resource_type === RESOURCE_TYPE_EXPOSURE)
        .forEach((exposure) => {
          const fullPath = path.join(projectRoot, exposure.original_file_path);
          exposureMetaMap.set(exposure.name, { ...exposure, path: fullPath });
        });
      this.terminal.debug(
        "ExposureParser",
        `Returning exposures for "${projectName}" at ${projectRoot}`,
        exposureMetaMap,
      );
      resolve(exposureMetaMap);
    });
  }
}
