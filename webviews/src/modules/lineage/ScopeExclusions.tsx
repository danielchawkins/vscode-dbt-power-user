import type { lineage } from "@fusion-power-user/webview-contract";
import { panelLogger } from "@modules/logger";
import { type SubmitEvent, useCallback, useEffect, useState } from "react";
import styles from "./lineageGraph.module.css";
import { addExclusion, fetchExclusions, removeExclusion } from "./requests";

/** A rule's outcome: the nodes it excludes, or the failure dbt gave for it. */
const outcomeOf = (item: lineage.ExclusionRule): string =>
  item.failure !== undefined
    ? `Not resolved: ${item.failure}`
    : `${item.count} ${item.count === 1 ? "node" : "nodes"} excluded`;

/**
 * The exclusions of the Scope popover: each `lineage.exclude` rule with its count or its failure, a Remove button per
 * rule, and an input that adds one. A rule naming `resource_type:macro` that matches nothing says Fusion returns no
 * macros. The list is read when the popover opens, and again after each change.
 */
const ScopeExclusions = (): React.JSX.Element => {
  const [rules, setRules] = useState<lineage.ExclusionRule[]>();
  const [draft, setDraft] = useState("");

  const load = useCallback(
    () =>
      fetchExclusions().then(setRules, (error) => {
        panelLogger.error("lineage exclusions", error);
        setRules([]);
      }),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const change = (action: Promise<unknown>) =>
    void action.then(load, (error) => {
      panelLogger.error("lineage exclusions", error);
    });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const rule = draft.trim();
    if (rule !== "") {
      setDraft("");
      change(addExclusion(rule));
    }
  };

  return (
    <section className={styles.exclusions} aria-label="Exclusions">
      <span>Exclusions</span>
      {rules?.length === 0 ? (
        <p>No node is excluded. Add a dbt selector below.</p>
      ) : null}
      <ul>
        {(rules ?? []).map((item) => (
          <li key={item.rule}>
            <span>{item.rule}</span> <span>{outcomeOf(item)}</span>{" "}
            <button
              type="button"
              aria-label={`Remove ${item.rule}`}
              onClick={() => change(removeExclusion(item.rule))}
            >
              Remove
            </button>
            {item.namesMacro && item.count === 0 ? (
              <p>
                Fusion 2.0.6 returns no macros for resource_type:macro, so this
                rule matches no node.
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      <form onSubmit={submit}>
        <input
          type="text"
          aria-label="Exclusion rule"
          placeholder="dbt selector, e.g. tag:nightly"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />{" "}
        <button type="submit" disabled={draft.trim() === ""}>
          Add rule
        </button>
      </form>
    </section>
  );
};

export default ScopeExclusions;
