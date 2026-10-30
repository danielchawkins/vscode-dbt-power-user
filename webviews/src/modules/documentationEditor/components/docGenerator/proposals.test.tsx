import AppProvider from "@modules/app/AppProvider";
import DocumentationProvider from "@modules/documentationEditor/DocumentationProvider";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { expectPosted } from "../../../../test/controlCoverage";

const FILE = "/project/models/orders.sql";

/** A model with a column that has no type, one with a type the proposal overwrites, and one with a description. */
const DOCUMENTATION = {
  command: "renderDocumentation",
  docs: {
    name: "orders",
    description: "Orders placed by customers.",
    columns: [
      {
        name: "order_id",
        type: "integer",
        description: "Key.",
        source: "YAML",
      },
      { name: "status", type: null, description: "", source: "YAML" },
      {
        name: "customer_id",
        type: "integer",
        description: "",
        source: "YAML",
      },
    ],
    filePath: FILE,
    patchPath: "/project/models/schema.yml",
    uniqueId: "model.demo.orders",
    resource_type: "model",
  },
  project: "demo",
  docBlocks: [],
  tests: [],
  unitTests: [],
};

const TYPES = {
  command: "renderColumnProposals",
  payload: {
    kind: "types",
    model: FILE,
    source: { kind: "target", target: "dev", relation: "orders" },
    proposals: [
      { column: "status", type: "varchar", change: "fill" },
      {
        column: "customer_id",
        type: "bigint",
        change: "overwrite",
        current: "integer",
      },
      { column: "discount", type: "numeric", change: "add" },
    ],
    notFound: ["legacy_id"],
  },
};

const DESCRIPTIONS = {
  command: "renderColumnProposals",
  payload: {
    kind: "descriptions",
    model: FILE,
    proposals: [
      {
        column: "status",
        candidates: [
          {
            description: "Order status",
            sources: [{ uniqueId: "model.demo.raw", column: "status" }],
          },
          {
            description: "Fulfilment state",
            sources: [{ uniqueId: "model.demo.ship", column: "state" }],
          },
        ],
      },
    ],
  },
};

const renderEditor = (...messages: object[]) => {
  const user = userEvent.setup();
  render(
    <AppProvider>
      <DocumentationProvider />
    </AppProvider>,
  );
  for (const data of [DOCUMENTATION, ...messages]) {
    act(() => {
      globalThis.dispatchEvent(new MessageEvent("message", { data }));
    });
  }
  return { user };
};

/** The row of a type proposal, found from the text that names its type. */
const typeRow = (text: string) =>
  within(screen.getByText(text).parentElement!.parentElement!);

describe("column proposal controls", () => {
  it("shows the source label and the columns not found in the target", () => {
    renderEditor(TYPES);
    // getAllByText throws when the label is missing, so the call is the presence check.
    screen.getAllByText("Types from target dev, relation orders");
    expect(screen.getByText(/Not found in target/)).toBeInTheDocument();
    expect(screen.getByText("legacy_id")).toBeInTheDocument();
  });

  it("preselects no description candidate", () => {
    renderEditor(DESCRIPTIONS);
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).not.toBeChecked();
    }
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("needs the overwrite tick before Accept applies", async () => {
    const { user } = renderEditor(TYPES);
    const tick = screen.getByRole("checkbox", {
      name: "Replace data_type of customer_id",
    });
    const accept = within(tick.closest("label")!.parentElement!).getByRole(
      "button",
      { name: "Accept" },
    );
    expect(accept).toBeDisabled();
    await user.click(tick);
    expect(accept).toBeEnabled();
    await user.click(accept);
    expect(screen.getByText("bigint")).toBeInTheDocument();
  });

  it("offers Use strict analysis only when the notice carries it, and posts runNoticeAction", async () => {
    const plain = {
      command: "renderColumnProposals",
      payload: {
        kind: "types",
        model: FILE,
        proposals: [],
        notFound: [],
        notice: { message: "No types were found.", type: "error" },
      },
    };
    const { user } = renderEditor(plain);
    expect(screen.getByText("No types were found.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Use strict analysis" }),
    ).toBeNull();

    act(() => {
      globalThis.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "renderColumnProposals",
            payload: {
              ...plain.payload,
              notice: {
                message: "Inferred types need strict analysis.",
                type: "warning",
                actions: [
                  {
                    title: "Use strict analysis",
                    action: "useStrictAnalysis",
                  },
                ],
              },
            },
          },
        }),
      );
    });
    await user.click(
      screen.getByRole("button", { name: "Use strict analysis" }),
    );
    await expectPosted("runNoticeAction", { action: "useStrictAnalysis" });
  });

  it("shows Save only after an accept makes the editor dirty", async () => {
    const { user } = renderEditor(TYPES);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    await user.click(
      typeRow("Type varchar").getByRole("button", { name: "Accept" }),
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });
});
