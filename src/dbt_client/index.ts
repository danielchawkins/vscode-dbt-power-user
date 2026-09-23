import { DBTDetection } from "@altimateai/dbt-integration";
import { inject } from "inversify";
import { Disposable, EventEmitter, Memento, window } from "vscode";
import { DBTInstallationVerificationEvent } from "./dbtVersionEvent";

export class DBTClient implements Disposable {
  private _onDBTInstallationVerificationEvent =
    new EventEmitter<DBTInstallationVerificationEvent>();
  public readonly onDBTInstallationVerification =
    this._onDBTInstallationVerificationEvent.event;
  private _dbtInstalled?: boolean;
  public get dbtInstalled() {
    return this._dbtInstalled;
  }
  private disposables: Disposable[] = [
    this._onDBTInstallationVerificationEvent,
  ];
  private shownError = false;
  private globalState?: Memento;
  constructor(
    @inject("Factory<DBTDetection>")
    private dbtDetectionFactory: (
      globalState: Memento | undefined,
    ) => DBTDetection,
  ) {}

  setGlobalState(globalState: Memento) {
    this.globalState = globalState;
  }

  dispose() {
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  async detectDBT(): Promise<void> {
    this._onDBTInstallationVerificationEvent.fire({
      inProgress: true,
    });
    this.shownError = false;
    this._dbtInstalled = await this.dbtDetectionFactory(
      this.globalState,
    ).detectDBT();
    this._onDBTInstallationVerificationEvent.fire({
      inProgress: false,
      installed: this._dbtInstalled,
    });
    if (!this._dbtInstalled) {
      void this.showErrorIfDbtIsNotInstalled();
    }
  }

  async showErrorIfDbtIsNotInstalled() {
    if (!this._dbtInstalled) {
      if (!this.shownError) {
        this.shownError = true;
        await window.showErrorMessage(
          "Please ensure dbt Fusion CLI is installed.",
        );
      }
      return false;
    }
    return true;
  }
}
