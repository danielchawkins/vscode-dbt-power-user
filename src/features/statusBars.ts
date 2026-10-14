import type { Disposable } from "vscode";
import type { DeferToProductionStatusBar } from "./defer/deferToProductionStatusBar";

export class StatusBars implements Disposable {
  private disposables: Disposable[] = [];

  constructor(private deferToProductionStatusBar: DeferToProductionStatusBar) {
    this.disposables.push(this.deferToProductionStatusBar);
  }

  initialize() {
    this.deferToProductionStatusBar.updateStatusBar();
  }

  dispose() {
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}
