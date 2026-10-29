import type { Disposable } from "vscode";
import { disposeAll } from "../../core/disposables";
import type { Log } from "../../core/log";
import type { SettingKey, SettingsChange } from "../../settings/index";
import { onDidChangeSettings } from "../../settings/index";
import { PROJECT_SNAPSHOT_SETTINGS } from "../clients/readProjectSnapshot";
import type {
  DeclaredProject,
  ProjectRegistry,
} from "../registry/projectRegistry";

const LOG_SOURCE = "ProjectSettings";

/** Every project-scoped key the stream reads; each stage listener filters for the keys it reacts to. */
const PROJECT_STREAM_SETTINGS: readonly SettingKey[] = [
  ...PROJECT_SNAPSHOT_SETTINGS,
  "toolEnvironment",
];

/**
 * The stages a project-settings change passes through, in order. Every listener of a stage is awaited before the
 * next stage starts, so a client restart never overlaps a manifest rebuild for the same project.
 */
const SNAPSHOT_STAGES = [
  "environment",
  "executable",
  "clients",
  "manifest",
  "features",
] as const;

export type SnapshotStage = (typeof SNAPSHOT_STAGES)[number];

/** One Declared Project whose project-scoped settings changed, with the keys that changed for it. */
interface SnapshotChange {
  readonly project: DeclaredProject;
  readonly changedFields: readonly SettingKey[];
}

export type SnapshotListener = (change: SnapshotChange) => void | Promise<void>;

/** Subscribes to project-scoped setting changes at one stage of their notification. */
export interface ProjectSettingsEvents {
  onDidChangeSnapshot(
    stage: SnapshotStage,
    listener: SnapshotListener,
  ): Disposable;
}

/**
 * The one subscriber of project-scoped settings. For each Declared Project a change affects, it notifies the stage
 * listeners in `SNAPSHOT_STAGES` order and awaits each one. Changes are handled one at a time, in arrival order.
 */
export class ProjectSettingsStream
  implements ProjectSettingsEvents, Disposable
{
  private readonly stages: Record<SnapshotStage, SnapshotListener[]> = {
    environment: [],
    executable: [],
    clients: [],
    manifest: [],
    features: [],
  };
  private readonly subscription: Disposable;
  private chain: Promise<void> = Promise.resolve();
  private disposed = false;
  private readonly registry: Pick<ProjectRegistry, "projects">;
  private readonly log: Log;

  constructor(registry: Pick<ProjectRegistry, "projects">, log: Log) {
    this.registry = registry;
    this.log = log;
    this.subscription = onDidChangeSettings(
      PROJECT_STREAM_SETTINGS,
      (change) => {
        this.chain = this.chain
          .then(() => this.dispatch(change))
          .catch((error: unknown) => {
            // A rejected chain would drop every later change.
            this.log.error(LOG_SOURCE, "settings change failed", error);
          });
      },
    );
  }

  onDidChangeSnapshot(
    stage: SnapshotStage,
    listener: SnapshotListener,
  ): Disposable {
    const listeners = this.stages[stage];
    listeners.push(listener);
    return {
      dispose: () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) {
          listeners.splice(index, 1);
        }
      },
    };
  }

  dispose(): void {
    this.disposed = true;
    disposeAll([this.subscription]);
    for (const stage of SNAPSHOT_STAGES) {
      this.stages[stage].length = 0;
    }
  }

  private async dispatch(settings: SettingsChange): Promise<void> {
    // Snapshot: a listener may register or dispose while the loops run.
    for (const project of this.registry.projects.slice()) {
      const changedFields = settings
        .changed(project.root)
        .filter((key) => PROJECT_STREAM_SETTINGS.includes(key));
      if (changedFields.length > 0) {
        await this.notifyProject(project, changedFields);
      }
    }
  }

  /** Awaits each stage's listeners for one project, in stage order. */
  private async notifyProject(
    project: DeclaredProject,
    changedFields: readonly SettingKey[],
  ): Promise<void> {
    for (const stage of SNAPSHOT_STAGES) {
      for (const listener of this.stages[stage].slice()) {
        if (this.disposed) {
          return;
        }
        try {
          await listener({ project, changedFields });
        } catch (error) {
          this.log.error(LOG_SOURCE, `${stage} stage failed`, error);
        }
      }
    }
  }
}
