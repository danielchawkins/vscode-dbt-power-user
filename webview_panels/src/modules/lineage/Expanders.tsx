import type { lineage } from "@fusion-power-user/webview-contract";
import { use } from "react";
import type { Direction } from "./graph";
import styles from "./lineageGraph.module.css";
import { TableActionsContext } from "./viewModel";

/**
 * The parents or children count of a card. In the layered layout it is a bubble on the card's top or bottom edge,
 * with an arrow for the direction it expands; elsewhere it is a button in the actions row.
 */
export const ExpandButton = ({
  table,
  direction,
  expanded,
  pending,
  layered = false,
}: {
  table: lineage.LineageTable;
  direction: Direction;
  expanded: boolean;
  pending: boolean;
  layered?: boolean;
}): React.JSX.Element => {
  const up = direction === "parents";
  const count = up ? table.parentCount : table.childCount;
  const title = pending
    ? `Loading ${count} ${direction}; click to cancel`
    : `${expanded ? "Hide" : "Show"} ${count} ${direction}`;
  const sign = expanded ? "−" : "+";
  const icon = (
    <span className={`codicon codicon-arrow-${up ? "up" : "down"}`} />
  );
  const actions = use(TableActionsContext);
  let body: React.ReactNode = up ? `${sign}${count}` : `${count}${sign}`;
  if (layered) {
    body = up ? (
      <>
        {icon}
        {count}
      </>
    ) : (
      <>
        {count}
        {icon}
      </>
    );
  }
  if (pending) {
    body = <span className="codicon codicon-loading codicon-modifier-spin" />;
  }
  const placement = up ? styles.bubbleTop : styles.bubbleBottom;
  return (
    <button
      type="button"
      className={`nodrag ${styles.expander} ${layered ? `${styles.bubble} ${placement}` : ""}`}
      disabled={count === 0}
      aria-pressed={expanded}
      aria-busy={pending}
      aria-label={title}
      title={title}
      onClick={() => actions.toggleExpansion(table.table, direction)}
    >
      {body}
    </button>
  );
};

export const MoreButton = ({
  table,
  direction,
  hidden,
}: {
  table: string;
  direction: Direction;
  hidden: number;
}): React.JSX.Element | null => {
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
