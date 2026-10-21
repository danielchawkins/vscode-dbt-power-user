import type {
  documentationEditor,
  ShowNotification,
} from "@fusion-power-user/webview-contract";
import { existsSync, readFileSync } from "node:fs";
import type { Uri } from "vscode";
import { ProgressLocation, window } from "vscode";
import { parse, stringify } from "yaml";
import { UserInputError } from "../../core/errors";
import type { Log } from "../../core/log";
import type { TestMetaData } from "../../core/manifest/types";
import { notifyError } from "../../projects/output/notifications";
import type { Project } from "../../projects/project/project";
import type { ProjectQueries } from "../../projects/project/projectQueries";
import type { QueryManifestService } from "../../projects/project/queryManifestService";

/** What the handlers read from the active editor's project. */
export type DocsProject = Pick<Project, "projectRoot" | "getProjectName"> & {
  queries: Pick<
    ProjectQueries,
    "getColumnValues" | "getColumnsOfSource" | "getColumnsOfModel"
  >;
};
import { activeModelUri } from "../../projects/registry/previewUri";
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
  readonly queryManifestService: Pick<
    QueryManifestService,
    "getModelsInProject" | "getSourcesInProject"
  >;
  readonly dbtTestService: DbtTestService;
  getProject(): DocsProject | undefined;
  post(message: HostMessage): Thenable<boolean> | undefined;
}

interface Reply {
  syncRequestId?: string | undefined;
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
  private readonly host: DocsEditHost;

  constructor(host: DocsEditHost) {
    this.host = host;
  }

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
  withProject<M extends { syncRequestId?: string | undefined }>(
    handler: (message: M, project: DocsProject, modelPath: Uri) => unknown,
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
    return this.withProject(
      ({ syncRequestId }: { syncRequestId?: string | undefined }) =>
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
              return project.queries.getColumnValues(model, column);
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
                (await project.queries.getColumnsOfSource(source, table))?.map(
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
              (await project.queries.getColumnsOfModel(model))?.map(
                (c) => c.column,
              ) ?? [],
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

/**
 * Shows a progress notification while `work` runs. When `cancellable`, the user's cancel aborts the signal `work`
 * receives.
 */
export function withProgress<T>(
  title: string,
  work: (signal: AbortSignal) => Promise<T>,
  cancellable = false,
) {
  return window.withProgress(
    { title, location: ProgressLocation.Notification, cancellable },
    (_progress, token) => {
      const controller = new AbortController();
      if (!cancellable) {
        return work(controller.signal);
      }
      if (token.isCancellationRequested) {
        controller.abort();
      }
      const listener = token.onCancellationRequested(() => controller.abort());
      return work(controller.signal).finally(() => listener.dispose());
    },
  );
}
