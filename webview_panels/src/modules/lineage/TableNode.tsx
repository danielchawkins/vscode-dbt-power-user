import type { lineage } from "@fusion-power-user/webview-contract";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import { memo, use } from "react";
import {
  cardBadge,
  cardSubtitle,
  cardTooltip,
  middleEllipsis,
  TITLE_MAX,
} from "./card";
import type { TableNode as TableNodeType } from "./flow";
import type { Direction } from "./graph";
import { GroupChips } from "./GroupChips";
import { columnHandle } from "./layout";
import styles from "./lineageGraph.module.css";
import { TableActionsContext } from "./viewModel";

const ExpandButton = ({
  table,
  direction,
  count,
  expanded,
  pending,
}: {
  table: string;
  direction: Direction;
  count: number;
  expanded: boolean;
  pending: boolean;
}) => {
  const title = pending
    ? `Loading ${count} ${direction}; click to cancel`
    : `${expanded ? "Hide" : "Show"} ${count} ${direction}`;
  const sign = expanded ? "−" : "+";
  const actions = use(TableActionsContext);
  return (
    <button
      type="button"
      className={`nodrag ${styles.expander}`}
      disabled={count === 0}
      aria-pressed={expanded}
      aria-busy={pending}
      aria-label={title}
      title={title}
      onClick={() => actions.toggleExpansion(table, direction)}
    >
      {pending ? (
        <span className="codicon codicon-loading codicon-modifier-spin" />
      ) : direction === "parents" ? (
        `${sign}${count}`
      ) : (
        `${count}${sign}`
      )}
    </button>
  );
};

const MoreButton = ({
  table,
  direction,
  hidden,
}: {
  table: string;
  direction: Direction;
  hidden: number;
}) => {
  const actions = use(TableActionsContext);
  if (hidden <= 0) {
    return null;
  }
  const title = `Show ${hidden} more ${direction}`;
  return (
    <button
      type="button"
      className={`nodrag ${styles.more}`}
      aria-label={title}
      title={title}
      onClick={() => actions.showMore(table, direction)}
    >
      {`+${hidden}`}
    </button>
  );
};

const HIDDEN_TITLE = "Hidden from lineage by meta.lineage.hidden";

const Header = ({
  table,
  errors,
  hiddenFromLineage,
}: {
  table: lineage.LineageTable;
  errors?: string[] | undefined;
  hiddenFromLineage: boolean;
}) => (
  <div className={styles.header}>
    <Handle
      type="target"
      position={Position.Left}
      id="in"
      className={`${styles.handle} ${styles.headerHandle}`}
      isConnectable={false}
    />
    <span
      className={table.layer ? styles.layer : styles.type}
      title={
        table.layer ? `${table.nodeType}, ${table.layer} layer` : undefined
      }
    >
      {cardBadge(table)}
    </span>
    <span className={styles.label} title={cardTooltip(table)}>
      {middleEllipsis(table.label, TITLE_MAX)}
    </span>
    {errors?.length || hiddenFromLineage ? (
      <span className={styles.flags}>
        {errors?.length ? (
          <span
            role="img"
            className={`codicon codicon-warning ${styles.error}`}
            title={errors.join("\n")}
            aria-label={errors.join("\n")}
          />
        ) : null}
        {hiddenFromLineage ? (
          <>
            <i
              className="codicon codicon-eye-closed"
              title={HIDDEN_TITLE}
              aria-hidden="true"
            />
            <span className={styles.srOnly}>{HIDDEN_TITLE}</span>
          </>
        ) : null}
      </span>
    ) : (
      <span />
    )}
    <span className={styles.subtitle} title={cardSubtitle(table) || undefined}>
      {cardSubtitle(table) || "\u00a0"}
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
  pending,
  hidden,
  listed,
}: {
  table: lineage.LineageTable;
  expanded: { parents: boolean; children: boolean };
  pending: { parents: boolean; children: boolean };
  hidden: { parents: number; children: number };
  listed: boolean;
}) => {
  const actions = use(TableActionsContext);
  return (
    <div className={styles.actions}>
      <ExpandButton
        table={table.table}
        direction="parents"
        count={table.parentCount}
        expanded={expanded.parents}
        pending={pending.parents}
      />
      <MoreButton
        table={table.table}
        direction="parents"
        hidden={hidden.parents}
      />
      <button
        type="button"
        className="nodrag"
        aria-pressed={listed}
        onClick={() => actions.toggleColumns(table.table)}
      >
        Columns
      </button>
      <button
        type="button"
        className="nodrag"
        onClick={() => actions.openDetails(table.table)}
      >
        Details
      </button>
      {table.url ? (
        <button
          type="button"
          className="nodrag"
          title="Open file"
          aria-label="Open file"
          onClick={() => actions.openFile(table.url!)}
        >
          <span className="codicon codicon-go-to-file" />
        </button>
      ) : null}
      <MoreButton
        table={table.table}
        direction="children"
        hidden={hidden.children}
      />
      <ExpandButton
        table={table.table}
        direction="children"
        count={table.childCount}
        expanded={expanded.children}
        pending={pending.children}
      />
    </div>
  );
};

const ColumnRow = ({
  table,
  column,
  state,
}: {
  table: string;
  column: lineage.LineageColumn;
  state: string;
}) => {
  const actions = use(TableActionsContext);
  return (
    <button
      type="button"
      data-column={column.name}
      className={`${styles.column} ${state}`}
      title={column.description ?? column.name}
      onClick={() => actions.selectColumn(table, column.name)}
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
};

const STRICT_EMPTY = "Columns need strict static analysis";

const ColumnList = ({
  table,
  columns,
  traced,
  selectedColumn,
  columnsNeedStrict,
}: {
  table: string;
  columns: lineage.LineageColumn[];
  traced: string[];
  selectedColumn?: string | undefined;
  columnsNeedStrict?: boolean | undefined;
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
        <div className={styles.empty}>
          {columnsNeedStrict ? STRICT_EMPTY : "No columns"}
        </div>
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
}: NodeProps<TableNodeType>): React.JSX.Element => {
  // The graph never hides the start table, so its card shows no hidden cue either.
  const hiddenFromLineage = data.table.hidden === true && !data.isStart;
  return (
    <div
      className={`${styles.node} ${data.isStart ? styles.start : ""} ${
        hiddenFromLineage ? styles.hidden : ""
      }`}
      data-table={data.table.table}
    >
      <Header
        table={data.table}
        errors={data.errors}
        hiddenFromLineage={hiddenFromLineage}
      />
      <Actions
        table={data.table}
        expanded={data.expanded}
        pending={data.pending}
        hidden={data.hidden}
        listed={data.columns !== undefined}
      />
      <GroupChips chips={data.chips} />
      {data.columns ? (
        <ColumnList
          table={data.table.table}
          columns={data.columns}
          traced={data.traced}
          selectedColumn={data.selectedColumn}
          columnsNeedStrict={data.columnsNeedStrict}
        />
      ) : null}
    </div>
  );
};

export const TableNode = memo(TableNodeView);
