import useAppContext from "@modules/app/useAppContext";
import { panelLogger } from "@modules/logger";
import { useQueryPanelDispatch } from "@modules/queryPanel/context/queryPanelContext";
import { setPerspectiveTheme } from "@modules/queryPanel/context/queryPanelReducer";
import { TableData } from "@modules/queryPanel/context/types";
import { executeRequestInAsync } from "@modules/queryPanel/requests";
import useQueryPanelState from "@modules/queryPanel/useQueryPanelState";
import perspective from "@perspective-dev/client";
import "@perspective-dev/viewer";
import type {
  HTMLPerspectiveViewerElement,
  ViewerConfigUpdate,
} from "@perspective-dev/viewer";
import "@perspective-dev/viewer-charts";
import "@perspective-dev/viewer-datagrid";
import "@perspective-dev/viewer/themes/monokai.css";
import "@perspective-dev/viewer/themes/pro-dark.css";
import "@perspective-dev/viewer/themes/pro.css";
import "@perspective-dev/viewer/themes/solarized-dark.css";
import "@perspective-dev/viewer/themes/solarized.css";
import "@perspective-dev/viewer/themes/vaporwave.css";
import { Drawer, DrawerRef } from "@uicore";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useErrorBoundary } from "react-error-boundary";
import { attachCellViewer, CellViewerDetail } from "./cellViewer";
import { buildPerspectiveTableInit } from "./columnTypeMapping";
import "./initPerspective";
import perspectiveStyles from "./perspective.css?inline";
import classes from "./perspective.module.css";
import "./themes.css";

/** Name of the query result table on the shared Perspective client. */
const TABLE_NAME = "query_result";

interface Props {
  data: TableData;
  columnNames: string[];
  columnTypes: (string | null)[];
  styles?: CSSProperties;
}
const PerspectiveViewer = ({
  columnNames,
  columnTypes,
  data,
  styles,
}: Props): JSX.Element => {
  const {
    state: { theme },
  } = useAppContext();

  const { showBoundary } = useErrorBoundary();

  const { perspectiveTheme } = useQueryPanelState();
  const dispatch = useQueryPanelDispatch();
  const [tableRendered, setTableRendered] = useState(false);
  const [drawerData, setDrawerData] = useState<string>("");
  const [drawerTitle, setDrawerTitle] = useState<string>("");
  const perspectiveViewerRef = useRef<HTMLPerspectiveViewerElement>(null);
  const drawerRef = useRef<DrawerRef | null>(null);

  const columnsConfig = Object.fromEntries(
    columnNames.flatMap((name, index) => {
      const type = columnTypes[index];
      if (type !== "Integer" && type !== "Number") {
        return [];
      }
      return [
        [
          name,
          {
            number_format: {
              minimumIntegerDigits: null,
              minimumFractionDigits: 0,
              maximumFractionDigits: 20,
              minimumSignificantDigits: null,
              maximumSignificantDigits: null,
              roundingPriority: null,
              roundingIncrement: null,
              roundingMode: null,
              trailingZeroDisplay: null,
              useGrouping: false,
              signDisplay: null,
            },
          },
        ],
      ];
    }),
  );

  const config: ViewerConfigUpdate = {
    table: TABLE_NAME,
    theme: perspectiveTheme,
    title: "query result",
    columns: [...columnNames],
    columns_config: columnsConfig,
    settings: false,
    plugin_config: { editable: false },
  };

  // Converts the provided data to CSV format.
  const dataToCsv = (columns: string[], rows: TableData) => {
    if (!Array.isArray(rows)) {
      return;
    }

    if (!rows || rows.length === 0) {
      panelLogger.error("No data available to convert to CSV");
      return "";
    }
    const replacer = (_key: string, value: unknown) =>
      value === null ? "" : value;
    const csv = [
      columns.join(","),
      ...rows.map((row) =>
        columns
          .map((fieldName) => {
            const fieldData = row[fieldName];
            if (fieldData && typeof fieldData === "string") {
              return `"${fieldData.replace(/"/g, '""')}"`; // escape double quotes and Wrap in double quotes
            }
            return JSON.stringify(fieldData, replacer);
          })
          .join(","),
      ),
    ].join("\r\n");
    return csv;
  };

  const downloadAsCSV = () => {
    try {
      if (!data || !Array.isArray(data) || data.length === 0) {
        panelLogger.error("No data available for downloading.");
        return;
      }
      const csvContent = dataToCsv(columnNames, data);
      if (!csvContent) {
        panelLogger.info("empty csv content", columnNames, data);
        return;
      }
      const blob = new Blob([csvContent], { type: "text/csv" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `power_user_data_${new Date().toISOString()}.csv`; // Filename with a timestamp
      a.click();
    } catch (error) {
      // Log error for debugging
      panelLogger.error("Failed to download CSV:", error);
      executeRequestInAsync("error", {
        text: "Unable to download data as CSV. " + (error as Error).message,
      });
    }
  };

  const updateCustomStyles = (currentTheme: string) => {
    const shadowRoot = perspectiveViewerRef.current?.querySelector(
      "perspective-viewer-datagrid",
    )?.shadowRoot;
    if (!shadowRoot) {
      return;
    }
    const id = "perspective-styles";
    shadowRoot.getElementById(id)?.remove();

    const style = document.createElement("style");
    style.textContent = perspectiveStyles;
    style.id = id;
    shadowRoot.appendChild(style);
    shadowRoot.querySelector("regular-table")?.setAttribute("theme", theme);
    shadowRoot
      .querySelector("regular-table")
      ?.setAttribute("perspective-theme", currentTheme);
  };

  const loadPerspectiveData = async () => {
    if (!perspectiveViewerRef.current) {
      return;
    }

    const { schema, rows } = buildPerspectiveTableInit(
      columnNames,
      columnTypes,
      data,
    );
    try {
      // `perspective.worker()` takes the client WebAssembly from the defined `perspective-viewer` element.
      await customElements.whenDefined("perspective-viewer");
      const worker = await perspective.worker();
      const table = await worker.table(schema, { name: TABLE_NAME });
      await table.replace(rows);

      await perspectiveViewerRef.current.load(worker);
      await perspectiveViewerRef.current.resetThemes([
        "Vintage",
        "Pro Light",
        "Pro Dark",
        "Vaporwave",
        "Solarized",
        "Solarized Dark",
        "Monokai",
      ]);
      await perspectiveViewerRef.current.restore(config);
      await attachCellViewer(perspectiveViewerRef.current);
      const exportButton =
        perspectiveViewerRef.current.shadowRoot?.getElementById("export");
      exportButton?.removeEventListener("click", downloadAsCSV);
      exportButton?.addEventListener("click", downloadAsCSV);
      updateCustomStyles(perspectiveTheme);
      perspectiveViewerRef.current.addEventListener(
        "perspective-config-update",
        (event) => {
          const { theme: nextTheme } = event.detail.getConfig();
          panelLogger.log("perspective-config-update", nextTheme);
          if (nextTheme) {
            updateCustomStyles(nextTheme);
            executeRequestInAsync("updateConfig", {
              perspectiveTheme: nextTheme,
            });
            dispatch(setPerspectiveTheme(nextTheme));
          }
        },
      );
    } catch (err) {
      panelLogger.error("error while loading perspective data", err);
      // catching this error: Uncaught (in promise) RangeError: WebAssembly.instantiate(): Out of memory: Cannot allocate Wasm memory for new instance
      const isWasmError = (err as Error)?.message?.includes(
        "WebAssembly.instantiate",
      );
      if (isWasmError) {
        showBoundary(err);
      }
    }
    setTableRendered(true);
  };

  useEffect(() => {
    loadPerspectiveData().catch((err) => panelLogger.error(err));

    // Handle the event when a string or JSON is clicked in the perspective viewer datagrid
    const handleOpenDrawer = (event: CustomEvent<CellViewerDetail>) => {
      drawerRef.current?.open();
      const detail = event.detail;
      setDrawerTitle(detail?.columnName);
      if (detail?.type === "string") {
        // adding \n after every 45 characters to make it readable
        setDrawerData(
          detail?.message.match(/.{1,45}/g)?.join("\n") ?? detail?.message,
        );
      } else if (detail?.type === "json") {
        // Pretty print JSON
        setDrawerData(JSON.stringify(JSON.parse(detail?.message), null, 2));
      }
    };

    // Add an event listener to open the drawer when a string or JSON is clicked
    window.addEventListener(
      "string-json-viewer",
      handleOpenDrawer as EventListener,
    );

    return () => {
      perspectiveViewerRef.current
        ?.getTable()
        .then((table: { delete(): Promise<void> }) => table.delete())
        .catch((err) =>
          panelLogger.error("error while deleting perspective table", err),
        );
      perspectiveViewerRef.current
        ?.delete()
        .catch((err) =>
          panelLogger.error("error while deleting perspective viewer", err),
        );

      // Remove the event listener when the component is unmounted
      window.removeEventListener(
        "string-json-viewer",
        handleOpenDrawer as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    if (!tableRendered || !config.theme || !perspectiveViewerRef.current) {
      return;
    }

    perspectiveViewerRef.current
      ?.querySelector("perspective-viewer-datagrid")
      ?.shadowRoot?.querySelector("regular-table")
      ?.setAttribute("theme", theme);
    perspectiveViewerRef.current
      .restore(config)
      .catch((err) =>
        panelLogger.error("error while restoring perspective", err),
      );
  }, [theme, tableRendered]);

  return (
    <>
      <perspective-viewer
        class={classes.perspectiveViewer}
        ref={perspectiveViewerRef}
        style={styles}
      ></perspective-viewer>
      <Drawer ref={drawerRef} title={drawerTitle} backdrop={false}>
        <pre>{drawerData}</pre>
      </Drawer>
    </>
  );
};
export default PerspectiveViewer;
