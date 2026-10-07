import { Disposable, EventEmitter } from "vscode";
import type { ParsedManifest } from "../dbt_integration/domain";
import type { FusionClient } from "../fusion/fusionLanguageClient";
import { graphUnavailable } from "./graphAvailability";
import { nextManifestPublication } from "./manifest";
import type { Manifest } from "./manifestTypes";

/**
 * A project's published manifest: the latest complete metadata publication, its change and compile events, and the
 * notice that explains an empty server-owned graph.
 */
export class ManifestState<
  P extends { projectRoot: { fsPath: string } },
> implements Disposable {
  private current?: Manifest;
  private closed = false;
  /** Whether the published manifest was merged with a Server Producer value. */
  private serverValuePublished = false;
  private readonly parsed = new EventEmitter<ParsedManifest>();
  private readonly compiled = new EventEmitter<void>();
  /**
   * Fires with each `dbt parse` result. Producer input only: it is not a manifest publication, so it carries no
   * server graph and no epoch. Consumers read `Projects.onDidChangeManifest`.
   */
  readonly onDidParse = this.parsed.event;
  /** Fires when the project's language server reports a finished compile. */
  readonly onDidCompile = this.compiled.event;

  constructor(
    private readonly project: P,
    private readonly fusionClient: () => FusionClient | undefined,
  ) {}

  /** The latest complete metadata publication. */
  get manifest(): Manifest | undefined {
    return this.current;
  }

  /**
   * Announces a parse result to the producers and fires {@link onDidParse}. `beforeFire` runs first, so a listener
   * that reads the project's parse state sees the parse as current.
   */
  publishParsed(parsed: ParsedManifest, beforeFire?: () => void): boolean {
    if (this.closed) {
      return false;
    }
    beforeFire?.();
    this.parsed.fire(parsed);
    return true;
  }

  /** Replaces the published manifest with the composite producer's merged value, stamped as the next publication. */
  publishMerged(
    merged: ParsedManifest,
    hasServerValue: boolean,
  ): Manifest | undefined {
    if (this.closed) {
      return undefined;
    }
    this.serverValuePublished = hasServerValue;
    this.current = nextManifestPublication(this.project, merged);
    return this.current;
  }

  /** Called for every compile the server finishes. */
  notifyCompileComplete(): void {
    if (!this.closed) {
      this.compiled.fire();
    }
  }

  /** Why the server-owned graph is empty (client state or static-analysis mode), or `undefined`. */
  graphNotice(): string | undefined {
    const client = this.fusionClient();
    return graphUnavailable(
      client?.state ?? "notRunning",
      this.serverValuePublished,
    );
  }

  dispose(): void {
    this.closed = true;
    this.parsed.dispose();
    this.compiled.dispose();
  }
}
