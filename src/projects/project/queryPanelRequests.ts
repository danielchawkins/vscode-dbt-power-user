import type { Disposable, Event } from "vscode";
import { EventEmitter } from "vscode";
import type { QueryPanelPayload } from "./projectSql";

/** Asks the query panel to run a deferred query; the panel subscribes through `onDidRequest`. */
export class QueryPanelRequests implements Disposable {
  private readonly emitter = new EventEmitter<QueryPanelPayload>();
  public readonly onDidRequest: Event<QueryPanelPayload> = this.emitter.event;

  public request(payload: QueryPanelPayload) {
    this.emitter.fire(payload);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
