import type { Disposable, Event } from "vscode";
import { EventEmitter } from "vscode";
import type { Log } from "../core/log";
import { FusionCommandError } from "../core/lsp";
import { serverMetadataFrom, type ServerMetadata } from "../core/metadata";
import type { FusionCommands } from "../fusion/fusionCommands";

const LOG_SOURCE = "ServerMetadataSource";

/** What makes the server-owned graph worth fetching again. */
export interface ServerMetadataTriggers {
  /** The server reported a finished compile. */
  compileComplete: Event<void>;
  /** The server has no compile running, after one ran. */
  compileIdle: Event<void>;
  /** A source file of the project changed on disk. */
  sourceChanged: Event<void>;
  /** The project's Fusion client changed state or was replaced. */
  clientChanged: Event<void>;
}

/**
 * The Server Producer: `dbt.listNodes ["+package:<root>"]` plus `dbt.getProjectInfo`. It refreshes single-flight,
 * and fires only when the node set or project info changed.
 *
 * A `dbt.listNodes` costs the server one Parse and then one full background compile, even when nothing changed. It
 * cancels a running compile, which then starts again from the beginning, so a fetch starts only while the server's
 * compile phase is idle.
 *
 * A fetch is due while the graph is `stale` and a fetch is `armed`. A source change, a client change and an explicit
 * `refresh()` arm it; a failed fetch disarms it, so later reports wait for one of those. A due fetch starts on a
 * compile report or a source change when the phase is idle, and otherwise when the phase returns to idle. A fetch
 * clears `stale` and `armed` when it starts, which keeps its own reports from starting another.
 */
export class ServerMetadataSource implements Disposable {
  private readonly emitter = new EventEmitter<ServerMetadata | undefined>();
  readonly onDidChange: Event<ServerMetadata | undefined> = this.emitter.event;
  private value: ServerMetadata | undefined;
  private running: Promise<void> | undefined;
  private again = false;
  private stale = true;
  /** A fetch is wanted: set by a source or client change and by refresh(); a compile report then fetches. */
  private armed = true;
  /** The current client run has reported a compile; before that `listNodes` would wait on it, with a progress toast. */
  private compiled = false;
  private disposed = false;
  private readonly subscriptions: Disposable[];
  private readonly lsp: FusionCommands;
  private readonly projectName: () => string;
  private readonly log: Pick<Log, "debug" | "warn">;

  constructor({
    lsp,
    projectName,
    triggers,
    log,
  }: {
    lsp: FusionCommands;
    projectName: () => string;
    triggers: ServerMetadataTriggers;
    log: Pick<Log, "debug" | "warn">;
  }) {
    this.lsp = lsp;
    this.projectName = projectName;
    this.log = log;
    this.subscriptions = [
      triggers.compileComplete(() => {
        this.compiled = true;
        this.startWhenDue();
      }),
      triggers.compileIdle(() => this.startWhenDue()),
      triggers.sourceChanged(() => {
        this.stale = true;
        this.armed = true;
        this.startWhenDue();
      }),
      triggers.clientChanged(() => {
        if (this.lsp.state === "running") {
          this.stale = true;
          this.armed = true;
          if (this.compiled) {
            void this.start();
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

  /** Starts a due fetch once the server has compiled and is not compiling now. */
  private startWhenDue(): void {
    if (
      this.stale &&
      this.armed &&
      this.compiled &&
      this.lsp.state === "running" &&
      this.lsp.compilePhase === "idle"
    ) {
      void this.start();
    }
  }

  /** Arms and runs one refresh; a call during a refresh schedules exactly one more after it. */
  refresh(): Promise<void> {
    this.armed = true;
    return this.start();
  }

  private start(): Promise<void> {
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
    this.armed = false;
    try {
      const info = await this.lsp.getProjectInfo({ purpose: "projectInfo" });
      const name = info?.projectName ?? this.projectName();
      const nodes = await this.lsp.listNodes([`+package:${name}`], {
        purpose: "graph",
      });
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
