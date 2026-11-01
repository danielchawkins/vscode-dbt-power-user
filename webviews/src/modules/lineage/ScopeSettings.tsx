import BusyCardList from "./BusyCardList";
import { Check } from "./Check";
import { EDGE_GROUP_LABELS } from "./edgeGroups";
import styles from "./lineageGraph.module.css";
import ScopeExclusions from "./ScopeExclusions";
import type { ScopeControls } from "./useStoredFilters";

/**
 * The Scope settings: a checkbox per node type and per tag the graph holds, what they take out, a checkbox per edge
 * group the drawn graph has, the transitive reduction checkbox, and Show all; then the busy-node list.
 */
const ScopeSettings = ({
  scope,
}: {
  scope: ScopeControls;
}): React.JSX.Element => {
  const { offTypes, offTags, offEdgeGroups, transitiveReduction } = scope.scope;
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
      <span>Edge groups</span>
      {scope.edgeGroups.length === 0 ? <p>No edge is drawn.</p> : null}
      {scope.edgeGroups.map((group) => (
        <Check
          key={group}
          label={EDGE_GROUP_LABELS[group]}
          checked={!offEdgeGroups.includes(group)}
          disabled={!scope.ready}
          onChange={(on) => scope.setEdgeGroup(group, on)}
        />
      ))}
      <Check
        label="Transitive reduction"
        checked={transitiveReduction}
        disabled={!scope.ready}
        onChange={(on) => scope.setTransitiveReduction(on)}
      />
      <p>
        {scope.filteredOut} {scope.filteredOut === 1 ? "card" : "cards"}{" "}
        filtered out
      </p>
      <button type="button" disabled={!scope.ready} onClick={scope.showAll}>
        Show all
      </button>
      <ScopeExclusions />
      <BusyCardList busy={scope.busy} />
    </section>
  );
};

export default ScopeSettings;
