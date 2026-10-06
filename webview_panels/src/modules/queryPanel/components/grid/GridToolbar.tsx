import { TableData } from "@modules/queryPanel/context/types";
import { Button } from "@uicore";
import { downloadAsCsv } from "./downloadCsv";
import classes from "./grid.module.css";

/** The export button and the row count above the grid. */
const GridToolbar = ({
  columnNames,
  rows,
  rowCount,
}: {
  columnNames: string[];
  rows: TableData;
  rowCount: number;
}): React.JSX.Element => (
  <div className={classes.toolbar}>
    <Button color="primary" onClick={() => downloadAsCsv(columnNames, rows)}>
      Export CSV
    </Button>
    <span className={classes.count}>{rowCount} rows</span>
  </div>
);

export default GridToolbar;
