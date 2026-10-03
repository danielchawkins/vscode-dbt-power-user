import type { lineage } from "@fusion-power-user/webview-contract";
import { PopoverWithButton } from "@uicore";
import HelpButton from "./components/help/HelpButton";
import styles from "./lineageGraph.module.css";
import { REF_SOURCES, ResolvedSettings } from "./viewModel";

type Change = (settings: Partial<lineage.LineageSettings>) => void;

const Check = ({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) => (
  <label>
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
    {label}
  </label>
);

const EdgeSettings = ({
  settings,
  change,
}: {
  settings: ResolvedSettings;
  change: Change;
}) => (
  <div className={styles.menu}>
    <Check
      label="Show select (direct) column edges"
      checked={settings.showSelectEdges}
      onChange={(showSelectEdges) => change({ showSelectEdges })}
    />
    <Check
      label="Show non-select (indirect) column edges"
      checked={settings.showNonSelectEdges}
      onChange={(showNonSelectEdges) => change({ showNonSelectEdges })}
    />
    <label>
      Default expansion
      <input
        type="number"
        min={0}
        max={5}
        value={settings.defaultExpansion}
        onChange={(e) => {
          const value = Math.round(Number(e.target.value));
          if (Number.isFinite(value) && value >= 0 && value <= 5) {
            change({ defaultExpansion: value });
          }
        }}
      />
    </label>
  </div>
);

const RefSettings = ({
  settings,
  change,
}: {
  settings: ResolvedSettings;
  change: Change;
}) => (
  <div className={styles.menu}>
    <Check
      label="Show relationships"
      checked={settings.showRefs}
      onChange={(showRefs) => change({ showRefs })}
    />
    {REF_SOURCES.map((source) => (
      <Check
        key={source}
        label={source}
        checked={settings.enabledRefSources[source]}
        onChange={(value) =>
          change({
            enabledRefSources: {
              ...settings.enabledRefSources,
              [source]: value,
            },
          })
        }
      />
    ))}
    <label>
      Inferred confidence ≥ {settings.inferenceConfidenceThreshold.toFixed(2)}
      <input
        type="range"
        min={0.6}
        max={1}
        step={0.05}
        value={settings.inferenceConfidenceThreshold}
        onChange={(e) =>
          change({ inferenceConfidenceThreshold: Number(e.target.value) })
        }
      />
    </label>
    <Check
      label="Infer relationships for sources"
      checked={settings.includeSourcesInInference}
      onChange={(includeSourcesInInference) =>
        change({ includeSourcesInInference })
      }
    />
  </div>
);

/** The toolbar: edge settings, the relationship overlay, help and reset. */
const Toolbar = ({
  settings,
  change,
  reset,
}: {
  settings: ResolvedSettings;
  change: Change;
  reset: () => void;
}): JSX.Element => (
  <div className={styles.toolbar}>
    <PopoverWithButton
      width={260}
      button={
        <button type="button">
          <span className="codicon codicon-settings-gear" /> Settings
        </button>
      }
    >
      {() => <EdgeSettings settings={settings} change={change} />}
    </PopoverWithButton>
    <PopoverWithButton
      width={260}
      button={
        <button type="button" aria-pressed={settings.showRefs}>
          <span className="codicon codicon-references" /> Relationships
        </button>
      }
    >
      {() => <RefSettings settings={settings} change={change} />}
    </PopoverWithButton>
    <HelpButton />
    <button
      type="button"
      onClick={reset}
      title="Redraw at the default expansion"
    >
      <span className="codicon codicon-discard" /> Reset
    </button>
  </div>
);

export default Toolbar;
