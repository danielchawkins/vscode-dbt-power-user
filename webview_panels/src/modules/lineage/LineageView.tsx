import type { Table } from "@altimateai/ui-components/lineage";
import {
  ApiHelper,
  Lineage,
  TooltipProvider,
} from "@altimateai/ui-components/lineage";
import type { lineage } from "@fusion-power-user/webview-contract";
import "@altimateai/ui-components/styles.css";
import {
  executeRequestInAsync,
  isLineageRequest,
  requestFromComponent,
} from "./requests";
import useAppContext from "@modules/app/useAppContext";
import { panelLogger } from "@modules/logger";
import { useEffect, useState } from "react";
import ActionWidget from "./ActionWidget";
import styles from "./lineage.module.scss";
import "./tailwind-globals.css";
import {
  componentTableRequests,
  HostTable,
  isComponentTableRequest,
  toComponentTable,
} from "./componentAdapter";
import { MissingLineageMessage, StaticLineageProps } from "./types";

const LineageView = (): JSX.Element | null => {
  const {
    state: { theme },
  } = useAppContext();

  const [isApiHelperInitialized, setIsApiHelperInitialized] = useState(false);
  const [renderNode, setRenderNode] = useState<
    {
      node?: Table;
      aiEnabled: boolean;
    } & Partial<StaticLineageProps>
  >({ aiEnabled: true });
  const [missingLineageMessage, setMissingLineageMessage] = useState<
    MissingLineageMessage | undefined
  >();
  // Bumped when a save arrives while column lineage is drawn; a new key remounts the graph, which requests `init`.
  const [graphKey, setGraphKey] = useState(0);

  useEffect(() => {
    panelLogger.info("LineageView updating components api helper");
    ApiHelper.get = async <T,>(url: string, data?: Record<string, unknown>) => {
      const params = data ?? {};
      if (isComponentTableRequest(url)) {
        const body = (await requestFromComponent(
          componentTableRequests[url],
          params,
        )) as { tables?: HostTable[] };
        return { ...body, tables: body.tables?.map(toComponentTable) } as T;
      }
      if (isLineageRequest(url)) {
        return (await requestFromComponent(url, params)) as T;
      }
      panelLogger.warn("lineage component requested an unknown command", url);
      return undefined as T;
    };
    ApiHelper.post = <T,>(url: string) => {
      panelLogger.warn("lineage component posted an unknown command", url);
      return Promise.resolve(undefined as T);
    };
    setIsApiHelperInitialized(true);
  }, []);

  const render = (
    hostData: {
      node?: HostTable;
      aiEnabled: boolean;
      missingLineageMessage?: MissingLineageMessage;
    } & StaticLineageProps,
  ) => {
    const data = {
      ...hostData,
      node: hostData.node && toComponentTable(hostData.node),
    };
    setMissingLineageMessage(data.missingLineageMessage);
    const event = new CustomEvent("renderStartNode", {
      detail: {
        ...data,
        lightdashEnabled: true,
        showCodeModal: true,
        config: { exportFinalLineage: false },
      },
    });
    document.dispatchEvent(event);
    setRenderNode(data);
  };

  useEffect(() => {
    const onMessage = (event: MessageEvent<lineage.HostMessage>) => {
      panelLogger.log("lineage:message -> ", JSON.stringify(event.data));
      const message = event.data;

      if (message.command === "render") {
        // `node` arrives as the host's table; the contract types it `unknown`.
        render(message.args as Parameters<typeof render>[0]);
      }
      if (message.command === "projectSaved") {
        // The component refetches edges only for a node it has not drawn, so a save remounts it.
        setGraphKey((key) => key + 1);
        executeRequestInAsync("init");
      }
    };

    window.addEventListener("message", onMessage);

    panelLogger.info("lineage:onload");
    document.documentElement.classList.add(styles.lineageBody);
    executeRequestInAsync("init");

    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, []);

  if (!isApiHelperInitialized || !renderNode) {
    return null;
  }

  const lineageType = renderNode.details ? "sql" : "dynamic";

  return (
    <TooltipProvider>
      <div className={styles.lineageView}>
        {lineageType === "dynamic" ? (
          <ActionWidget missingLineageMessage={missingLineageMessage} />
        ) : null}
        <div className={`${styles.lineageWrap} al-tw-scope`}>
          <Lineage
            key={graphKey}
            theme={theme}
            dynamicLineage={renderNode}
            lineageType={lineageType}
            sqlLineage={
              lineageType === "sql"
                ? (renderNode as StaticLineageProps)
                : undefined
            }
            allowSyncColumnsWithDB
          />
        </div>
      </div>
    </TooltipProvider>
  );
};

export default LineageView;
