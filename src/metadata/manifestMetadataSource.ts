import type { Disposable, Event } from "vscode";
import { EventEmitter } from "vscode";
import type { ParsedManifest } from "../core/dbt/domain";
import type { Project } from "../projects/project/project";
import type { DeclaredProject } from "../projects/registry/projectRegistry";

/** The Parse Producer: forwards each `dbt parse` result of a Project. It publishes nothing to consumers itself. */
export class ManifestMetadataSource implements Disposable {
  private readonly emitter = new EventEmitter<ParsedManifest>();
  readonly onDidParse: Event<ParsedManifest> = this.emitter.event;
  private readonly subscription: Disposable;
  private latest: ParsedManifest | undefined;
  readonly project: DeclaredProject;
  private dbtProject: Project;

  constructor(project: DeclaredProject, dbtProject: Project) {
    this.project = project;
    this.dbtProject = dbtProject;
    this.subscription = dbtProject.onDidParse((parsed) => {
      this.latest = parsed;
      this.emitter.fire(parsed);
    });
  }

  /** The last parse result, or undefined before the first one. */
  current(): ParsedManifest | undefined {
    return this.latest;
  }

  async refresh(): Promise<void> {
    return this.dbtProject.rebuildManifest();
  }

  dispose(): void {
    this.subscription.dispose();
    this.emitter.dispose();
  }
}
