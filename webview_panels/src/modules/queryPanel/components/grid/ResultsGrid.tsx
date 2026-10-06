import { TableData } from "@modules/queryPanel/context/types";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Drawer, DrawerRef } from "@uicore";
import { CSSProperties, useRef, useState } from "react";
import { cellViewerText } from "./cellViewer";
import classes from "./grid.module.css";
import GridBodyRow from "./GridBodyRow";
import GridHeaderCell from "./GridHeaderCell";
import { ROW_HEIGHT } from "./gridTable";
import GridToolbar from "./GridToolbar";
import { useGridSelection } from "./useGridSelection";
import { useGridTable } from "./useGridTable";

const OVERSCAN = 12;

interface Props {
  data: TableData;
  columnNames: string[];
  columnTypes: (string | null)[];
  styles?: CSSProperties | undefined;
}

const ResultsGrid = ({
  columnNames,
  columnTypes,
  data,
  styles,
}: Props): React.JSX.Element => {
  const { table, schema, rows } = useGridTable(columnNames, columnTypes, data);
  const bodyRows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<DrawerRef | null>(null);
  const [drawer, setDrawer] = useState({ title: "", text: "" });
  const select = useGridSelection(bodyRows);
  const virtualizer = useVirtualizer({
    count: bodyRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  return (
    <div className={classes.root} style={styles}>
      <GridToolbar
        columnNames={columnNames}
        rows={rows}
        rowCount={bodyRows.length}
      />
      <div
        ref={scrollRef}
        className={classes.scroller}
        role="grid"
        aria-rowcount={bodyRows.length + 1}
        aria-colcount={columnNames.length}
        tabIndex={0}
        onCopy={select.onCopy}
        onMouseUp={select.stopDragging}
        onMouseLeave={select.stopDragging}
      >
        <div style={{ width: table.getTotalSize(), minWidth: "100%" }}>
          {table.getHeaderGroups().map((group) => (
            <div key={group.id} className={classes.headerRow} role="row">
              {group.headers.map((header) => (
                <GridHeaderCell key={header.id} header={header} />
              ))}
            </div>
          ))}
          <div
            className={classes.body}
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const row = bodyRows[item.index];
              return row ? (
                <GridBodyRow
                  key={row.id}
                  row={row}
                  index={item.index}
                  start={item.start}
                  height={ROW_HEIGHT}
                  schema={schema}
                  selection={select.selection}
                  onCellMouseDown={select.onCellMouseDown}
                  onCellMouseEnter={select.onCellMouseEnter}
                  onOpenViewer={(column, kind, value) => {
                    setDrawer({
                      title: column,
                      text: cellViewerText(kind, value),
                    });
                    drawerRef.current?.open();
                  }}
                />
              ) : null;
            })}
          </div>
        </div>
      </div>
      <Drawer ref={drawerRef} title={drawer.title} backdrop={false}>
        <pre>{drawer.text}</pre>
      </Drawer>
    </div>
  );
};

export default ResultsGrid;
