import type { PanelNotice } from "@fusion-power-user/webview-contract";
import { useProposals } from "@modules/documentationEditor/proposals/ProposalsContext";
import { sourceLabel } from "@modules/documentationEditor/proposals/sourceLabel";
import { useProposalActions } from "@modules/documentationEditor/proposals/useProposalActions";
import { executeRequestInAsync } from "@modules/documentationEditor/requests";
import { Alert, Button, Stack } from "@uicore";

const Notice = ({ notice }: { notice: PanelNotice }): React.JSX.Element => (
  <Alert color="warning" className="p-2 mb-0">
    {notice.message}{" "}
    {(notice.actions ?? []).map(({ title, action }) => (
      <Button
        key={action}
        color="link"
        className="pt-0 pb-0"
        onClick={() => executeRequestInAsync("runNoticeAction", { action })}
      >
        {title}
      </Button>
    ))}
  </Alert>
);

/** The pending column proposals of the model: where the types came from, what was not found, and the actions. */
const ProposalSummary = (): React.JSX.Element | null => {
  const { state } = useProposals();
  const actions = useProposalActions();
  const types = state.byKind.types?.payload;
  const descriptions = state.byKind.descriptions?.payload;
  if (!types && !descriptions) {
    return null;
  }
  const label = sourceLabel(types?.source);
  const added = types?.proposals.filter((p) => p.change === "add") ?? [];

  return (
    <Stack direction="column" className="mb-2">
      {label ? <p className="mb-1">{label}</p> : null}
      {types?.notice ? <Notice notice={types.notice} /> : null}
      {descriptions?.notice ? <Notice notice={descriptions.notice} /> : null}
      {types && types.notFound.length > 0 ? (
        <div>
          <p className="mb-1">
            {types.source?.kind === "target" ||
            types.source?.kind === "deferred" ? (
              <>
                Not found in target <code>{types.source.target}</code>
              </>
            ) : (
              "Not found in the inferred types"
            )}
          </p>
          <ul className="mb-1">
            {types.notFound.map((column) => (
              <li key={column}>{column}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {added.map((proposal) => (
        <Stack key={proposal.column} className="align-items-center">
          <span>
            Add column {proposal.column} ({proposal.type})
          </span>
          <Button
            color="link"
            className="pt-0 pb-0"
            onClick={() => actions.accept("types", proposal.column)}
          >
            Accept
          </Button>
        </Stack>
      ))}
      <Stack className="align-items-center">
        <Button color="primary" onClick={actions.acceptAll}>
          Accept all
        </Button>
        <Button color="link" className="pt-0 pb-0" onClick={actions.dismiss}>
          Dismiss
        </Button>
      </Stack>
    </Stack>
  );
};

export default ProposalSummary;
