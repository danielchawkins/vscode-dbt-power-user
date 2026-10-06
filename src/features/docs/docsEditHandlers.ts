import type {
  documentationEditor,
  ShowNotification,
} from "@fusion-power-user/webview-contract";
import { existsSync, readFileSync } from "fs";
import { ProgressLocation, Uri, window } from "vscode";
import { parse, stringify } from "yaml";
import type { Log } from "../../core/log";
import type { TestMetaData } from "../../core/manifest/types";
import { UserInputError } from "../../local/errors";
import { notifyError } from "../../projects/notifications";
import { activeModelUri } from "../../projects/previewUri";
import type { Project } from "../../projects/project";
import type { QueryManifestService } from "../../projects/queryManifestService";
import type { Handlers } from "../../webview/messageRouter";
import type { DbtTestService } from "./dbtTestService";

type HostMessage = documentationEditor.HostMessage;
type PanelMessage = documentationEditor.PanelMessage;

/** The panel commands that read the active project and answer with a `response`. */
export type RequestCommand =
  | "getTestCode"
  | "getUnitTestCode"
  | "getDistinctColumnValues"
  | "getColumnsOfSources"
  | "getColumnsOfModel"
  | "getSourcesInProject"
  | "getModelsInProject"
  | "showWarningMessage"
  | "showInformationMessage";

/** What the handlers need from the documentation editor host. */
export interface DocsEditHost {
  readonly terminal: Log;
  readonly queryManifestService: QueryManifestService;
  readonly dbtTestService: DbtTestService;
  getProject(): Project | undefined;
  post(message: HostMessage): Thenable<boolean> | undefined;
}

interface Reply {
  syncRequestId?: string;
  data?: unknown;
  error?: string;
}

/** A unit test's YAML from `filePath`: the test named `testName`, or the whole file. */
function getUnitTestCode(filePath?: string, testName?: string) {
  if (!filePath || !existsSync(filePath)) {
    return { error: "Unit test file not found" };
  }
  const raw = readFileSync(filePath, { encoding: "utf-8" });
  if (!testName) {
    return { yaml: raw };
  }
  try {
    const parsed = parse(raw) as {
      unit_tests?: { name: string }[];
    } | null;
    const test = parsed?.unit_tests?.find((item) => item.name === testName);
    return { yaml: test ? stringify(test) : raw };
  } catch {
    return { yaml: raw };
  }
}

/** The documentation editor's request handlers: each answers one panel request with a `response`. */
export class DocsEditRequests {
  constructor(private readonly host: DocsEditHost) {}

  /** Answers a panel request. */
  sendResponse({ data, error, syncRequestId }: Reply): void {
    void this.host.post({
      command: "response",
      args: { syncRequestId, body: data, status: !error, error },
    });
  }

  /** Runs `callback` and answers `syncRequestId` with its result or its error. */
  async handleSyncRequest(
    syncRequestId: string | undefined,
    callback: () => unknown,
    command: string,
    showErrorNotification?: boolean,
  ): Promise<void> {
    try {
      this.sendResponse({ syncRequestId, data: await callback() });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof UserInputError) {
        this.host.terminal.debug(command, message, error);
      } else {
        this.host.terminal.error(command, message, error);
      }
      if (showErrorNotification) {
        void notifyError(this.host.getProject(), message);
      }
      this.sendResponse({ syncRequestId, error: message });
    }
  }

  /** Runs `handler` with the active editor's project, or answers the request with why there is none. */
  withProject<M extends { syncRequestId?: string }>(
    handler: (message: M, project: Project, modelPath: Uri) => unknown,
  ): (message: M) => unknown {
    return (message) => {
      if (!window.activeTextEditor) {
        return this.sendResponse({
          syncRequestId: message.syncRequestId,
          error: "No active editor",
        });
      }
      const modelPath = activeModelUri(window.activeTextEditor.document.uri);
      const project = this.host.getProject();
      if (!project) {
        return this.sendResponse({
          syncRequestId: message.syncRequestId,
          error: "No dbt project found for the active editor",
        });
      }
      return handler(message, project, modelPath);
    };
  }

  private showNotification({
    command,
    infoMessage,
    items,
    syncRequestId,
  }: ShowNotification) {
    const show =
      command === "showWarningMessage"
        ? window.showWarningMessage
        : window.showInformationMessage;
    return this.handleSyncRequest(
      syncRequestId,
      () => show(infoMessage, ...(items ?? [])),
      command,
    );
  }

  private getDbtTestCode(test: TestMetaData, modelName: string) {
    return {
      sql: test.path?.endsWith(".sql")
        ? readFileSync(test.path, { encoding: "utf-8" })
        : undefined,
      config: this.host.dbtTestService.getConfigByTest(
        test,
        modelName,
        test.column_name,
      ),
    };
  }

  /** Answers with `read` of the active editor's URI. */
  private inProject(command: string, read: (uri: Uri | undefined) => unknown) {
    return this.withProject(({ syncRequestId }: { syncRequestId?: string }) =>
      this.handleSyncRequest(
        syncRequestId,
        () => read(window.activeTextEditor?.document.uri),
        command,
        command === "getSourcesInProject",
      ),
    );
  }

  handlers(): Pick<Handlers<PanelMessage>, RequestCommand> {
    const { host } = this;
    return {
      showWarningMessage: (message) => this.showNotification(message),
      showInformationMessage: (message) => this.showNotification(message),
      getTestCode: this.withProject(({ syncRequestId, test, model }) =>
        this.handleSyncRequest(
          syncRequestId,
          () => this.getDbtTestCode(test as unknown as TestMetaData, model),
          "getTestCode",
        ),
      ),
      getUnitTestCode: this.withProject(({ syncRequestId, path, name }) =>
        this.handleSyncRequest(
          syncRequestId,
          () => getUnitTestCode(path, name),
          "getUnitTestCode",
        ),
      ),
      getDistinctColumnValues: this.withProject(
        ({ syncRequestId, model, column }, project) =>
          this.handleSyncRequest(
            syncRequestId,
            () => {
              if (!model) {
                throw new UserInputError("No model is loaded");
              }
              return project.getColumnValues(model, column);
            },
            "getDistinctColumnValues",
            true,
          ),
      ),
      getColumnsOfSources: this.withProject(
        ({ syncRequestId, source, table }, project) =>
          this.handleSyncRequest(
            syncRequestId,
            async () => ({
              columns:
                (await project.getColumnsOfSource(source, table))?.map(
                  (c) => c.column,
                ) ?? [],
            }),
            "getColumnsOfSources",
            true,
          ),
      ),
      getColumnsOfModel: this.withProject(({ syncRequestId, model }, project) =>
        this.handleSyncRequest(
          syncRequestId,
          async () => ({
            columns:
              (await project.getColumnsOfModel(model))?.map((c) => c.column) ??
              [],
          }),
          "getColumnsOfModel",
          true,
        ),
      ),
      getSourcesInProject: this.inProject("getSourcesInProject", (uri) => ({
        sources: host.queryManifestService.getSourcesInProject(uri),
      })),
      getModelsInProject: this.inProject("getModelsInProject", (uri) => ({
        models: host.queryManifestService.getModelsInProject(uri),
      })),
    };
  }
}

/** Shows a progress notification while `work` runs. */
export function withSaveProgress<T>(title: string, work: () => Promise<T>) {
  return window.withProgress(
    { title, location: ProgressLocation.Notification, cancellable: false },
    work,
  );
}
