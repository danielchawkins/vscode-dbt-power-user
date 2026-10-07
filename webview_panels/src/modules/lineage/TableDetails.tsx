import type { lineage } from "@fusion-power-user/webview-contract";
import { panelLogger } from "@modules/logger";
import { CodeBlock } from "@uicore";
import { useEffect, useState } from "react";
import styles from "./lineageGraph.module.css";
import { fetchDetails, fetchTableColumns, openFile } from "./requests";

/** The exposure and function fields the drawer shows. */
interface ExtraDetails {
  description?: string | undefined;
  maturity?: string | undefined;
  type?: string | undefined;
  url?: string | undefined;
  owner?: { name?: string; email?: string };
  config?: { volatility?: string } | undefined;
}

type Tab = "columns" | "tests" | "meta";

interface Loaded {
  id: string;
  columns?: lineage.TableColumns | undefined;
  extra?: ExtraDetails | undefined;
}

const extraCommand = (nodeType: string) =>
  nodeType === "exposure"
    ? "getExposureDetails"
    : nodeType === "function"
      ? "getFunctionDetails"
      : undefined;

/** Loads `table`'s columns and, for exposures and functions, their details; an answer for another table is ignored. */
const useDetails = (table: lineage.LineageTable) => {
  const [loaded, setLoaded] = useState<Loaded>({ id: table.table });
  const id = table.table;
  useEffect(() => {
    let live = true;
    const merge = (part: Omit<Loaded, "id">) =>
      live &&
      setLoaded((l) => (l.id === id ? { ...l, ...part } : { id, ...part }));
    const command = extraCommand(table.nodeType);
    if (command) {
      fetchDetails(command, id)
        .then((extra) => merge({ extra: extra as ExtraDetails }))
        .catch((error) => panelLogger.error("lineage details", error));
    }
    if (table.nodeType !== "exposure") {
      fetchTableColumns(id)
        .then((columns) => merge({ columns }))
        .catch((error) => panelLogger.error("lineage columns", error));
    }
    return () => {
      live = false;
    };
  }, [id, table.nodeType]);
  const current = loaded.id === id ? loaded : { id };
  const refresh = async () => {
    const columns = await fetchTableColumns(id, true);
    setLoaded((l) => ({ ...l, id, columns }));
  };
  return { ...current, refresh };
};

const Fields = ({ fields }: { fields: [string, unknown][] }) => (
  <dl>
    {fields
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([name, value]) => (
        <div key={name} style={{ display: "contents" }}>
          <dt>{name}</dt>
          <dd>{String(value)}</dd>
        </div>
      ))}
  </dl>
);

const ColumnsTable = ({
  nodeType,
  columns,
}: {
  nodeType: string;
  columns: lineage.LineageColumn[];
}) => (
  <table>
    <thead>
      <tr>
        <th>{nodeType === "function" ? "Argument" : "Column"}</th>
        <th>Type</th>
        <th>Description</th>
      </tr>
    </thead>
    <tbody>
      {columns.map((c) => (
        <tr key={c.name}>
          <td>{c.name}</td>
          <td>{c.datatype}</td>
          <td>{c.description}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const Tests = ({ tests }: { tests: lineage.LineageTable["tests"] }) => (
  <>
    {tests.map((test) => (
      <CodeBlock
        key={test.key}
        fileName={
          test.column_name ? `${test.key} (${test.column_name})` : test.key
        }
        code={test.raw_sql ?? ""}
        language="sql"
      />
    ))}
  </>
);

const Links = ({
  table,
  url,
  refresh,
}: {
  table: lineage.LineageTable;
  url?: string | undefined;
  refresh: () => Promise<void>;
}) => {
  const [syncing, setSyncing] = useState(false);
  const sync = () => {
    setSyncing(true);
    refresh()
      .catch((error) => panelLogger.error("lineage sync columns", error))
      .finally(() => setSyncing(false));
  };
  return (
    <div className={styles.tabs}>
      {table.url ? (
        <button type="button" onClick={() => openFile(table.url!)}>
          <span className="codicon codicon-go-to-file" /> Open file
        </button>
      ) : null}
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          {url}
        </a>
      ) : null}
      {table.nodeType === "source" ? (
        <button type="button" disabled={syncing} onClick={sync}>
          <span className="codicon codicon-sync" /> Sync with database
        </button>
      ) : null}
    </div>
  );
};

const tabLabel = (tab: Tab, columns: number, tests: number): string =>
  tab === "columns"
    ? `Columns (${columns})`
    : tab === "tests"
      ? `Tests (${tests})`
      : "Meta";

/** The drawer's name/value rows; unset values are left out by `Fields`. */
const summary = (
  table: lineage.LineageTable,
  columns: lineage.TableColumns | undefined,
  extra: ExtraDetails | undefined,
): [string, unknown][] => {
  const returns = columns?.returns;
  return [
    ["Type", table.nodeType],
    ["Materialization", table.materialization],
    ["Package", table.packageName],
    ["Unique ID", table.table],
    ["Exposure type", extra?.type],
    ["Maturity", extra?.maturity],
    ["Owner", extra?.owner?.name ?? extra?.owner?.email],
    ["Volatility", extra?.config?.volatility],
    ["Returns", returns && `${returns.datatype} ${returns.description}`],
  ];
};

const TabBody = ({
  tab,
  table,
  columns,
}: {
  tab: Tab;
  table: lineage.LineageTable;
  columns: lineage.TableColumns | undefined;
}) => {
  switch (tab) {
    case "columns":
      return (
        <ColumnsTable
          nodeType={table.nodeType}
          columns={columns?.columns ?? []}
        />
      );
    case "tests":
      return <Tests tests={table.tests} />;
    case "meta":
      return (
        <CodeBlock
          code={JSON.stringify(columns?.meta ?? table.meta ?? {}, null, 2)}
          language="json"
        />
      );
  }
};

/** The selected table's description, columns, tests with their SQL, and meta. */
const TableDetails = ({
  table,
}: {
  table: lineage.LineageTable;
}): React.JSX.Element => {
  const { columns, extra, refresh } = useDetails(table);
  const [tab, setTab] = useState<Tab>("columns");
  const description = [
    table.description,
    columns?.purpose,
    extra?.description,
  ].find(Boolean);
  return (
    <div className={styles.drawer} data-testid="lineage-details">
      <h3>{table.label}</h3>
      <Fields fields={summary(table, columns, extra)} />
      {description ? <p>{description}</p> : null}
      <Links table={table} url={extra?.url} refresh={refresh} />
      <div className={styles.tabs}>
        {(["columns", "tests", "meta"] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
          >
            {tabLabel(t, columns?.columns.length ?? 0, table.tests.length)}
          </button>
        ))}
      </div>
      <TabBody tab={tab} table={table} columns={columns} />
    </div>
  );
};

export default TableDetails;
