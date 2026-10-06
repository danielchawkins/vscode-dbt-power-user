import * as path from "path";
import { Disposable, Event, EventEmitter } from "vscode";
import { mergeMetadata } from "../core/metadata";
import type { ParsedManifest } from "../dbt_integration/domain";
import type { Manifest } from "../projects/manifestTypes";
import type { Project } from "../projects/project";
import type { DeclaredProject } from "../projects/projectRegistry";
import { ManifestMetadataSource } from "./manifestMetadataSource";
import type { ProjectMetadataSource } from "./projectMetadataSource";
import type { ServerMetadataSource } from "./serverMetadataSource";

/**
 * The Project Metadata Source consumers see: the Server Producer's fields over the Parse Producer's, published as
 * one merged manifest per producer update. Nothing is published before the first parse, because consumers read a
 * manifest as "the project has been parsed".
 */
export class CompositeMetadataSource implements ProjectMetadataSource {
  private readonly emitter = new EventEmitter<Manifest>();
  readonly onDidPublish: Event<Manifest> = this.emitter.event;
  private readonly parseProducer: ManifestMetadataSource;
  private readonly subscriptions: Disposable[];
  private parsed: ParsedManifest | undefined;

  constructor(
    readonly project: DeclaredProject,
    private readonly dbtProject: Project,
    private readonly server: ServerMetadataSource,
  ) {
    this.parseProducer = new ManifestMetadataSource(project, dbtProject);
    this.subscriptions = [
      this.parseProducer.onDidParse((parsed) => {
        this.parsed = parsed;
        this.publish();
      }),
      server.onDidChange(() => this.publish()),
    ];
  }

  current(): Manifest | undefined {
    return this.dbtProject.manifest;
  }

  async refresh(): Promise<void> {
    await Promise.all([this.parseProducer.refresh(), this.server.refresh()]);
  }

  private publish(): void {
    if (!this.parsed) {
      return;
    }
    const root = this.dbtProject.projectRoot.fsPath;
    const projectName = this.dbtProject.getProjectName();
    const merged = mergeMetadata(this.server.current(), this.parsed, {
      pathOf: (node) =>
        node.packageName === projectName
          ? path.join(root, node.originalFilePath)
          : undefined,
    });
    const manifest = this.dbtProject.publishMerged(merged);
    if (manifest) {
      this.emitter.fire(manifest);
    }
  }

  dispose(): void {
    this.subscriptions.forEach((s) => s.dispose());
    this.parseProducer.dispose();
    this.server.dispose();
    this.emitter.dispose();
  }
}
