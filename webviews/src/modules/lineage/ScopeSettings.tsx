import BusyCardList from "./BusyCardList";
import { Check } from "./Check";
import styles from "./lineageGraph.module.css";
import type { ScopeControls } from "./useStoredFilters";

/**
 * The Scope settings: a checkbox per node type and per tag the graph holds, what they take out, and Show all; then the
 * busy-node list.
 */
const ScopeSettings = ({
  scope,
}: {
  scope: ScopeControls;
}): React.JSX.Element => {
  const { offTypes, offTags } = scope.scope;
  return (
    <section className={styles.menu} aria-label="Scope">
      <span>Node types</span>
      {scope.types.length === 0 ? <p>No node types are drawn.</p> : null}
      {scope.types.map((type) => (
        <Check
          key={type}
          label={type}
          checked={!offTypes.includes(type)}
          disabled={!scope.ready}
          onChange={(on) => scope.setType(type, on)}
        />
      ))}
      <span>Tags</span>
      {scope.tags.length === 0 ? <p>No card has a tag.</p> : null}
      {scope.tags.map((tag) => (
        <Check
          key={tag}
          label={tag}
          checked={!offTags.includes(tag)}
          disabled={!scope.ready}
          onChange={(on) => scope.setTag(tag, on)}
        />
      ))}
      <p>
        {scope.filteredOut} {scope.filteredOut === 1 ? "card" : "cards"}{" "}
        filtered out
      </p>
      <button type="button" disabled={!scope.ready} onClick={scope.showAll}>
        Show all
      </button>
      <BusyCardList busy={scope.busy} />
    </section>
  );
};

export default ScopeSettings;
