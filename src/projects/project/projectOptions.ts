import type { Event, Uri } from "vscode";
import type { Log } from "../../core/log";
import type { FusionCommandIntegrationFactory } from "../../fusion/executableLifecycle";
import type { FusionClient } from "../../fusion/fusionClient";
import type {
  FusionExecutableResolver,
  ResolverEnvironment,
} from "../../fusion/fusionExecutable";
import type { ManifestParsers } from "../manifest/manifest";
import type { MetadataDemand } from "../manifest/metadataDemand";
import type { RunHistoryService } from "../output/runHistoryService";
import type { DeclaredProject } from "../registry/projectRegistry";
import type { ProjectSettingsEvents } from "./projectSettingsStream";
import type { QueryPanelRequests } from "./queryPanelRequests";

/** The collaborators a `Project` is built from. */
export interface ProjectOptions {
  /** The Declared Project's log; the Project does not dispose it. */
  terminal: Log;
  queryRequests: QueryPanelRequests;
  runHistoryService: RunHistoryService;
  resolver: FusionExecutableResolver;
  cliFactory: FusionCommandIntegrationFactory;
  /** The project's resolved environment for executable lookup; the host's when absent. */
  environment?: () => Promise<ResolverEnvironment>;
  /** The project-settings stream; the Project's executable lifecycle subscribes at its executable stage. */
  settings: ProjectSettingsEvents;
  parsers: ManifestParsers;
  /** The Declared Project this one is built for; `Projects` rebuilds the Project when that entry is replaced. */
  declared: DeclaredProject;
  root: Uri;
  /** The number of Declared Projects, which decides whether task names carry the project name. */
  projectCount?: () => number;
  /** The project's current Fusion Client; resolved per call so a restart leaves no stale reference. */
  fusionClient?: () => FusionClient | undefined;
  /** Fires when that client is replaced or changes state. */
  clientChanged?: Event<void>;
  /** Views reading parse-owned fields; without it every source change rebuilds. */
  metadataDemand?: MetadataDemand;
}
