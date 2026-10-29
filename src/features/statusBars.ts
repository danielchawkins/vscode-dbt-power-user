import type { Disposable } from "vscode";
import { disposeAll } from "../core/disposables";
import type { DeferToProductionStatusBar } from "./defer/deferToProductionStatusBar";

export class StatusBars implements Disposable {
  private disposables: Disposable[] = [];
  private deferToProductionStatusBar: DeferToProductionStatusBar;

  constructor(deferToProductionStatusBar: DeferToProductionStatusBar) {
    this.deferToProductionStatusBar = deferToProductionStatusBar;
    this.disposables.push(this.deferToProductionStatusBar);
  }

  initialize() {
    this.deferToProductionStatusBar.updateStatusBar();
  }

  dispose() {
    disposeAll(this.disposables);
  }
}
