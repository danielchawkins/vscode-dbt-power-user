import type { Disposable, Event } from "vscode";
import { EventEmitter } from "vscode";

/**
 * Which consumers currently read merged metadata (the Project Metadata Source). While one is showing, the Parse
 * Producer rebuilds on a source change and the Server Producer fetches the graph; otherwise both mark stale and wait
 * for a consumer to appear.
 */
export class MetadataDemand implements Disposable {
  private readonly holders = new Set<symbol>();
  private readonly emitter = new EventEmitter<void>();
  /** Fires when the first consumer appears. */
  readonly onDidBecomeActive: Event<void> = this.emitter.event;

  get active(): boolean {
    return this.holders.size > 0;
  }

  /** Registers a visible consumer; dispose the result when it hides. */
  acquire(): Disposable {
    const holder = Symbol("metadataDemand");
    const wasActive = this.active;
    this.holders.add(holder);
    if (!wasActive) {
      this.emitter.fire();
    }
    return { dispose: () => void this.holders.delete(holder) };
  }

  /** Keeps a demand while `isVisible` holds, following `onDidChange`. */
  follow(isVisible: () => boolean, onDidChange: Event<unknown>): Disposable {
    let held: Disposable | undefined;
    const sync = () => {
      if (isVisible() && !held) {
        held = this.acquire();
      } else if (!isVisible() && held) {
        held.dispose();
        held = undefined;
      }
    };
    sync();
    const subscription = onDidChange(sync);
    return {
      dispose: () => {
        subscription.dispose();
        held?.dispose();
      },
    };
  }

  dispose(): void {
    this.holders.clear();
    this.emitter.dispose();
  }
}
