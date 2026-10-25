import AppProvider from "@modules/app/AppProvider";
import { handleIncomingResponse } from "@modules/app/requestExecutor";
import DocumentationProvider from "@modules/documentationEditor/DocumentationProvider";
import { act, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ControlId } from "./controlCoverage";
import { getVsCodeApiMock } from "./setup";

/** Answers the sync requests the editor makes, with the body the host would send for each command. */
const ANSWERS: Record<string, unknown> = {
  getColumnsOfModel: { columns: ["id", "email"] },
  getColumnsOfSources: { columns: ["id"] },
  getDistinctColumnValues: ["placed", "shipped", "returned"],
  getModelsInProject: { models: ["customers"] },
  getSourcesInProject: { sources: [] },
  getTestCode: { sql: "select order_id from orders", config: "version: 2" },
  getUnitTestCode: { yaml: "name: unit_totals" },
  saveDocumentation: { saved: true },
  showInformationMessage: "Yes, overwrite",
};
const answerRequests = () =>
  getVsCodeApiMock().postMessage.mockImplementation((message: unknown) => {
    const { command, syncRequestId } = message as {
      command: string;
      syncRequestId?: string;
    };
    if (syncRequestId) {
      queueMicrotask(() =>
        handleIncomingResponse({
          syncRequestId,
          status: true,
          body: ANSWERS[command],
        }),
      );
    }
  });
/** Dispatches a host message to the panel. */
const send = (data: object) =>
  act(() => {
    globalThis.dispatchEvent(new MessageEvent("message", { data }));
  });
/** Renders the editor inside the app, then dispatches each host message to it. */
export const openDocumentation = (...messages: object[]) => {
  answerRequests();
  const user = userEvent.setup();
  const { container } = render(
    <AppProvider>
      <DocumentationProvider />
    </AppProvider>,
  );
  messages.forEach(send);
  return { user, container };
};
/** The host has no documented model for the active editor, and says why. */
export const NO_DOCS = {
  command: "renderDocumentation",
  docBlocks: [],
  missingDocumentationMessage: {
    type: "error",
    message: "No documented model in the active editor.",
  },
};
/** A model with three columns, two model tests and column tests, five unit tests and two doc blocks. */
export const DOCUMENTATION = {
  command: "renderDocumentation",
  docs: {
    name: "orders",
    description: "Orders placed by customers.",
    columns: [
      {
        name: "order_id",
        type: "integer",
        description: "Primary key.",
        source: "YAML",
      },
      { name: "status", type: "varchar", description: "", source: "YAML" },
      {
        name: "customer_id",
        type: "integer",
        description: "",
        source: "YAML",
      },
    ],
    filePath: "/project/models/orders.sql",
    patchPath: "/project/models/schema.yml",
    uniqueId: "model.demo.orders",
    resource_type: "model",
  },
  project: "demo",
  tests: [
    {
      key: "row_count",
      column_name: null,
      test_metadata: { name: "row_count", kwargs: { model: "orders" } },
    },
    {
      key: "amount_positive",
      column_name: null,
      test_metadata: {
        name: "amount_positive",
        kwargs: { model: "orders" },
      },
    },
    {
      key: "recent_orders",
      column_name: null,
      test_metadata: {
        name: "recent_orders",
        kwargs: { model: "orders" },
      },
    },
    {
      key: "status_mix",
      column_name: null,
      test_metadata: { name: "status_mix", kwargs: { model: "orders" } },
    },
    {
      key: "order_id_not_null",
      column_name: "order_id",
      test_metadata: {
        name: "not_null",
        kwargs: { column_name: "order_id", model: "orders" },
      },
    },
    {
      key: "order_id_unique",
      column_name: "order_id",
      test_metadata: {
        name: "unique",
        kwargs: { column_name: "order_id", model: "orders" },
      },
    },
    {
      key: "status_accepted",
      column_name: "status",
      test_metadata: {
        name: "accepted_values",
        kwargs: {
          column_name: "status",
          model: "orders",
          values: ["placed", "shipped"],
        },
      },
    },
    {
      key: "customer_id_relationships",
      column_name: "customer_id",
      test_metadata: {
        name: "relationships",
        kwargs: {
          column_name: "customer_id",
          model: "orders",
          to: "ref('customers')",
          field: "id",
        },
      },
    },
  ],
  unitTests: [
    { name: "unit_totals", path: "models/unit_tests.yml" },
    { name: "unit_status", path: "models/unit_tests.yml" },
    { name: "unit_refunds", path: "models/unit_tests.yml" },
    { name: "unit_discounts", path: "models/unit_tests.yml" },
    { name: "unit_tax", path: "models/unit_tests.yml" },
  ],
  docBlocks: [
    { name: "intro", path: "docs/intro.md" },
    { name: "orders_summary", path: "docs/orders.md" },
  ],
};

/** The same model with no schema file, so saving asks where to write it. */
export const WITHOUT_SCHEMA = {
  ...DOCUMENTATION,
  docs: { ...DOCUMENTATION.docs, patchPath: undefined },
};
/** Type proposals for `DOCUMENTATION`: a fill, an overwrite, an added column and a column the target does not list. */
export const TYPE_PROPOSALS = {
  command: "renderColumnProposals",
  payload: {
    kind: "types",
    model: "/project/models/orders.sql",
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
/** Description proposals for `DOCUMENTATION`: one candidate for customer_id, two disagreeing ones for status. */
export const DESCRIPTION_PROPOSALS = {
  command: "renderColumnProposals",
  payload: {
    kind: "descriptions",
    model: "/project/models/orders.sql",
    proposals: [
      {
        column: "customer_id",
        candidates: [
          {
            description: "Customer key",
            sources: [{ uniqueId: "model.demo.raw", column: "customer_id" }],
          },
        ],
      },
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
/** Every control `DocumentationEditor.controls.test.tsx` clicks. */
export const TESTED_CONTROLS: readonly ControlId[] = [
  "button:1 test +",
  "button:2 tests +",
  "button:Accept",
  "button:Accept all",
  "button:Add",
  "button:Add test for customer_id",
  "button:Add test for order_id",
  "button:Add test for orders",
  "button:Add test for status",
  "button:Cancel",
  "button:Click here",
  "button:Close",
  "button:Delete test",
  "button:Dismiss",
  "button:Edit test",
  "button:Existing file",
  "button:Get distinct column values",
  "button:Help",
  "button:Help/Close",
  "button:Help/Documentation",
  "button:Help/Tests",
  "button:Help/backdrop Close",
  "button:Insert doc block reference",
  "button:Minimize",
  "button:New file",
  "button:Pull upstream descriptions",
  "button:Record column types",
  "button:Remove placed",
  "button:Remove shipped",
  "button:Save",
  "button:Skip",
  "button:Update",
  "button:Use strict analysis",
  "button:accepted_values",
  "button:amount_positive",
  "button:intro",
  "button:not_null",
  "button:orders_summary",
  "button:recent_orders",
  "button:relationships",
  "button:row_count",
  "button:status_mix",
  "button:unique",
  "button:unit_discounts",
  "button:unit_refunds",
  "button:unit_status",
  "button:unit_totals",
  "checkbox:Replace data_type of customer_id",
  "combobox:Field",
  "combobox:To",
  "link:Help/documentation",
  "link:dbt docs ↗",
  "link:documentation",
  "radio:Fulfilment state from model.demo.ship.state",
  "radio:Order status from model.demo.raw.status",
];
