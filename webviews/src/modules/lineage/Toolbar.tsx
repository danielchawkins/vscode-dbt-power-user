import { lineage } from "@fusion-power-user/webview-contract";
import { PopoverWithButton } from "@uicore";
import { useEffect, useRef, useState } from "react";
import HelpButton from "./components/help/HelpButton";
import styles from "./lineageGraph.module.css";
import type { ResolvedSettings } from "./viewModel";
import { REF_SOURCES } from "./viewModel";

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

const VIEW_MODES: { value: lineage.ViewMode; label: string }[] = [
  { value: "whole", label: "Whole project" },
  { value: "neighbourhood", label: "Neighbourhood" },
];

/**
 * A whole-number input that reports each valid value once `delayMs` has passed without another keystroke, so a depth
 * relays the graph out once it settles. A value outside `min` to `max` is not reported; the draft still shows it.
 */
const NumberSetting = ({
  label,
  value,
  min,
  max,
  delayMs,
  onValue,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  delayMs: number;
  onValue: (value: number) => void;
}) => {
  const [draft, setDraft] = useState(String(value));
  const [shown, setShown] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // A value the host or a reset sets replaces the draft; the draft is kept while the value is unchanged.
  if (shown !== value) {
    setShown(value);
    setDraft(String(value));
  }
  useEffect(() => () => clearTimeout(timerRef.current), []);
  return (
    <label>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          const next = Math.round(Number(e.target.value));
          clearTimeout(timerRef.current);
          if (Number.isFinite(next) && next >= min && next <= max) {
            timerRef.current = setTimeout(onValue, delayMs, next);
          }
        }}
      />
    </label>
  );
};

/** The View choice, and what it sets: the depths and the card budget for the neighbourhood, a note for the whole project. */
const ViewChoice = ({
  settings,
  change,
}: {
  settings: ResolvedSettings;
  change: Change;
}) => (
  <>
    <div role="radiogroup" aria-label="View">
      {VIEW_MODES.map(({ value, label }) => (
        <label key={value}>
          <input
            type="radio"
            name="view"
            value={value}
            checked={settings.viewMode === value}
            onChange={() => change({ viewMode: value })}
          />
          {label}
        </label>
      ))}
    </div>
    {settings.viewMode === "neighbourhood" ? (
      <>
        <NumberSetting
          label="Upstream depth"
          value={settings.upstreamDepth}
          min={0}
          max={lineage.MAX_VIEW_DEPTH}
          delayMs={300}
          onValue={(upstreamDepth) => change({ upstreamDepth })}
        />
        <NumberSetting
          label="Downstream depth"
          value={settings.downstreamDepth}
          min={0}
          max={lineage.MAX_VIEW_DEPTH}
          delayMs={300}
          onValue={(downstreamDepth) => change({ downstreamDepth })}
        />
        <NumberSetting
          label="Card budget"
          value={settings.cardBudget}
          min={1}
          max={lineage.MAX_CARD_BUDGET}
          delayMs={300}
          onValue={(cardBudget) => change({ cardBudget })}
        />
        <p>
          The depths replace Default expansion here: the neighbourhood is the
          cards within each depth, up to the card budget.
        </p>
      </>
    ) : (
      <p>
        The whole project is drawn and centred on the open model. Default
        expansion sets the neighbourhood that zoom is read from.
      </p>
    )}
  </>
);

const EdgeSettings = ({
  settings,
  change,
  children,
}: {
  settings: ResolvedSettings;
  change: Change;
  children?: React.ReactNode;
}) => (
  <div className={styles.menu}>
    <ViewChoice settings={settings} change={change} />
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
    {settings.viewMode === "whole" ? (
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
    ) : null}
    <Check
      label="Highlight the paths of the hovered or selected card"
      checked={settings.pathHighlight}
      onChange={(pathHighlight) => change({ pathHighlight })}
    />
    <Check
      label="Dim the cards and edges off the path"
      checked={settings.dimOffPath}
      onChange={(dimOffPath) => change({ dimOffPath })}
    />
    <Check
      label="Thin the edges of hub cards"
      checked={settings.hubDeemphasis}
      onChange={(hubDeemphasis) => change({ hubDeemphasis })}
    />
    <label>
      Edge opacity {settings.edgeOpacity.toFixed(2)}
      <input
        type="range"
        min={0.1}
        max={1}
        step={0.05}
        value={settings.edgeOpacity}
        onChange={(e) => change({ edgeOpacity: Number(e.target.value) })}
      />
    </label>
    {children}
  </div>
);

const CONNECTIONS: { value: lineage.Connections; label: string }[] = [
  { value: "dbt", label: "dbt dependencies" },
  { value: "declared", label: "Declared relationships" },
  { value: "both", label: "Both" },
];

const RefSettings = ({
  settings,
  change,
}: {
  settings: ResolvedSettings;
  change: Change;
}) => (
  <div className={styles.menu}>
    <div role="radiogroup" aria-label="Connections">
      {CONNECTIONS.map(({ value, label }) => (
        <label key={value}>
          <input
            type="radio"
            name="connections"
            value={value}
            checked={settings.connections === value}
            onChange={() => change({ connections: value })}
          />
          {label}
        </label>
      ))}
    </div>
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

/** The cards the user hid, each with Restore, and Restore all; the empty state says none are hidden. */
const HiddenCards = ({
  cards,
  restore,
  restoreAll,
}: {
  cards: { id: string; name: string }[];
  restore: (table: string) => void;
  restoreAll: () => void;
}) => (
  <section className={styles.hiddenCards} aria-label="Hidden cards">
    <span>Hidden cards</span>
    {cards.length === 0 ? (
      <p>No cards are hidden. Hide a card from its Hide button.</p>
    ) : (
      <>
        <ul>
          {cards.map((card) => (
            <li key={card.id}>
              {card.name}{" "}
              <button
                type="button"
                aria-label={`Restore ${card.name}`}
                onClick={() => restore(card.id)}
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={restoreAll}>
          Restore all
        </button>
      </>
    )}
  </section>
);

/** The toolbar: edge settings, the hidden cards, the connections choice, help and reset. */
const Toolbar = ({
  settings,
  change,
  reset,
  hiddenCards,
  restore,
  restoreAll,
}: {
  settings: ResolvedSettings;
  change: Change;
  reset: () => void;
  hiddenCards: { id: string; name: string }[];
  restore: (table: string) => void;
  restoreAll: () => void;
}): React.JSX.Element => (
  <div className={styles.toolbar}>
    <PopoverWithButton
      width={260}
      button={
        <button type="button" title="Settings">
          <span className="codicon codicon-settings-gear" />
          <span className={styles.buttonLabel}>Settings</span>
        </button>
      }
    >
      {() => (
        <EdgeSettings settings={settings} change={change}>
          <HiddenCards
            cards={hiddenCards}
            restore={restore}
            restoreAll={restoreAll}
          />
        </EdgeSettings>
      )}
    </PopoverWithButton>
    <PopoverWithButton
      width={260}
      button={
        <button
          type="button"
          aria-pressed={settings.connections !== "dbt"}
          title="Connections"
        >
          <span className="codicon codicon-references" />
          <span className={styles.buttonLabel}>Connections</span>
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
      <span className="codicon codicon-discard" />
      <span className={styles.buttonLabel}>Reset</span>
    </button>
  </div>
);

export default Toolbar;
