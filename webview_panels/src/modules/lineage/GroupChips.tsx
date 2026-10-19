import { use } from "react";
import type { GroupChip } from "./expansionGroups";
import styles from "./lineageGraph.module.css";
import { TableActionsContext } from "./viewModel";

/** One chip per open group of an expanded table: its label, how many members it draws, and a button closing it. */
export const GroupChips = ({
  chips,
}: {
  chips: readonly GroupChip[];
}): React.JSX.Element | null => {
  const actions = use(TableActionsContext);
  if (chips.length === 0) {
    return null;
  }
  return (
    <div className={styles.groupChips}>
      {chips.map((chip) => (
        <span key={chip.id} className={styles.chip} title={chip.label}>
          <span className={styles.chipLabel}>{chip.label}</span>
          <span>{`${chip.drawn}/${chip.total}`}</span>
          <button
            type="button"
            className="nodrag"
            aria-label={`Close ${chip.label}`}
            title={`Close ${chip.label}`}
            onClick={() => actions.closeGroup(chip.id)}
          >
            <span className="codicon codicon-close" />
          </button>
        </span>
      ))}
    </div>
  );
};
