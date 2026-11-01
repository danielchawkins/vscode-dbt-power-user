import { lineage } from "@fusion-power-user/webview-contract";
import { PopoverWithButton } from "@uicore";
import type { LayoutResponse } from "./engine/layoutEngine";
import styles from "./lineageGraph.module.css";
import type { LayoutControl } from "./useStoredLayout";

const SPACINGS: { value: lineage.SpacingPreset; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "compact", label: "Compact" },
];

/** The Layout popover: the spacing choice, one radio per preset. A change lays the cards out again at that spacing. */
const LayoutSettings = ({
  spacing,
  setSpacing,
}: {
  spacing: lineage.SpacingPreset;
  setSpacing: (spacing: lineage.SpacingPreset) => void;
}): React.JSX.Element => (
  <section className={styles.menu} aria-label="Layout">
    <span id="lineage-spacing-label" className={styles.fieldLabel}>
      Spacing
    </span>
    <div role="radiogroup" aria-labelledby="lineage-spacing-label">
      {SPACINGS.map(({ value, label }) => (
        <label key={value}>
          <input
            type="radio"
            name="spacing"
            value={value}
            checked={spacing === value}
            onChange={() => setSpacing(value)}
          />
          {label}
        </label>
      ))}
    </div>
  </section>
);

const count = (value: number): string =>
  Math.round(value).toLocaleString("en-US");

/**
 * The Layout readout: the measures of the last layout, read only. It shows what the layout drew and never lays
 * anything out, so it is updated by each relayout and by nothing else.
 */
export const LayoutReadout = ({
  metrics,
}: {
  metrics: LayoutResponse["metrics"];
}): React.JSX.Element => (
  <span className={styles.readout} data-testid="lineage-readout">
    {`Crossings ${count(metrics.crossings)} · Bends ${count(metrics.bends)} · Edge length ${count(metrics.edgeLength)} px · Area ${count(metrics.area)} px²`}
  </span>
);

/** The Layout control: a button that is pressed while the spacing is not the default, and the popover behind it. */
export const LayoutPopover = ({
  layout,
}: {
  layout: LayoutControl;
}): React.JSX.Element => (
  <PopoverWithButton
    width={260}
    button={
      <button
        type="button"
        aria-pressed={layout.spacing !== lineage.DEFAULT_SPACING_PRESET}
        title="Layout"
      >
        <span className="codicon codicon-layout" />
        <span className={styles.buttonLabel}>Layout</span>
      </button>
    }
  >
    {() => (
      <LayoutSettings spacing={layout.spacing} setSpacing={layout.setSpacing} />
    )}
  </PopoverWithButton>
);
