import * as path from "node:path";
import type { Disposable, Event } from "vscode";
import { EventEmitter } from "vscode";
import type { ParsedManifest } from "../core/dbt/domain";
import type { Log } from "../core/log";
import { mergeMetadata } from "../core/metadata";
import { followClientIdle } from "../projects/clients/clientChange";
import type { Manifest } from "../projects/manifest/manifestTypes";
import type { Project } from "../projects/project/project";
import type { ProjectMetadataSource } from "../projects/project/projectMetadataSource";
import type { DeclaredProject } from "../projects/registry/projectRegistry";
import { ManifestMetadataSource } from "./manifestMetadataSource";
import { ServerMetadataSource } from "./serverMetadataSource";

/**
 * The Project Metadata Source consumers see: the Server Producer's fields over the Parse Producer's, published as
 * one merged manifest per producer update. Nothing is published before the first parse, because consumers read a
 * manifest as "the project has been parsed".
 * @adapter
 * @internal
 */
export class CompositeMetadataSource implements ProjectMetadataSource {
  private readonly emitter = new EventEmitter<Manifest>();
  readonly onDidPublish: Event<Manifest> = this.emitter.event;
  private readonly parseProducer: ManifestMetadataSource;
  private readonly subscriptions: Disposable[];
  private parsed: ParsedManifest | undefined;
  readonly project: DeclaredProject;
  private readonly dbtProject: Project;
  private readonly server: ServerMetadataSource;

  constructor(
    project: DeclaredProject,
    dbtProject: Project,
    server: ServerMetadataSource,
  ) {
    this.project = project;
    this.dbtProject = dbtProject;
    this.server = server;
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
    const server = this.server.current();
    const merged = mergeMetadata(server, this.parsed, {
      pathOf: (node) =>
        node.packageName === projectName
          ? path.join(root, node.originalFilePath)
          : undefined,
    });
    const manifest = this.dbtProject.publishMerged(
      merged,
      server !== undefined,
    );
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

/**
 * The Project Metadata Source for one Declared Project: the Server Producer over `project`'s language server,
 * merged with its Parse Producer.
 * @adapter
 */
export function createProjectMetadataSource(
  declared: DeclaredProject,
  project: Project,
  log: Pick<Log, "debug" | "warn">,
): ProjectMetadataSource {
  return new CompositeMetadataSource(
    declared,
    project,
    new ServerMetadataSource({
      lsp: project.lsp,
      projectName: () => project.getProjectName(),
      triggers: {
        compileComplete: project.onDidCompile,
        compileIdle: (listener) =>
          followClientIdle(
            project.fusionClient,
            project.onDidChangeClient,
            listener,
          ),
        sourceChanged: project.onSourceFileChanged,
        clientChanged: project.onDidChangeClient,
      },
      log,
    }),
  );
}
