import type { lineage } from "@fusion-power-user/webview-contract";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import { Fragment, memo, use } from "react";
import {
  cardFile,
  cardSubtitle,
  cardTooltip,
  cardTitle,
  packageNameOf,
  type TitleMode,
} from "./card";
import { ExpandButton, MoreButton } from "./Expanders";
import type { TableNode as TableNodeType } from "./flow";
import { GroupChips } from "./GroupChips";
import { columnHandle } from "./layout";
import styles from "./lineageGraph.module.css";
import { useZoomedOut } from "./semanticZoom";
import { ErrorFlag, TraceStatus } from "./TraceStatus";
import { TableActionsContext } from "./viewModel";

const HIDDEN_TITLE = "Hidden from lineage by meta.lineage.hidden";

const NameBlock = ({
  table,
  mode,
  file,
  zoomedOut,
}: {
  table: lineage.LineageTable;
  mode: TitleMode;
  file: string | undefined;
  zoomedOut: boolean;
}) => {
  const pkg = packageNameOf(table);
  return (
    <span className={styles.names} title={cardTooltip(table)}>
      <span className={styles.label}>{cardTitle(table, mode, zoomedOut)}</span>
      {file ? <span className={styles.file}>{file}</span> : null}
      <span className={styles.tags}>
        {pkg ? <span className={styles.tag}>{pkg}</span> : null}
        <span className={`${styles.tag} ${styles.typeTag}`}>
          {table.nodeType}
        </span>
      </span>
    </span>
  );
};

const Header = ({
  table,
  file,
  errors,
  hiddenFromLineage,
  zoomedOut,
  mode,
  showRelation,
}: {
  mode: TitleMode;
  table: lineage.LineageTable;
  file: string | undefined;
  errors?: string[] | undefined;
  hiddenFromLineage: boolean;
  zoomedOut: boolean;
  showRelation: boolean;
}) => (
  <div
    className={`${styles.header} ${showRelation ? styles.headerRelation : ""} ${
      table.layer ? styles.noBadge : ""
    }`}
    title={table.layer ? `${table.layer} layer` : undefined}
  >
    <Handle
      type="target"
      position={Position.Top}
      id="in"
      className={`${styles.handle} ${styles.headerHandle}`}
      isConnectable={false}
    />
    {/* A card with a layer shows it as the stripe on its left edge; the others keep their type badge. */}
    {table.layer ? null : <span className={styles.type}>{table.nodeType}</span>}
    <NameBlock table={table} mode={mode} file={file} zoomedOut={zoomedOut} />
    {errors?.length || hiddenFromLineage ? (
      <span className={styles.flags}>
        {errors?.length ? <ErrorFlag errors={errors} /> : null}
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
    {showRelation ? (
      <span
        className={styles.subtitle}
        title={cardSubtitle(table, mode) || undefined}
      >
        {cardSubtitle(table, mode) || "\u00a0"}
      </span>
    ) : null}
  </div>
);

const Tools = ({
  table,
  listed,
}: {
  table: lineage.LineageTable;
  listed: boolean;
}) => {
  const actions = use(TableActionsContext);
  return (
    <>
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
    </>
  );
};

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
}) => (
  <>
    <div className={styles.actions}>
      <MoreButton
        table={table.table}
        direction="parents"
        hidden={hidden.parents}
      />
      <Tools table={table} listed={listed} />
      <MoreButton
        table={table.table}
        direction="children"
        hidden={hidden.children}
      />
    </div>
    {/* The expanders are bubbles on the card's edges, outside the actions row. */}
    <ExpandButton
      table={table}
      direction="parents"
      expanded={expanded.parents}
      pending={pending.parents}
    />
    <ExpandButton
      table={table}
      direction="children"
      expanded={expanded.children}
      pending={pending.children}
    />
  </>
);

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
  tracing,
  columnsNeedStrict,
}: {
  table: string;
  columns: lineage.LineageColumn[];
  traced: string[];
  selectedColumn?: string | undefined;
  tracing?: { column: string; since: number } | undefined;
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
        columns.map((column) => {
          const name = column.name.toLowerCase();
          return (
            <Fragment key={column.name}>
              <ColumnRow table={table} column={column} state={stateOf(name)} />
              {tracing?.column === name ? (
                <TraceStatus since={tracing.since} />
              ) : null}
            </Fragment>
          );
        })
      )}
    </div>
  );
};

const TableNodeView = ({
  data,
  selected,
}: NodeProps<TableNodeType>): React.JSX.Element => {
  // The graph never hides the start table, so its card shows no hidden cue either.
  const hiddenFromLineage = data.table.hidden === true && !data.isStart;
  const zoomedOut = useZoomedOut();
  // The start and selected cards keep their relation line and actions row; other cards show the row on hover.
  const pinned = data.isStart || selected;
  return (
    <div
      className={`${styles.node} ${data.isStart ? styles.start : ""} ${
        hiddenFromLineage ? styles.hidden : ""
      } ${zoomedOut ? styles.zoomedOut : ""} ${
        data.columns === undefined ? styles.noColumns : ""
      } ${pinned ? styles.pinned : ""}`}
      style={{ "--layer-colour": data.layerColour } as React.CSSProperties}
      data-table={data.table.table}
      data-layer={data.table.layer}
    >
      <Header
        table={data.table}
        file={cardFile(data.table, data.title)}
        errors={data.errors}
        hiddenFromLineage={hiddenFromLineage}
        zoomedOut={zoomedOut}
        mode={data.title}
        showRelation={pinned}
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
          tracing={data.tracing}
          columnsNeedStrict={data.columnsNeedStrict}
        />
      ) : null}
      <Handle
        type="source"
        position={Position.Bottom}
        id="out"
        className={`${styles.handle} ${styles.headerHandle}`}
        isConnectable={false}
      />
    </div>
  );
};

export const TableNode = memo(TableNodeView);
