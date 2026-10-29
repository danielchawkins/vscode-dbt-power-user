import type { columnProposals } from "@fusion-power-user/webview-contract";
import { useProposals } from "@modules/documentationEditor/proposals/ProposalsContext";
import {
  choicesOf,
  chose,
  toggledOverwrite,
} from "@modules/documentationEditor/proposals/proposalsReducer";
import { sourceLabel } from "@modules/documentationEditor/proposals/sourceLabel";
import { useProposalActions } from "@modules/documentationEditor/proposals/useProposalActions";
import type { EditorDocumentationColumn } from "@modules/documentationEditor/state/types";
import { Button, Stack } from "@uicore";

const sourcesOf = (candidate: columnProposals.DescriptionCandidate): string =>
  candidate.sources.map((s) => `${s.uniqueId}.${s.column}`).join(", ");

/** A type with its source. An overwrite shows its tick, which Accept needs before it applies. */
const TypeRow = ({
  proposal,
  source,
  name,
}: {
  proposal: columnProposals.TypeProposal;
  source: columnProposals.ProposalSource | undefined;
  name: string;
}): React.JSX.Element => {
  const { state, dispatch } = useProposals();
  const actions = useProposalActions();
  const overwriting = proposal.change === "overwrite";
  const ticked = choicesOf(state).types[name.toLowerCase()]?.overwrite === true;

  return (
    <Stack direction="column">
      <Stack className="align-items-center">
        <span>
          {overwriting
            ? `Type ${proposal.current ?? ""} → ${proposal.type}`
            : `Type ${proposal.type}`}
        </span>
        <small className="ms-2">{sourceLabel(source) ?? ""}</small>
      </Stack>
      {overwriting ? (
        <label>
          <input
            type="checkbox"
            checked={ticked}
            onChange={() =>
              dispatch(toggledOverwrite({ column: proposal.column }))
            }
          />{" "}
          Replace data_type of {name}
        </label>
      ) : null}
      <Button
        color="primary"
        disabled={overwriting && !ticked}
        onClick={() => actions.accept("types", proposal.column)}
      >
        Accept
      </Button>
    </Stack>
  );
};

/** A description with its source columns, or a radio group with nothing preselected when several candidates answer. */
const DescriptionRow = ({
  proposal,
  name,
}: {
  proposal: columnProposals.DescriptionProposal;
  name: string;
}): React.JSX.Element => {
  const { state, dispatch } = useProposals();
  const actions = useProposalActions();
  const pick = choicesOf(state).descriptions[name.toLowerCase()]?.candidate;
  const several = proposal.candidates.length > 1;
  const [only] = proposal.candidates;

  return (
    <Stack direction="column">
      {several ? (
        <fieldset>
          <legend className="h6 mb-1">Upstream descriptions</legend>
          {proposal.candidates.map((candidate, index) => (
            <label key={sourcesOf(candidate)} className="d-block">
              <input
                type="radio"
                name={`description-${name}`}
                checked={pick === index}
                onChange={() =>
                  dispatch(chose({ column: proposal.column, candidate: index }))
                }
              />{" "}
              {candidate.description} <small>from {sourcesOf(candidate)}</small>
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="mb-1">
          {only?.description} <small>from {only ? sourcesOf(only) : ""}</small>
        </p>
      )}
      <Stack>
        <Button
          color="primary"
          disabled={several && pick === undefined}
          onClick={() => actions.accept("descriptions", proposal.column)}
        >
          Accept
        </Button>
        <Button
          color="link"
          className="pt-0 pb-0"
          onClick={() => actions.skip("descriptions", proposal.column)}
        >
          Skip
        </Button>
      </Stack>
    </Stack>
  );
};

/**
 * The pending proposals for one column: its type and its description candidates. Accept applies one column's
 * proposals; Skip takes a description out of the pending list.
 */
const ColumnProposal = ({
  column,
}: {
  column: EditorDocumentationColumn;
}): React.JSX.Element | null => {
  const { state } = useProposals();
  const same = (proposed: string): boolean =>
    proposed.toLowerCase() === column.name.toLowerCase();
  const typeProposal = state.byKind.types?.payload.proposals.find(
    (p) => p.change !== "add" && same(p.column),
  );
  const descriptionProposal = state.byKind.descriptions?.payload.proposals.find(
    (p) => same(p.column),
  );
  if (!typeProposal && !descriptionProposal) {
    return null;
  }

  return (
    <Stack direction="column" className="mb-2">
      {typeProposal ? (
        <TypeRow
          proposal={typeProposal}
          source={state.byKind.types?.payload.source}
          name={column.name}
        />
      ) : null}
      {descriptionProposal ? (
        <DescriptionRow proposal={descriptionProposal} name={column.name} />
      ) : null}
    </Stack>
  );
};

export default ColumnProposal;
