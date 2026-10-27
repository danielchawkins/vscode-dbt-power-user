import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ChangeBurst } from "./manifestTrigger";

/** Reads a file's bytes; rejects when the file cannot be read. */
export type ReadFile = (fsPath: string) => Promise<Uint8Array>;

/**
 * Content hashes of the source files events reported, as the last published source-driven parse started with them.
 * A burst may skip the Parse Producer only when every path still hashes the same, and no parse was in flight when
 * the burst began. Anything the store did not see forgets its records.
 */
export class ParseFingerprints {
  /** Paths events reported since a parse last started; hashed when the next source-driven parse starts. */
  private reported = new Set<string>();
  /** Hashes as of the last committed parse start. A path without one always parses. */
  private recorded = new Map<string, string>();
  /** Hashes taken when the source-driven parse in progress started; undefined while none is in progress. */
  private starting: Map<string, string | undefined> | undefined;
  /** When the last parse ended, in epoch milliseconds. A burst that began earlier may have raced that parse. */
  private lastParseEndedAt = Number.NEGATIVE_INFINITY;
  private readonly read: ReadFile;

  constructor(read: ReadFile = readFile) {
    this.read = read;
  }

  /** Notes the paths a source-file burst reported, to be hashed when the next source-driven parse starts. */
  report(paths: readonly string[]): void {
    for (const fsPath of paths) {
      this.reported.add(fsPath);
    }
  }

  /** Starts a parse. A source-driven one hashes the reported paths; any other forgets every record. */
  async begin(sourceDriven: boolean): Promise<void> {
    if (!sourceDriven) {
      this.forget();
      return;
    }
    const paths = [...this.reported];
    this.reported.clear();
    const hashes = await Promise.all(
      paths.map((fsPath) => this.hashOf(fsPath)),
    );
    this.starting = new Map(paths.map((fsPath, i) => [fsPath, hashes[i]]));
  }

  /** Publishes the parse in progress: its starting hashes become the records. Outside one, forgets every record. */
  commit(): void {
    const starting = this.starting;
    if (!starting) {
      this.forget();
      return;
    }
    this.starting = undefined;
    for (const [fsPath, hash] of starting) {
      if (hash === undefined) {
        this.recorded.delete(fsPath);
      } else {
        this.recorded.set(fsPath, hash);
      }
    }
  }

  /** Ends a parse. One that did not publish leaves no records behind. */
  finish(): void {
    if (this.starting) {
      this.forget();
    }
    this.lastParseEndedAt = Date.now();
  }

  /** Whether a burst's files are all recorded and hash the same now, and the burst began after the last parse. */
  async unchanged(change: ChangeBurst): Promise<boolean> {
    if (
      change.paths.length === 0 ||
      change.firstEventAt <= this.lastParseEndedAt
    ) {
      return false;
    }
    for (const fsPath of change.paths) {
      const recorded = this.recorded.get(fsPath);
      if (recorded === undefined || recorded !== (await this.hashOf(fsPath))) {
        return false;
      }
    }
    return true;
  }

  forget(): void {
    this.reported.clear();
    this.recorded.clear();
    this.starting = undefined;
  }

  /** The SHA-256 of a file's bytes, or undefined when the file cannot be read. */
  private async hashOf(fsPath: string): Promise<string | undefined> {
    try {
      return createHash("sha256")
        .update(await this.read(fsPath))
        .digest("hex");
    } catch {
      return undefined;
    }
  }
}
