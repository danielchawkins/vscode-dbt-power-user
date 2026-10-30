import { PopoverWithButton, type PopoverWithButtonRef } from "@uicore";
import { useStore } from "@xyflow/react";
import { use, useEffect, useRef } from "react";
import type { GroupChip } from "./expansionGroups";
import { inlineChips } from "./layout";
import styles from "./lineageGraph.module.css";
import { TableActionsContext } from "./viewModel";

/**
 * The open groups of an expanded table as chips: the first `inlineChips` of them inline, and the rest behind a `+N`
 * button whose popover lists them.
 */
export const GroupChips = ({
  chips,
}: {
  chips: readonly GroupChip[];
}): React.JSX.Element | null => {
  if (chips.length === 0) {
    return null;
  }
  const inline = inlineChips(chips.length);
  return (
    <div className={styles.groupChips}>
      {chips.slice(0, inline).map((chip) => (
        <ChipControls key={chip.id} chip={chip} />
      ))}
      {inline < chips.length && <MoreGroups chips={chips.slice(inline)} />}
    </div>
  );
};

/**
 * One chip: its label, how many members it draws, a `+K` button drawing the next batch while `K` members are undrawn,
 * and a button closing it.
 */
const ChipControls = ({ chip }: { chip: GroupChip }): React.JSX.Element => {
  const actions = use(TableActionsContext);
  const undrawn = chip.total - chip.drawn;
  return (
    <span className={styles.chip} title={chip.label}>
      <span className={styles.chipLabel}>{chip.label}</span>
      <span>{`${chip.drawn}/${chip.total}`}</span>
      {undrawn > 0 && (
        <button
          type="button"
          className={`nodrag ${styles.more}`}
          aria-label={`Show ${undrawn} more in ${chip.label}`}
          title={`Show ${undrawn} more in ${chip.label}`}
          onClick={() => actions.showMoreInGroup(chip.id)}
        >
          {`+${undrawn}`}
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
};

/**
 * The `+N` button for the groups the chip row leaves out, and the popover listing them. The popover is anchored to
 * the table node, so it closes when the canvas moves.
 */
const MoreGroups = ({
  chips,
}: {
  chips: readonly GroupChip[];
}): React.JSX.Element => {
  const popoverRef = useRef<PopoverWithButtonRef>(null);
  const transform = useStore((state) => state.transform);
  useEffect(() => {
    popoverRef.current?.close();
  }, [transform]);
  return (
    <PopoverWithButton
      ref={popoverRef}
      title="Open groups"
      button={
        <button type="button" className={`nodrag ${styles.more}`}>
          {`+${chips.length} more`}
        </button>
      }
    >
      {() => (
        <div className={styles.moreGroups}>
          <ul className={styles.moreGroupsList}>
            {chips.map((chip) => (
              <li key={chip.id}>
                <ChipControls chip={chip} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </PopoverWithButton>
  );
};
