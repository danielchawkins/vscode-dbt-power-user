import { ExtensionContext, Uri } from "vscode";

/** Extension identity and persisted state, read from the activation `ExtensionContext`. */
export class ExtensionContextStore {
  constructor(private readonly context: ExtensionContext) {}

  /** Root URI of the installed extension. */
  get extensionUri(): Uri {
    return this.context.extensionUri;
  }

  /** Version from the extension's `package.json`. */
  get extensionVersion(): string {
    return this.context.extension.packageJSON.version;
  }

  /** Publisher-qualified extension identifier. */
  get extensionId(): string {
    return this.context.extension.id;
  }

  /** Stores `value` under `key` in workspace state. */
  setToWorkspaceState(key: string, value: unknown): void {
    void this.context.workspaceState.update(key, value);
  }

  /** Reads `key` from workspace state. */
  getFromWorkspaceState<T>(key: string): T | undefined {
    return this.context.workspaceState.get<T>(key);
  }

  /** Stores `value` under `key` in global state. */
  setToGlobalState(key: string, value: unknown): void {
    void this.context.globalState.update(key, value);
  }

  /** Reads `key` from global state. */
  getFromGlobalState<T>(key: string): T | undefined {
    return this.context.globalState.get<T>(key);
  }
}
