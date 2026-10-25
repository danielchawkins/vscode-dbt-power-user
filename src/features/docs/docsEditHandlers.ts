import type {
  documentationEditor,
  ShowNotification,
} from "@fusion-power-user/webview-contract";
import { existsSync, readFileSync } from "node:fs";
import type { Uri } from "vscode";
import { window } from "vscode";
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
import type { Handlers, MessageSink } from "../../webview/messageRouter";
import { reply, replyError } from "../../webview/messageRouter";
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
  /** The project that answers for the document at `uri`, if one does. */
  getProject(uri: Uri): DocsProject | undefined;
  post(message: HostMessage): Thenable<boolean> | undefined;
}

/** The active editor's document and the project that answers for it, resolved once per request. */
export interface ActiveModel {
  uri: Uri;
  project: DocsProject;
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

  /** Answers a panel request: with `error` as a failure, otherwise with `data` as the body. */
  sendResponse({ data, error, syncRequestId }: Reply): void {
    const sink: Pick<MessageSink, "reply"> = {
      reply: (response) => this.host.post(response),
    };
    void (error
      ? replyError(sink, syncRequestId, error)
      : reply(sink, syncRequestId, data));
  }

  /**
   * Runs `callback` and answers `syncRequestId` with its result or its error. A failure also shows an error
   * notification for `notifyProject` when it is set.
   */
  async handleSyncRequest<C extends RequestCommand>(
    syncRequestId: string | undefined,
    callback: () =>
      | documentationEditor.ResponseBodies[C]
      | PromiseLike<documentationEditor.ResponseBodies[C]>,
    command: C,
    notifyProject?: DocsProject,
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
      if (notifyProject) {
        void notifyError(notifyProject, message);
      }
      this.sendResponse({ syncRequestId, error: message });
    }
  }

  /** Runs `handler` with the active model, or answers the request with why there is none. */
  withProject<M extends { syncRequestId?: string | undefined }>(
    handler: (message: M, active: ActiveModel) => unknown,
  ): (message: M) => unknown {
    return (message) => {
      const uri = window.activeTextEditor?.document.uri;
      if (!uri) {
        return this.sendResponse({
          syncRequestId: message.syncRequestId,
          error: "No active editor",
        });
      }
      const project = this.host.getProject(uri);
      if (!project) {
        return this.sendResponse({
          syncRequestId: message.syncRequestId,
          error: "No dbt project found for the active editor",
        });
      }
      return handler(message, { uri, project });
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
  private inProject<C extends RequestCommand>(
    command: C,
    read: (uri: Uri) => documentationEditor.ResponseBodies[C],
  ) {
    return this.withProject(
      ({ syncRequestId }: { syncRequestId?: string | undefined }, active) =>
        this.handleSyncRequest(
          syncRequestId,
          () => read(active.uri),
          command,
          command === "getSourcesInProject" ? active.project : undefined,
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
        ({ syncRequestId, model, column }, { project }) =>
          this.handleSyncRequest(
            syncRequestId,
            () => {
              if (!model) {
                throw new UserInputError("No model is loaded");
              }
              return project.queries.getColumnValues(model, column);
            },
            "getDistinctColumnValues",
            project,
          ),
      ),
      getColumnsOfSources: this.withProject(
        ({ syncRequestId, source, table }, { project }) =>
          this.handleSyncRequest(
            syncRequestId,
            async () => ({
              columns:
                (await project.queries.getColumnsOfSource(source, table))?.map(
                  (c) => c.column,
                ) ?? [],
            }),
            "getColumnsOfSources",
            project,
          ),
      ),
      getColumnsOfModel: this.withProject(
        ({ syncRequestId, model }, { project }) =>
          this.handleSyncRequest(
            syncRequestId,
            async () => ({
              columns:
                (await project.queries.getColumnsOfModel(model))?.map(
                  (c) => c.column,
                ) ?? [],
            }),
            "getColumnsOfModel",
            project,
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
