import { use } from "react";
import type { GroupChip } from "./expansionGroups";
import styles from "./lineageGraph.module.css";
import { TableActionsContext } from "./viewModel";

/**
 * One chip per open group of an expanded table: its label, how many members it draws, a `+K` button drawing the next
 * batch while `K` members are undrawn, and a button closing it.
 */
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
      {chips.map((chip) => {
        const hidden = chip.total - chip.drawn;
        return (
          <span key={chip.id} className={styles.chip} title={chip.label}>
            <span className={styles.chipLabel}>{chip.label}</span>
            <span>{`${chip.drawn}/${chip.total}`}</span>
            {hidden > 0 && (
              <button
                type="button"
                className={`nodrag ${styles.more}`}
                aria-label={`Show ${hidden} more in ${chip.label}`}
                title={`Show ${hidden} more in ${chip.label}`}
                onClick={() => actions.showMoreInGroup(chip.id)}
              >
                {`+${hidden}`}
              </button>
            )}
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
        );
      })}
    </div>
  );
};
