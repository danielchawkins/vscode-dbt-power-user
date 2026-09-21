import { DBTTerminal, NodeMetaMap } from "@altimateai/dbt-integration";
import { inject } from "inversify";
import {
  CancellationToken,
  Disposable,
  Hover,
  HoverProvider,
  MarkdownString,
  Position,
  ProviderResult,
  Range,
  TextDocument,
  Uri,
} from "vscode";
import { DBTProjectContainer } from "../dbt_client/dbtProjectContainer";
import { ManifestCacheChangedEvent } from "../dbt_client/event/manifestCacheChangedEvent";
import { generateHoverMarkdownString } from "./utils";

export class ModelHoverProvider implements HoverProvider, Disposable {
  private modelToLocationMap: Map<string, NodeMetaMap> = new Map();
  private static readonly IS_REF = /(ref)\([^)]*\)/;
  private static readonly GET_DBT_MODEL = /(?!'|")([^(?!'|")]*)(?='|")/gi;
  private disposables: Disposable[] = [];

  constructor(
    private dbtProjectContainer: DBTProjectContainer,
    @inject("DBTTerminal")
    private dbtTerminal: DBTTerminal,
  ) {
    this.disposables.push(
      dbtProjectContainer.onManifestChanged((event) =>
        this.onManifestCacheChanged(event),
      ),
    );
  }

  dispose() {
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  provideHover(
    document: TextDocument,
    position: Position,
    token: CancellationToken,
  ): ProviderResult<Hover> {
    return new Promise((resolve) => {
      const hover = document.getText(document.getWordRangeAtPosition(position));
      const range = document.getWordRangeAtPosition(
        position,
        ModelHoverProvider.IS_REF,
      );
      if (!range) {
        resolve(undefined);
      }
      const word = document.getText(range);
      const project = this.dbtProjectContainer.findDBTProject(document.uri);
      if (!project) {
        this.dbtTerminal.debug(
          "modeHoverProvider:provideHover",
          "Could not load hover provider, project not found in container for " +
            document.uri.fsPath,
        );
        resolve(undefined);
        return;
      }
      if (word !== undefined && hover !== "ref") {
        const dbtModel = word.match(ModelHoverProvider.GET_DBT_MODEL);
        if (dbtModel && dbtModel.length === 1) {
          const mdString = this.getHoverMarkdownFor(
            dbtModel[0],
            project.projectRoot,
          );
          if (mdString !== undefined) {
            const hover = new Hover(mdString, new Range(position, position));
            resolve(hover);
          }
          return;
        }
        if (dbtModel && dbtModel.length === 3) {
          const mdString = this.getHoverMarkdownFor(
            dbtModel[2],
            project.projectRoot,
          );
          if (mdString !== undefined) {
            const hover = new Hover(mdString, new Range(position, position));
            resolve(hover);
          }
          return;
        }
      }
      resolve(undefined);
    });
  }

  private onManifestCacheChanged(event: ManifestCacheChangedEvent): void {
    event.added?.forEach((added) => {
      this.modelToLocationMap.set(
        added.project.projectRoot.fsPath,
        added.nodeMetaMap,
      );
    });
    event.removed?.forEach((removed) => {
      this.modelToLocationMap.delete(removed.projectRoot.fsPath);
    });
  }

  private getHoverMarkdownFor(
    modelName: string,
    currentFilePath: Uri,
  ): MarkdownString | undefined {
    const projectRootpath =
      this.dbtProjectContainer.getProjectRootpath(currentFilePath);
    if (projectRootpath === undefined) {
      return;
    }
    const nodeMap = this.modelToLocationMap.get(projectRootpath.fsPath);
    if (nodeMap === undefined) {
      return;
    }
    const node = nodeMap.lookupByBaseName(modelName);
    if (node) {
      return generateHoverMarkdownString(node, "ref");
    }
    return undefined;
  }
}
