import { DBTDetection } from "@altimateai/dbt-integration";
import { existsSync } from "fs";
import { inject } from "inversify";
import { commands, Disposable, EventEmitter, Memento, window } from "vscode";
import { DBTInstallationVerificationEvent } from "./dbtVersionEvent";
import { PythonEnvironment } from "./pythonEnvironment";

enum PythonInterpreterPromptAnswer {
  SELECT = "Select Python interpreter",
  DETECT = "Detect from terminal",
}

export class DBTClient implements Disposable {
  private _onDBTInstallationVerificationEvent =
    new EventEmitter<DBTInstallationVerificationEvent>();
  public readonly onDBTInstallationVerification =
    this._onDBTInstallationVerificationEvent.event;
  private _dbtInstalled?: boolean;
  private _pythonInstalled?: boolean;
  public get dbtInstalled() {
    return this._dbtInstalled;
  }
  public get pythonInstalled() {
    return this._pythonInstalled;
  }
  private disposables: Disposable[] = [
    this._onDBTInstallationVerificationEvent,
  ];
  private shownError = false;
  private globalState?: Memento;
  constructor(
    @inject(PythonEnvironment)
    private pythonEnvironment: PythonEnvironment,
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
    await this.pythonEnvironment.initialize();
    this.disposables.push(
      this.pythonEnvironment.onPythonEnvironmentChanged(() => {
        this.checkAllInstalled();
      }),
    );
    await this.checkAllInstalled();
  }

  private async checkAllInstalled(): Promise<void> {
    this._onDBTInstallationVerificationEvent.fire({
      inProgress: true,
    });
    this.shownError = false;
    this._dbtInstalled = undefined;
    this._pythonInstalled = this.pythonPathExists();
    this._dbtInstalled = await this.dbtDetectionFactory(
      this.globalState,
    ).detectDBT();
    // Refresh cached Python version — by this point the Python extension
    // has settled after an interpreter change
    await this.pythonEnvironment.refreshPythonVersion();
    this._onDBTInstallationVerificationEvent.fire({
      inProgress: false,
      installed: this._dbtInstalled,
    });
    commands.executeCommand(
      "setContext",
      "dbtPowerUser.dbtInstalled",
      this._dbtInstalled,
    );
    if (!this._dbtInstalled) {
      this.showErrorIfDbtOrPythonNotInstalled();
    }
  }

  async showErrorIfDbtOrPythonNotInstalled() {
    if (!this._pythonInstalled) {
      if (!this.shownError) {
        // We don't want to flood the user with errors
        this.shownError = true;
        const answer = await window.showErrorMessage(
          "No Python interpreter is selected or Python is not installed",
          PythonInterpreterPromptAnswer.SELECT,
          PythonInterpreterPromptAnswer.DETECT,
        );
        if (answer === PythonInterpreterPromptAnswer.SELECT) {
          commands.executeCommand("python.setInterpreter");
        } else if (answer === PythonInterpreterPromptAnswer.DETECT) {
          commands.executeCommand("dbtPowerUser.detectPythonFromTerminal");
        }
      }
      return false;
    }
    if (!this.pythonEnvironment.isPython3) {
      const answer = await window.showErrorMessage(
        "Only Python 3 is supported by dbt, please select a Python 3 interpreter",
        PythonInterpreterPromptAnswer.SELECT,
        PythonInterpreterPromptAnswer.DETECT,
      );
      if (answer === PythonInterpreterPromptAnswer.SELECT) {
        commands.executeCommand("python.setInterpreter");
      } else if (answer === PythonInterpreterPromptAnswer.DETECT) {
        commands.executeCommand("dbtPowerUser.detectPythonFromTerminal");
      }
      return false;
    }
    return this.showErrorIfDbtIsNotInstalled();
  }

  async showErrorIfDbtIsNotInstalled() {
    if (!this._dbtInstalled) {
      if (!this.shownError) {
        // We don't want to flood the user with errors
        this.shownError = true;
        const answer = await window.showErrorMessage(
          "Please ensure dbt Fusion CLI is installed.",
          "Troubleshoot",
        );
        if (answer === "Troubleshoot") {
          commands.executeCommand("dbtPowerUser.openSetupWalkthrough");
        }
      }
      return false;
    }
    return true;
  }

  getPythonEnvironment() {
    return this.pythonEnvironment;
  }

  private pythonPathExists() {
    return (
      this.pythonEnvironment.pythonPath !== undefined &&
      existsSync(this.pythonEnvironment.pythonPath)
    );
  }
}
