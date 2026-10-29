import type { columnProposals } from "@fusion-power-user/webview-contract";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@modules/documentationEditor/requests", () => ({
  executeRequestInSync: vi.fn().mockResolvedValue(undefined),
  executeRequestInAsync: vi.fn(),
}));

// The editor UI is out of scope here: the probe shows the model, the pending proposals, and a type edit.
vi.mock("./DocumentationEditor", async () => {
  const { useProposals } = await import("./proposals/ProposalsContext");
  const { default: useDocumentationContext } =
    await import("./state/useDocumentationContext");
  const { updateColumnsInCurrentDocsData } =
    await import("./state/documentationReducer");
  const Probe = (): React.JSX.Element => {
    const { state } = useDocumentationContext();
    const proposals = useProposals().state;
    const { dispatch } = useDocumentationContext();
    return (
      <div>
        <div data-testid="current-model">
          {state.currentDocsData?.name ?? "none"}
        </div>
        <div data-testid="current-replace-type">
          {String(state.currentDocsData?.columns[0]?.replaceType)}
        </div>
        <div data-testid="proposal-model">{proposals.model ?? "none"}</div>
        <div data-testid="proposal-kinds">
          {Object.keys(proposals.byKind).join(",") || "none"}
        </div>
        <button
          onClick={() =>
            dispatch(
              updateColumnsInCurrentDocsData({
                columns: [{ name: "id", type: "integer" }],
              }),
            )
          }
        >
          Edit type
        </button>
      </div>
    );
  };
  return { default: Probe };
});

import { executeRequestInSync } from "@modules/documentationEditor/requests";
import DocumentationProvider from "./DocumentationProvider";

const ORDERS = "/models/orders.sql";
const CUSTOMERS = "/models/customers.sql";

const documentation = (filePath: string, name: string) => ({
  name,
  description: "",
  columns: [{ name: "id", description: "key", source: "YAML" as const }],
  generated: false,
  filePath,
  uniqueId: `model.p.${name}`,
  resource_type: "model",
});

const typesPayload = (model: string): columnProposals.TypeProposalsPayload => ({
  kind: "types",
  model,
  proposals: [{ column: "id", type: "integer", change: "fill" }],
  notFound: [],
});

/** Delivers `data` to the panel as a message from the extension host. */
const postToPanel = (data: unknown) =>
  act(() => {
    globalThis.dispatchEvent(new MessageEvent("message", { data }));
  });

const renderDocumentation = (
  name: string,
  filePath: string,
  draft?: { docs: ReturnType<typeof documentation> },
) =>
  postToPanel({
    command: "renderDocumentation",
    docs: documentation(filePath, name),
    tests: [],
    unitTests: [],
    docBlocks: [],
    draft: draft && { ...draft, tests: [] },
  });

describe("DocumentationProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restores a draft's accepted overwrite on the current column", async () => {
    render(<DocumentationProvider />);
    const docs = documentation(ORDERS, "orders");
    const accepted = { ...docs.columns[0]!, replaceType: true };
    renderDocumentation("orders", ORDERS, {
      docs: { ...docs, columns: [accepted] },
    });

    await waitFor(() =>
      expect(screen.getByTestId("current-model")).toHaveTextContent("orders"),
    );
    expect(screen.getByTestId("current-replace-type")).toHaveTextContent(
      "true",
    );
  });

  it("routes renderColumnProposals for the current model to the proposals context", async () => {
    render(<DocumentationProvider />);
    renderDocumentation("orders", ORDERS);
    await waitFor(() =>
      expect(screen.getByTestId("current-model")).toHaveTextContent("orders"),
    );

    postToPanel({
      command: "renderColumnProposals",
      payload: typesPayload(ORDERS),
    });

    expect(screen.getByTestId("proposal-model")).toHaveTextContent(ORDERS);
    expect(screen.getByTestId("proposal-kinds")).toHaveTextContent("types");
  });

  it("drops renderColumnProposals for another model", async () => {
    render(<DocumentationProvider />);
    renderDocumentation("orders", ORDERS);
    await waitFor(() =>
      expect(screen.getByTestId("current-model")).toHaveTextContent("orders"),
    );

    postToPanel({
      command: "renderColumnProposals",
      payload: typesPayload(CUSTOMERS),
    });

    expect(screen.getByTestId("proposal-model")).toHaveTextContent("none");
    expect(screen.getByTestId("proposal-kinds")).toHaveTextContent("none");
  });

  it("clears the proposals when the documentation of another model renders", async () => {
    render(<DocumentationProvider />);
    renderDocumentation("orders", ORDERS);
    await waitFor(() =>
      expect(screen.getByTestId("current-model")).toHaveTextContent("orders"),
    );
    postToPanel({
      command: "renderColumnProposals",
      payload: typesPayload(ORDERS),
    });
    expect(screen.getByTestId("proposal-model")).toHaveTextContent(ORDERS);

    renderDocumentation("customers", CUSTOMERS);

    await waitFor(() =>
      expect(screen.getByTestId("current-model")).toHaveTextContent(
        "customers",
      ),
    );
    expect(screen.getByTestId("proposal-model")).toHaveTextContent("none");
  });

  it("still asks before discarding a dirty type edit when another model arrives", async () => {
    render(<DocumentationProvider />);
    renderDocumentation("orders", ORDERS);
    await waitFor(() =>
      expect(screen.getByTestId("current-model")).toHaveTextContent("orders"),
    );
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Edit type" }));
    });

    renderDocumentation("customers", CUSTOMERS);

    await waitFor(() => {
      expect(executeRequestInSync).toHaveBeenCalledWith(
        "showWarningMessage",
        expect.objectContaining({
          infoMessage: expect.stringContaining("orders"),
        }),
      );
    });
    expect(screen.getByTestId("current-model")).toHaveTextContent("orders");
  });
});
