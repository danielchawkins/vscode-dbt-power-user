import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useReducer } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@modules/documentationEditor/requests", () => ({
  executeRequestInSync: vi.fn().mockResolvedValue({ saved: true }),
  executeRequestInAsync: vi.fn(),
}));

import { executeRequestInSync } from "@modules/documentationEditor/requests";
import { DocumentationContext } from "../../context";
import {
  ProposalsContext,
  useProposals,
} from "../../proposals/ProposalsContext";
import {
  initialProposalsState,
  proposalsReducer,
  received,
} from "../../proposals/proposalsReducer";
import {
  documentationReducer,
  initialState,
} from "../../state/documentationReducer";
import type { DBTDocumentation } from "../../state/types";
import { Source } from "../../state/types";
import SaveDocumentation from "./SaveDocumentation";

const model = (over: Partial<DBTDocumentation> = {}): DBTDocumentation => ({
  name: "orders",
  description: "saved",
  columns: [
    { name: "id", description: "", generated: false, source: Source.YAML },
  ],
  generated: false,
  filePath: "/models/orders.sql",
  ...over,
});

/** Shows the model whose proposals are still pending, or `none` once they are cleared. */
const ProposalsModel = (): React.JSX.Element => {
  const { state } = useProposals();
  return <div data-testid="proposals-model">{state.model ?? "none"}</div>;
};

const Harness = ({
  current,
  incoming,
}: {
  current: DBTDocumentation;
  incoming: DBTDocumentation;
}): React.JSX.Element => {
  const [state, dispatch] = useReducer(documentationReducer, {
    ...initialState,
    incomingDocsData: { docs: incoming },
    currentDocsData: current,
  });
  const [proposals, dispatchProposals] = useReducer(
    proposalsReducer,
    initialProposalsState,
    (initial) =>
      proposalsReducer(
        initial,
        received({
          kind: "types",
          model: current.filePath,
          proposals: [],
          notFound: [],
        }),
      ),
  );
  return (
    <DocumentationContext value={{ state, dispatch }}>
      <ProposalsContext
        value={{ state: proposals, dispatch: dispatchProposals }}
      >
        <SaveDocumentation />
        <ProposalsModel />
      </ProposalsContext>
    </DocumentationContext>
  );
};

describe("SaveDocumentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing while the documentation is unchanged", () => {
    render(<Harness current={model()} incoming={model()} />);
    expect(screen.queryByText("Save")).toBeNull();
  });

  it("opens the path popover from the chevron even when a schema file exists", () => {
    render(
      <Harness
        current={model({ description: "edited", patchPath: "/models/s.yml" })}
        incoming={model({ patchPath: "/models/s.yml" })}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    const [, chevron] = screen.getAllByRole("button");
    fireEvent.click(chevron!);
    expect(screen.getByRole("dialog")).toHaveTextContent("/models/s.yml");
    expect(executeRequestInSync).not.toHaveBeenCalled();
  });

  it("toggles the popover from the chevron, which carries the aria state", () => {
    render(
      <Harness
        current={model({ description: "edited", patchPath: "/models/s.yml" })}
        incoming={model({ patchPath: "/models/s.yml" })}
      />,
    );
    const [save, chevron] = screen.getAllByRole("button");
    expect(save).not.toHaveAttribute("aria-expanded");
    expect(chevron).toHaveAttribute("aria-haspopup", "dialog");
    expect(chevron).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(chevron!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(chevron).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(chevron!);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(chevron).toHaveAttribute("aria-expanded", "false");
  });

  it("saves with an empty patch path when the model has no schema file yet", async () => {
    render(
      <Harness current={model({ description: "edited" })} incoming={model()} />,
    );
    fireEvent.click(screen.getByText("Save"));
    fireEvent.click(await screen.findByText("New file"));

    await waitFor(() => {
      expect(executeRequestInSync).toHaveBeenCalledWith(
        "saveDocumentation",
        expect.objectContaining({ patchPath: "", dialogType: "New file" }),
      );
    });
  });

  it("clears the proposals after a saved result", async () => {
    render(
      <Harness current={model({ description: "edited" })} incoming={model()} />,
    );
    expect(screen.getByTestId("proposals-model")).toHaveTextContent(
      "/models/orders.sql",
    );
    fireEvent.click(screen.getByText("Save"));
    fireEvent.click(await screen.findByText("New file"));

    await waitFor(() => {
      expect(screen.getByTestId("proposals-model")).toHaveTextContent("none");
    });
  });

  it("keeps the proposals after an unsaved result", async () => {
    vi.mocked(executeRequestInSync).mockResolvedValueOnce({ saved: false });
    render(
      <Harness current={model({ description: "edited" })} incoming={model()} />,
    );
    fireEvent.click(screen.getByText("Save"));
    fireEvent.click(await screen.findByText("New file"));

    await waitFor(() => {
      expect(executeRequestInSync).toHaveBeenCalledWith(
        "saveDocumentation",
        expect.anything(),
      );
    });
    await act(async () => {});
    expect(screen.getByTestId("proposals-model")).toHaveTextContent(
      "/models/orders.sql",
    );
  });
});
