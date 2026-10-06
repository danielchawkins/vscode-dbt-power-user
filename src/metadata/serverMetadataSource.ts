import { Disposable, Event, EventEmitter } from "vscode";
import type { Log } from "../core/log";
import { FusionCommandError } from "../core/lsp";
import { serverMetadataFrom, type ServerMetadata } from "../core/metadata";
import type { FusionCommands } from "../fusion/fusionCommands";

const LOG_SOURCE = "ServerMetadataSource";

/** What makes the server-owned graph worth fetching again. */
export interface ServerMetadataTriggers {
  /** The server reported a finished compile. */
  compileComplete: Event<void>;
  /** A source file of the project changed on disk. */
  sourceChanged: Event<void>;
  /** The project's Fusion client changed state or was replaced. */
  clientChanged: Event<void>;
}

/**
 * The Server Producer: `dbt.listNodes ["+package:<root>"]` plus `dbt.getProjectInfo`. It refreshes single-flight,
 * and fires only when the node set or project info changed.
 *
 * Every `dbt.listNodes` makes the server send one compile report of its own, so a report is a reason to refresh
 * only while the graph is `stale`: a source changed, the client (re)started, or the last fetch failed. A fetch clears
 * `stale` when it starts, which is what keeps its own reports from starting another.
 */
export class ServerMetadataSource implements Disposable {
  private readonly emitter = new EventEmitter<ServerMetadata | undefined>();
  readonly onDidChange: Event<ServerMetadata | undefined> = this.emitter.event;
  private value: ServerMetadata | undefined;
  private running: Promise<void> | undefined;
  private again = false;
  private stale = true;
  /** The current client run has reported a compile; before that `listNodes` would wait on it, with a progress toast. */
  private compiled = false;
  private disposed = false;
  private readonly subscriptions: Disposable[];

  constructor(
    private readonly lsp: FusionCommands,
    private readonly projectName: () => string,
    triggers: ServerMetadataTriggers,
    private readonly log: Pick<Log, "debug" | "warn">,
  ) {
    this.subscriptions = [
      triggers.compileComplete(() => {
        this.compiled = true;
        if (this.stale && this.lsp.state === "running") {
          void this.refresh();
        }
      }),
      triggers.sourceChanged(() => {
        this.stale = true;
        if (this.compiled) {
          void this.refresh();
        }
      }),
      triggers.clientChanged(() => {
        if (this.lsp.state === "running") {
          this.stale = true;
          if (this.compiled) {
            void this.refresh();
          }
        } else {
          this.compiled = false;
          this.set(undefined);
        }
      }),
    ];
  }

  current(): ServerMetadata | undefined {
    return this.value;
  }

  /** Runs one refresh; a call during a refresh schedules exactly one more after it. */
  refresh(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.loop().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async loop(): Promise<void> {
    do {
      this.again = false;
      await this.fetch();
    } while (this.again && !this.disposed);
  }

  private async fetch(): Promise<void> {
    this.stale = false;
    try {
      const info = await this.lsp.getProjectInfo();
      const name = info?.projectName ?? this.projectName();
      const nodes = await this.lsp.listNodes([`+package:${name}`]);
      this.set(serverMetadataFrom(nodes, info, name));
    } catch (error) {
      if (error instanceof FusionCommandError && error.kind === "notRunning") {
        this.set(undefined);
        return;
      }
      this.stale = true;
      this.log.warn(LOG_SOURCE, "Server metadata refresh failed", error);
    }
  }

  private set(next: ServerMetadata | undefined): void {
    if (this.disposed || next?.signature === this.value?.signature) {
      return;
    }
    this.value = next;
    this.emitter.fire(next);
  }

  dispose(): void {
    this.disposed = true;
    this.subscriptions.forEach((subscription) => subscription.dispose());
    this.emitter.dispose();
  }
}
