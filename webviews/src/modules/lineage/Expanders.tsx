import type { lineage } from "@fusion-power-user/webview-contract";
import { use } from "react";
import type { Direction } from "./graph";
import styles from "./lineageGraph.module.css";
import { TableActionsContext } from "./viewModel";

/**
 * The parents or children count of a card: a bubble on the card's top or bottom edge, with an arrow for the direction
 * it expands.
 */
export const ExpandButton = ({
  table,
  direction,
  expanded,
  pending,
  expandable,
}: {
  table: lineage.LineageTable;
  direction: Direction;
  expanded: boolean;
  pending: boolean;
  expandable: boolean;
}): React.JSX.Element => {
  const up = direction === "parents";
  const count = up ? table.parentCount : table.childCount;
  const placement = up ? styles.bubbleTop : styles.bubbleBottom;
  const icon = (
    <span className={`codicon codicon-arrow-${up ? "up" : "down"}`} />
  );
  // Whole project: the count is shown, but there is nothing to open, so the bubble is not a control.
  if (!expandable) {
    return (
      <span
        className={`${styles.expander} ${styles.bubble} ${placement}`}
        title={`${count} ${direction}`}
      >
        {up ? (
          <>
            {icon}
            {count}
          </>
        ) : (
          <>
            {count}
            {icon}
          </>
        )}
      </span>
    );
  }
  const title = pending
    ? `Loading ${count} ${direction}; click to cancel`
    : `${expanded ? "Hide" : "Show"} ${count} ${direction}`;
  const actions = use(TableActionsContext);
  let body: React.ReactNode = up ? (
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
  if (pending) {
    body = <span className="codicon codicon-loading codicon-modifier-spin" />;
  }
  return (
    <button
      type="button"
      className={`nodrag ${styles.expander} ${styles.bubble} ${placement}`}
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
  capped,
}: {
  table: string;
  direction: Direction;
  capped: number;
}): React.JSX.Element | null => {
  const actions = use(TableActionsContext);
  if (capped <= 0) {
    return null;
  }
  const title = `Show ${capped} more ${direction}`;
  return (
    <button
      type="button"
      className={`nodrag ${styles.more}`}
      aria-label={title}
      title={title}
      onClick={() => actions.showMore(table, direction)}
    >
      {`+${capped}`}
    </button>
  );
};
