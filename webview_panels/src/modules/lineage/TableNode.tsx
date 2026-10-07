import type { lineage } from "@fusion-power-user/webview-contract";
import { Handle, NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { TableNode as TableNodeType } from "./flow";
import { Direction } from "./graph";
import { columnHandle } from "./layout";
import styles from "./lineageGraph.module.css";
import { tableActions } from "./viewModel";

const ExpandButton = ({
  table,
  direction,
  count,
  expanded,
}: {
  table: string;
  direction: Direction;
  count: number;
  expanded: boolean;
}) => {
  const title = `${expanded ? "Hide" : "Show"} ${count} ${direction}`;
  const sign = expanded ? "−" : "+";
  return (
    <button
      type="button"
      className={`nodrag ${styles.expander}`}
      disabled={count === 0}
      aria-pressed={expanded}
      aria-label={title}
      title={title}
      onClick={() => tableActions.current.toggleExpansion(table, direction)}
    >
      {direction === "parents" ? `${sign}${count}` : `${count}${sign}`}
    </button>
  );
};

const Header = ({
  table,
  errors,
}: {
  table: lineage.LineageTable;
  errors?: string[] | undefined;
}) => (
  <div className={styles.header}>
    <Handle
      type="target"
      position={Position.Left}
      id="in"
      className={`${styles.handle} ${styles.headerHandle}`}
      isConnectable={false}
    />
    <span className={styles.type}>{table.nodeType}</span>
    <span className={styles.label} title={table.table}>
      {table.label}
    </span>
    {errors?.length ? (
      <span
        role="img"
        className={`codicon codicon-warning ${styles.error}`}
        title={errors.join("\n")}
        aria-label={errors.join("\n")}
      />
    ) : (
      <span />
    )}
    <span className={styles.subtitle}>
      {[table.materialization, table.packageName].filter(Boolean).join(" · ") ||
        "\u00a0"}
    </span>
    <Handle
      type="source"
      position={Position.Right}
      id="out"
      className={`${styles.handle} ${styles.headerHandle}`}
      isConnectable={false}
    />
  </div>
);

const Actions = ({
  table,
  expanded,
  listed,
}: {
  table: lineage.LineageTable;
  expanded: { parents: boolean; children: boolean };
  listed: boolean;
}) => (
  <div className={styles.actions}>
    <ExpandButton
      table={table.table}
      direction="parents"
      count={table.parentCount}
      expanded={expanded.parents}
    />
    <button
      type="button"
      className="nodrag"
      aria-pressed={listed}
      onClick={() => tableActions.current.toggleColumns(table.table)}
    >
      Columns
    </button>
    <button
      type="button"
      className="nodrag"
      onClick={() => tableActions.current.openDetails(table.table)}
    >
      Details
    </button>
    {table.url ? (
      <button
        type="button"
        className="nodrag"
        title="Open file"
        aria-label="Open file"
        onClick={() => tableActions.current.openFile(table.url!)}
      >
        <span className="codicon codicon-go-to-file" />
      </button>
    ) : null}
    <ExpandButton
      table={table.table}
      direction="children"
      count={table.childCount}
      expanded={expanded.children}
    />
  </div>
);

const ColumnRow = ({
  table,
  column,
  state,
}: {
  table: string;
  column: lineage.LineageColumn;
  state: string;
}) => (
  <button
    type="button"
    data-column={column.name}
    className={`${styles.column} ${state}`}
    title={column.description ?? column.name}
    onClick={() => tableActions.current.selectColumn(table, column.name)}
  >
    <Handle
      type="target"
      position={Position.Left}
      id={columnHandle("in", column.name)}
      className={styles.handle}
      isConnectable={false}
    />
    <span className={styles.columnName}>{column.name}</span>
    <span className={styles.datatype}>{column.datatype}</span>
    <Handle
      type="source"
      position={Position.Right}
      id={columnHandle("out", column.name)}
      className={styles.handle}
      isConnectable={false}
    />
  </button>
);

const ColumnList = ({
  table,
  columns,
  traced,
  selectedColumn,
}: {
  table: string;
  columns: lineage.LineageColumn[];
  traced: string[];
  selectedColumn?: string | undefined;
}) => {
  const tracedSet = new Set(traced);
  const stateOf = (name: string) =>
    name === selectedColumn
      ? (styles.selected ?? "")
      : tracedSet.has(name)
        ? (styles.traced ?? "")
        : "";
  return (
    <div
      className={`nodrag nowheel ${styles.columns}`}
      data-testid="lineage-columns"
    >
      {columns.length === 0 ? (
        <div className={styles.empty}>No columns</div>
      ) : (
        columns.map((column) => (
          <ColumnRow
            key={column.name}
            table={table}
            column={column}
            state={stateOf(column.name.toLowerCase())}
          />
        ))
      )}
    </div>
  );
};

const TableNodeView = ({
  data,
}: NodeProps<TableNodeType>): React.JSX.Element => (
  <div
    className={`${styles.node} ${data.isStart ? styles.start : ""}`}
    data-table={data.table.table}
  >
    <Header table={data.table} errors={data.errors} />
    <Actions
      table={data.table}
      expanded={data.expanded}
      listed={data.columns !== undefined}
    />
    {data.columns ? (
      <ColumnList
        table={data.table.table}
        columns={data.columns}
        traced={data.traced}
        selectedColumn={data.selectedColumn}
      />
    ) : null}
  </div>
);

export const TableNode = memo(TableNodeView);
